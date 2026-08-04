/**
 * اقرأ أكثر... ترى أكثر — AI MODULE
 * Prompt Library Service (Phase 10+)
 *
 * Every prompt is versioned and immutable once used — editing a prompt
 * creates a new version rather than mutating history, so past drafts
 * always remain traceable to the exact prompt that generated them.
 */

class PromptLibraryService {
  constructor(db) {
    this.db = db;
  }

  async create({ name, description, draftType, systemPrompt, userPromptTemplate, variables, outputJsonSchema, createdBy }) {
    return this.db.insert("prompt_library", {
      name, description, draft_type: draftType,
      version: 1, is_active: true, is_archived: false,
      system_prompt: systemPrompt,
      user_prompt_template: userPromptTemplate,
      variables, output_json_schema: outputJsonSchema,
      usage_count: 0, success_count: 0, failure_count: 0,
      created_by: createdBy,
    });
  }

  // New version, not a mutation — old version stays queryable for auditing
  // any draft ever produced by it.
  async createNewVersion(promptId, changes, createdBy) {
    const current = await this.db.get("prompt_library", promptId);
    const next = await this.db.insert("prompt_library", {
      ...current,
      id: undefined,
      version: current.version + 1,
      parent_prompt_id: current.id,
      usage_count: 0, success_count: 0, failure_count: 0,
      created_by: createdBy,
      created_at: undefined,
      updated_at: undefined,
      ...changes,
    });
    // Deactivate the old version so generation jobs pick up the new one by default.
    await this.db.update("prompt_library", current.id, { is_active: false });
    return next;
  }

  async clone(promptId, newName, createdBy) {
    const source = await this.db.get("prompt_library", promptId);
    return this.db.insert("prompt_library", {
      ...source,
      id: undefined,
      name: newName,
      version: 1,
      parent_prompt_id: source.id,
      usage_count: 0, success_count: 0, failure_count: 0,
      created_by: createdBy,
      created_at: undefined,
      updated_at: undefined,
    });
  }

  async archive(promptId) {
    return this.db.update("prompt_library", promptId, { is_active: false, is_archived: true });
  }

  async restore(promptId) {
    return this.db.update("prompt_library", promptId, { is_archived: false });
  }

  async compareVersions(nameOrId) {
    const versions = await this.db.query("prompt_library", {
      where: { name: nameOrId },
      orderBy: { version: "asc" },
    });
    return versions.map((v, i) => ({
      version: v.version,
      systemPromptChanged: i > 0 ? v.system_prompt !== versions[i - 1].system_prompt : false,
      templateChanged: i > 0 ? v.user_prompt_template !== versions[i - 1].user_prompt_template : false,
      successRate: v.usage_count ? +(v.success_count / v.usage_count * 100).toFixed(1) : null,
    }));
  }

  async exportPrompt(promptId) {
    const p = await this.db.get("prompt_library", promptId);
    // Strip internal counters/ids so exports are safe to import elsewhere.
    const { id, created_by, created_at, updated_at, usage_count, success_count, failure_count, ...portable } = p;
    return JSON.stringify(portable, null, 2);
  }

  async importPrompt(jsonString, createdBy) {
    const parsed = JSON.parse(jsonString);
    const required = ["name", "draft_type", "system_prompt", "user_prompt_template", "output_json_schema"];
    const missing = required.filter((f) => !parsed[f]);
    if (missing.length) throw new Error(`Import missing required fields: ${missing.join(", ")}`);
    return this.db.insert("prompt_library", {
      ...parsed,
      version: 1, is_active: true, is_archived: false,
      usage_count: 0, success_count: 0, failure_count: 0,
      created_by: createdBy,
    });
  }

  // Called by the job processor after every generation attempt.
  async recordUsage(promptId, { succeeded }) {
    const p = await this.db.get("prompt_library", promptId);
    return this.db.update("prompt_library", promptId, {
      usage_count: p.usage_count + 1,
      success_count: p.success_count + (succeeded ? 1 : 0),
      failure_count: p.failure_count + (succeeded ? 0 : 1),
    });
  }

  async getActivePrompt(draftType) {
    const [active] = await this.db.query("prompt_library", {
      where: { draft_type: draftType, is_active: true, is_archived: false },
      limit: 1,
    });
    if (!active) throw new Error(`No active prompt configured for type: ${draftType}`);
    return active;
  }

  // -------------------------------------------------------------------
  // PROMPT ENGINEERING CENTER — testing, benchmarking, rollback
  // -------------------------------------------------------------------

  /**
   * Run a prompt against a sample input WITHOUT touching the live job
   * queue or usage_count — this is a sandbox for the Owner to try changes
   * before activating a new version.
   */
  async testPrompt(promptId, testInput, { anthropicClient, validator, runBy }) {
    const prompt = await this.db.get("prompt_library", promptId);
    const filled = Object.entries(testInput).reduce(
      (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, typeof v === "string" ? v : JSON.stringify(v)),
      prompt.user_prompt_template
    );

    const start = Date.now();
    const response = await anthropicClient.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: prompt.system_prompt,
      messages: [{ role: "user", content: filled }],
    });
    const latencyMs = Date.now() - start;
    const rawText = response.content.find((c) => c.type === "text")?.text ?? "{}";
    let output, passedValidation = false, validationErrors = [];

    try {
      output = JSON.parse(rawText.replace(/```json|```/g, "").trim());
      const result = await validator.validate({ draft_type: prompt.draft_type, payload: output, output_json_schema: prompt.output_json_schema, source_lesson_ids: [] });
      passedValidation = result.passed;
      validationErrors = result.errors;
    } catch (e) {
      validationErrors = [{ code: "unparseable_output", message: e.message }];
    }

    return this.db.insert("prompt_test_runs", {
      prompt_id: promptId,
      test_input: testInput,
      output,
      passed_validation: passedValidation,
      validation_errors: validationErrors,
      latency_ms: latencyMs,
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      run_by: runBy,
    });
  }

  /**
   * Benchmark: run the SAME test input against every version of a named
   * prompt, so the Owner can see which version performs best before
   * deciding which to activate.
   */
  async benchmarkVersions(promptName, testInput, { anthropicClient, validator, runBy }) {
    const versions = await this.db.query("prompt_library", { where: { name: promptName } });
    const runs = [];
    for (const v of versions) {
      const run = await this.testPrompt(v.id, testInput, { anthropicClient, validator, runBy });
      runs.push({ version: v.version, ...run });
    }
    return runs.sort((a, b) => a.version - b.version);
  }

  /** Rollback: reactivate a previous version and deactivate the current one. */
  async rollback(promptId, actorId) {
    const target = await this.db.get("prompt_library", promptId);
    const siblings = await this.db.query("prompt_library", { where: { name: target.name, is_active: true } });
    for (const s of siblings) {
      await this.db.update("prompt_library", s.id, { is_active: false });
    }
    return this.db.update("prompt_library", promptId, { is_active: true, is_archived: false });
  }

  async setCategory(promptId, category) {
    return this.db.update("prompt_library", promptId, { category });
  }

  async setTags(promptId, tags) {
    return this.db.update("prompt_library", promptId, { tags });
  }

  async listByCategory(category) {
    return this.db.query("prompt_library", { where: { category, is_archived: false } });
  }

  async getTestHistory(promptId) {
    return this.db.query("prompt_test_runs", { where: { prompt_id: promptId }, orderBy: { created_at: "desc" } });
  }
}

module.exports = { PromptLibraryService };
