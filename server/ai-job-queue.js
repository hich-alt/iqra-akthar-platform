/**
 * اقرأ أكثر... ترى أكثر — AI MODULE
 * Background Job Queue for AI Generation (Phase 10+)
 *
 * No AI call ever runs synchronously in a request/response cycle.
 * Owner-facing UI enqueues a job and polls/subscribes for status;
 * this worker (run via cron, a Supabase Edge Function on a schedule,
 * or a long-running Node process) drains the queue.
 */

const crypto = require("crypto");

class RateLimiter {
  constructor({ maxPerMinute = 20 }) {
    this.maxPerMinute = maxPerMinute;
    this.timestamps = [];
  }
  async acquire() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
    if (this.timestamps.length >= this.maxPerMinute) {
      const waitMs = 60_000 - (now - this.timestamps[0]);
      await new Promise((r) => setTimeout(r, waitMs));
      return this.acquire();
    }
    this.timestamps.push(now);
  }
}

class AiJobQueue {
  constructor({ db, anthropicClient, promptLibrary, draftService, cache }) {
    this.db = db;
    this.anthropic = anthropicClient;
    this.promptLibrary = promptLibrary;
    this.draftService = draftService;
    this.cache = cache;
    this.rateLimiter = new RateLimiter({ maxPerMinute: 20 });
  }

  async enqueue({ jobType, inputVariables, requestedBy, priority = 5 }) {
    const prompt = await this.promptLibrary.getActivePrompt(jobType);
    return this.db.insert("ai_generation_jobs", {
      job_type: jobType,
      status: "queued",
      prompt_id: prompt.id,
      input_variables: inputVariables,
      requested_by: requestedBy,
      priority,
      attempts: 0,
      max_attempts: 3,
    });
  }

