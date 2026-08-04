/**
 * اقرأ أكثر... ترى أكثر — AI MODULE
 * Cost & Operations Monitoring (Phase 10+)
 *
 * Surfaces on the Owner Dashboard. Builds on ai_usage_analytics (schema)
 * with queries the materialized view doesn't cover: cache efficiency,
 * retry behavior, and queue latency — all needed to catch a misbehaving
 * prompt or a runaway job before it becomes a real cost problem.
 */

class AiCostMonitor {
  constructor(db) {
    this.db = db;
  }

  async dailyUsage(days = 30) {
    return this.db.query("ai_usage_analytics", { orderBy: { day: "desc" }, limit: days });
  }

  async monthlyCostEstimate(year, month) {
    const rows = await this.db.query("ai_generation_jobs", {
      where: { finished_between: [`${year}-${String(month).padStart(2, "0")}-01`, `${year}-${String(month).padStart(2, "0")}-31`] },
    });
    return rows.reduce((sum, r) => sum + (r.estimated_cost_usd ?? 0), 0);
  }

  async cacheHitRate(sinceDays = 7) {
    const jobs = await this.db.query("ai_generation_jobs", { where: { status: "succeeded", created_after_days: sinceDays } });
    const cacheHits = jobs.filter((j) => j.input_tokens === 0 && j.output_tokens === 0).length;
    return jobs.length ? +(cacheHits / jobs.length * 100).toFixed(1) : null;
  }

  async retryRate(sinceDays = 7) {
    const jobs = await this.db.query("ai_generation_jobs", { where: { created_after_days: sinceDays } });
    const retried = jobs.filter((j) => j.attempts > 0).length;
    return jobs.length ? +(retried / jobs.length * 100).toFixed(1) : null;
  }

  async failureBreakdown(sinceDays = 7) {
    const jobs = await this.db.query("ai_generation_jobs", { where: { status: "failed", created_after_days: sinceDays } });
    const byReason = {};
    for (const j of jobs) byReason[j.failure_reason ?? "unknown"] = (byReason[j.failure_reason ?? "unknown"] || 0) + 1;
    return byReason;
  }

  async averageQueueWaitTime(sinceDays = 7) {
    const jobs = await this.db.query("ai_generation_jobs", { where: { status: "succeeded", created_after_days: sinceDays } });
    const waits = jobs
      .filter((j) => j.started_at && j.scheduled_at)
      .map((j) => (new Date(j.started_at) - new Date(j.scheduled_at)) / 1000);
    return waits.length ? +(waits.reduce((a, b) => a + b, 0) / waits.length).toFixed(1) : null;
  }

  async averageResponseTime(sinceDays = 7) {
    const jobs = await this.db.query("ai_generation_jobs", { where: { status: "succeeded", created_after_days: sinceDays } });
    const times = jobs.map((j) => j.processing_ms).filter(Boolean);
    return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  }

  async deadLetterCount(sinceDays = 30) {
    const rows = await this.db.query("ai_dead_letter_jobs", { where: { created_after_days: sinceDays } });
    return rows.length;
  }

  /** Composite snapshot for the Owner Dashboard cost widget. */
  async dashboardSnapshot() {
    const [daily, cacheHitRate, retryRate, failures, queueWait, responseTime, deadLetters] = await Promise.all([
      this.dailyUsage(7),
      this.cacheHitRate(),
      this.retryRate(),
      this.failureBreakdown(),
      this.averageQueueWaitTime(),
      this.averageResponseTime(),
      this.deadLetterCount(),
    ]);
    return {
      last7Days: daily,
      cacheHitRatePct: cacheHitRate,
      retryRatePct: retryRate,
      failureBreakdown: failures,
      avgQueueWaitSeconds: queueWait,
      avgResponseTimeMs: responseTime,
      deadLetterJobsLast30Days: deadLetters,
    };
  }
}

module.exports = { AiCostMonitor };