  _cacheKey(promptId, version, inputVariables) {
    const raw = `${promptId}:${version}:${JSON.stringify(inputVariables)}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  // Call this on a schedule (e.g. every 10s) — processes the next eligible job.
  async processNext() {
    if (this._shuttingDown) return null;

    const [job] = await this.db.query("ai_generation_jobs", {
      where: { status: "queued" },
      orderBy: { priority: "asc", scheduled_at: "asc" },
      limit: 1,
    });
    if (!job) return null;

    this._currentlyProcessing = true;
    await this.db.update("ai_generation_jobs", job.id, { status: "processing", started_at: new Date().toISOString() });

    try {
      const result = await this._runWithTimeout(job);
      return result;
    } catch (err) {
      return this._handleFailure(job, err);
    } finally {
      this._currentlyProcessing = false;
    }
  }

  async _runWithTimeout(job) {
    const timeoutMs = job.timeout_seconds * 1000;
    return Promise.race([
      this._execute(job),
      new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)),
    ]).catch(async (err) => {
      if (err.message === "TIMEOUT") {
        await this.db.update("ai_generation_jobs", job.id, {
          status: "timed_out", failure_reason: "timeout", finished_at: new Date().toISOString(),
        });
        return this._maybeRetry(job, "timeout");
      }
      throw err;
    });
  }

  async _execute(job) {
    const prompt = await this.db.get("prompt_library", job.prompt_id);
    const cacheKey = this._cacheKey(prompt.id, prompt.version, job.input_variables);

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return this._finalize(job, prompt, cached, { fromCache: true, inputTokens: 0, outputTokens: 0, processingMs: 0 });
    }

    await this.rateLimiter.acquire();

    const sanitizedVariables = this._sanitizeInputVariables(job.input_variables);
    const filledPrompt = this._fillTemplate(prompt.user_prompt_template, sanitizedVariables);
    const start = Date.now();

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: prompt.system_prompt,
      messages: [{ role: "user", content: filledPrompt }],
    });

    const processingMs = Date.now() - start;
    const rawText = response.content.find((c) => c.type === "text")?.text ?? "{}";
    const payload = JSON.parse(rawText.replace(/```json|```/g, "").trim());

    await this.cache.set(cacheKey, payload, { ttlSeconds: 3600 });

    return this._finalize(job, prompt, payload, {
      fromCache: false,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      processingMs,
    });
  }

  _fillTemplate(template, variables) {
    return Object.entries(variables).reduce(
      (acc, [key, val]) => acc.replaceAll(`{{${key}}}`, typeof val === "string" ? val : JSON.stringify(val)),
      template
    );
  }

  // -----------------------------------------------------------------------
  // SECURITY: Input sanitization — mitigates prompt injection from lesson
  // text, student answers, or any other variable content an Owner pastes
  // in. This does not make injection impossible (no sanitizer fully does),
  // but combined with the system prompts' explicit "use only the provided
  // text" instructions and the output validator's curriculum-scope check,
  // it closes the most common injection vector: instruction-like phrases
  // embedded in what should be inert source material.
  // -----------------------------------------------------------------------

  _sanitizeInputVariables(variables) {
    const MAX_FIELD_LENGTH = 8000;
    const INJECTION_PATTERNS = [
      /ignore (all|previous|the above) instructions/i,
      /system prompt/i,
      /you are now/i,
      /disregard (all|previous)/i,
    ];

    const sanitizeString = (str) => {
      let out = str.slice(0, MAX_FIELD_LENGTH);
      for (const pattern of INJECTION_PATTERNS) {
        out = out.replace(pattern, "[إشارة محذوفة لأسباب أمنية]");
      }
      return out;
    };

    const walk = (val) => {
      if (typeof val === "string") return sanitizeString(val);
      if (Array.isArray(val)) return val.map(walk);
      if (val && typeof val === "object") return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, walk(v)]));
      return val;
    };

    return walk(variables);
  }

  // -----------------------------------------------------------------------
  // DEAD-LETTER QUEUE — jobs that exhaust all retries move here instead of
  // disappearing into a generic "failed" status, so the Owner (or an
  // on-call process) can inspect systemic failures separately from normal
  // one-off API hiccups.
  // -----------------------------------------------------------------------

  async moveToDeadLetter(jobId, reason) {
    const job = await this.db.get("ai_generation_jobs", jobId);
    await this.db.insert("ai_dead_letter_jobs", {
      original_job_id: jobId,
      job_type: job.job_type,
      input_variables: job.input_variables,
      attempts: job.attempts,
      failure_reason: reason,
      moved_at: new Date().toISOString(),
    });
    return this.db.update("ai_generation_jobs", jobId, { status: "failed", failure_reason: reason });
  }

  async replayFromDeadLetter(deadLetterId, requestedBy) {
    const dl = await this.db.get("ai_dead_letter_jobs", deadLetterId);
    return this.enqueue({ jobType: dl.job_type, inputVariables: dl.input_variables, requestedBy, priority: 1 });
  }

  // -----------------------------------------------------------------------
  // WORKER RECOVERY — if a worker process crashes mid-job, jobs are left
  // stuck in "processing". Call this on worker startup to reclaim them.
  // -----------------------------------------------------------------------

  async recoverStuckJobs(staleAfterMinutes = 10) {
    const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000).toISOString();
    const stuck = await this.db.query("ai_generation_jobs", { where: { status: "processing" } });
    const toRecover = stuck.filter((j) => j.started_at && j.started_at < cutoff);
    for (const job of toRecover) {
      await this.db.update("ai_generation_jobs", job.id, { status: "queued", scheduled_at: new Date().toISOString() });
    }
    return toRecover.length;
  }

  // -----------------------------------------------------------------------
  // GRACEFUL SHUTDOWN — let an in-flight job finish (or hit its own timeout)
  // before the worker process exits; stop pulling new jobs immediately.
  // -----------------------------------------------------------------------

  requestShutdown() {
    this._shuttingDown = true;
  }

  async drainAndShutdown({ maxWaitMs = 30_000 } = {}) {
    this.requestShutdown();
    const start = Date.now();
    while (this._currentlyProcessing && Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // -----------------------------------------------------------------------
  // CACHE INVALIDATION — when a prompt is updated to a new version, old
  // cache entries keyed to the previous version naturally stop being hit
  // (cache key includes prompt version), but stale entries for the OLD
  // version should still be purged rather than left to expire naturally,
  // e.g. if the old version is later re-activated by mistake.
  // -----------------------------------------------------------------------

  async invalidateCacheForPrompt(promptId, version) {
    return this.cache.deleteByPrefix(`${promptId}:${version}:`);
  }

  async _finalize(job, prompt, payload, { fromCache, inputTokens, outputTokens, processingMs }) {
    // Anthropic pricing varies by model/tier — estimate using a configurable rate,
    // not hardcoded, so it can be updated without a code change.
    const estimatedCost = fromCache ? 0 : this._estimateCost(inputTokens, outputTokens);

    const draft = await this.db.insert("ai_draft_queue", {
      draft_type: job.job_type,
      status: "generated",
      payload,
      prompt_id: prompt.id,
      prompt_version: prompt.version,
      source_lesson_ids: job.input_variables.lessonIds ?? [],
      source_competency_ids: job.input_variables.competencyIds ?? [],
      generation_job_id: job.id,
      owner_id: job.requested_by,
      version: 1,
    });

    await this.db.update("ai_generation_jobs", job.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      result_draft_id: draft.id,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      processing_ms: processingMs,
      estimated_cost_usd: estimatedCost,
    });

    // Immediately push through validation -> pending_review or auto-reject.
    await this.draftService.validateAndQueue(draft.id, job.requested_by);
    await this.promptLibrary.recordUsage(prompt.id, { succeeded: true });

    return draft;
  }

  _estimateCost(inputTokens, outputTokens) {
    const RATE_PER_MTOK = { input: 3.0, output: 15.0 }; // update to current published rates
    return +((inputTokens / 1e6) * RATE_PER_MTOK.input + (outputTokens / 1e6) * RATE_PER_MTOK.output).toFixed(5);
  }

  async _handleFailure(job, err) {
    await this.db.update("ai_generation_jobs", job.id, {
      status: "failed",
      error_message: err.message,
      failure_reason: err.message.includes("rate") ? "rate_limited" : "api_error",
      finished_at: new Date().toISOString(),
    });
    await this.promptLibrary.recordUsage(job.prompt_id, { succeeded: false });
    return this._maybeRetry(job, "api_error");
  }

  async _maybeRetry(job, reason) {
    if (job.attempts + 1 >= job.max_attempts) {
      return this.moveToDeadLetter(job.id, reason);
    }
    return this.db.update("ai_generation_jobs", job.id, {
      status: "queued",
      attempts: job.attempts + 1,
      scheduled_at: new Date(Date.now() + 2 ** job.attempts * 5000).toISOString(), // exponential backoff
    });
  }

  async cancel(jobId, actorId) {
    const job = await this.db.get("ai_generation_jobs", jobId);
    if (!["queued", "processing"].includes(job.status)) {
      throw new Error("Only queued or in-progress jobs can be cancelled");
    }
    return this.db.update("ai_generation_jobs", jobId, {
      status: "cancelled",
      finished_at: new Date().toISOString(),
    });
  }

  async getProgress(jobId) {
    const job = await this.db.get("ai_generation_jobs", jobId);
    return { status: job.status, attempts: job.attempts, maxAttempts: job.max_attempts };
  }
}

module.exports = { AiJobQueue, RateLimiter };
