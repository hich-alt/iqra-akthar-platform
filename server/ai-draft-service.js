/**
 * اقرأ أكثر... ترى أكثر — AI MODULE
 * Draft Lifecycle Service (Phase 10+)
 *
 * Enforces: Generated -> Pending Review -> Approved -> Published
 *                                       -> Rejected -> (restorable)
 *                                       -> Archived  -> (restorable)
 *
 * Every transition is written to ai_draft_audit_log. No transition is allowed
 * to skip validation. Nothing reaches "published" without an explicit
 * Owner-authored approve() + publish() call.
 *
 * This file assumes a Supabase client `db` and is written against the
 * schema in ai-module-schema.sql.
 */

const VALID_TRANSITIONS = {
  generated:       ["pending_review", "rejected"],           // validation outcome
  pending_review:  ["approved", "rejected"],
  approved:        ["published", "archived"],
  published:       ["archived"],
  rejected:        ["pending_review", "archived"],           // restore
  archived:        ["pending_review"],                        // restore
};

class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Cannot transition draft from '${from}' to '${to}'`);
    this.name = "InvalidTransitionError";
  }
}

class AiDraftService {
  constructor(db, { auditLog, versionStore, validator, publisher }) {
    this.db = db;
    this.auditLog = auditLog;
    this.versionStore = versionStore;
    this.validator = validator;   // see ai-validation.js
    this.publisher = publisher;   // knows how to write into quiz_questions, revision_plans, etc.
  }

  // ---------------------------------------------------------------------
  // TRANSITION CORE
  // ---------------------------------------------------------------------

  async _transition(draftId, toStatus, { actorId, action, reason, metadata = {} }) {
    const draft = await this.db.get("ai_draft_queue", draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);

    const allowed = VALID_TRANSITIONS[draft.status] || [];
    if (!allowed.includes(toStatus)) {
      throw new InvalidTransitionError(draft.status, toStatus);
    }

    const updated = await this.db.update("ai_draft_queue", draftId, { status: toStatus });

    await this.auditLog.record({
      draftId,
      fromStatus: draft.status,
      toStatus,
      action,
      actorId,
      reason: reason ?? null,
      metadata,
    });

    await this.versionStore.snapshot(draftId, {
      version: draft.version,
      payload: draft.payload,
      statusAtSnapshot: toStatus,
      createdBy: actorId,
    });

    return updated;
  }

  // ---------------------------------------------------------------------
  // GENERATION -> VALIDATION (automatic, no human step)
  // ---------------------------------------------------------------------

  async validateAndQueue(draftId, actorId) {
    const draft = await this.db.get("ai_draft_queue", draftId);
    const result = await this.validator.validate(draft);

    await this.db.update("ai_draft_queue", draftId, {
      validation_result: result.passed ? "passed" : "failed",
      validation_errors: result.errors,
    });

    if (!result.passed) {
      // Automatic rejection — invalid generations never reach a human reviewer.
      return this._transition(draftId, "rejected", {
        actorId,
        action: "auto_reject_validation_failed",
        reason: result.errors.map((e) => e.message).join("; "),
        metadata: { errors: result.errors },
      });
    }

    return this._transition(draftId, "pending_review", {
      actorId,
      action: "validate",
    });
  }

  // ---------------------------------------------------------------------
  // OWNER DECISIONS
  // ---------------------------------------------------------------------

  async approve(draftId, ownerId, reason) {
    return this._transition(draftId, "approved", {
      actorId: ownerId,
      action: "approve",
      reason,
    });
  }

  async reject(draftId, ownerId, reason) {
    if (!reason) throw new Error("A rejection reason is required for audit purposes");
    return this._transition(draftId, "rejected", {
      actorId: ownerId,
      action: "reject",
      reason,
    });
  }

  async publish(draftId, ownerId) {
    const draft = await this.db.get("ai_draft_queue", draftId);
    if (draft.status !== "approved") {
      throw new Error("Only approved drafts can be published");
    }

    // Publisher writes into the real domain table (quiz_questions, revision_plans, ...)
    const { entityId, entityTable } = await this.publisher.publish(draft);

    await this.db.update("ai_draft_queue", draftId, {
      published_entity_id: entityId,
      published_entity_table: entityTable,
    });

    return this._transition(draftId, "published", {
      actorId: ownerId,
      action: "publish",
      metadata: { entityId, entityTable },
    });
  }

  async archive(draftId, ownerId, reason) {
    return this._transition(draftId, "archived", { actorId: ownerId, action: "archive", reason });
  }

  async restore(draftId, ownerId, reason) {
    const draft = await this.db.get("ai_draft_queue", draftId);
    if (!["rejected", "archived"].includes(draft.status)) {
      throw new Error("Only rejected or archived drafts can be restored");
    }
    return this._transition(draftId, "pending_review", {
      actorId: ownerId,
      action: "restore",
      reason,
    });
  }

  // ---------------------------------------------------------------------
  // BULK OPERATIONS — each item still gets its own audit row
  // ---------------------------------------------------------------------

  async bulkApprove(draftIds, ownerId, reason) {
    const results = await Promise.allSettled(
      draftIds.map((id) => this.approve(id, ownerId, reason))
    );
    return this._summarizeBulk(draftIds, results, "bulk_approve");
  }

  async bulkReject(draftIds, ownerId, reason) {
    if (!reason) throw new Error("A rejection reason is required for bulk rejection");
    const results = await Promise.allSettled(
      draftIds.map((id) => this.reject(id, ownerId, reason))
    );
    return this._summarizeBulk(draftIds, results, "bulk_reject");
  }

  _summarizeBulk(ids, results, action) {
    const succeeded = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") succeeded.push(ids[i]);
      else failed.push({ id: ids[i], error: r.reason.message });
    });
    return { action, succeeded, failed };
  }

  // ---------------------------------------------------------------------
  // DUPLICATION / VERSIONING
  // ---------------------------------------------------------------------

  async duplicate(draftId, actorId) {
    const original = await this.db.get("ai_draft_queue", draftId);
    const copy = await this.db.insert("ai_draft_queue", {
      ...original,
      id: undefined,               // let DB generate a new id
      status: "generated",
      version: 1,
      parent_draft_id: draftId,
      published_entity_id: null,
      published_entity_table: null,
      created_at: undefined,
      updated_at: undefined,
    });

    await this.auditLog.record({
      draftId: copy.id,
      fromStatus: null,
      toStatus: "generated",
      action: "duplicate",
      actorId,
      metadata: { sourceDraftId: draftId },
    });

    return copy;
  }

  async compareVersions(draftId, versionA, versionB) {
    const [a, b] = await Promise.all([
      this.versionStore.get(draftId, versionA),
      this.versionStore.get(draftId, versionB),
    ]);
    return { a, b, diff: this._diffPayloads(a.payload, b.payload) };
  }

  _diffPayloads(a, b) {
    // Shallow structural diff sufficient for JSON draft payloads;
    // swap for a proper deep-diff library (e.g. `deep-diff`) in production.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const diff = {};
    for (const key of keys) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        diff[key] = { before: a[key], after: b[key] };
      }
    }
    return diff;
  }

  // ---------------------------------------------------------------------
  // SEARCH / FILTER
  // ---------------------------------------------------------------------

  async search({ ownerId, status, draftType, tags, favoritesOnly, textQuery, limit = 50, offset = 0 }) {
    return this.db.query("ai_draft_queue", {
      where: {
        owner_id: ownerId,
        ...(status ? { status } : {}),
        ...(draftType ? { draft_type: draftType } : {}),
        ...(tags?.length ? { tags_overlap: tags } : {}),
        ...(favoritesOnly ? { is_favorite: true } : {}),
        ...(textQuery ? { payload_ilike: textQuery } : {}),
      },
      orderBy: { created_at: "desc" },
      limit,
      offset,
    });
  }

  async setFavorite(draftId, isFavorite) {
    return this.db.update("ai_draft_queue", draftId, { is_favorite: isFavorite });
  }

  async setTags(draftId, tags) {
    return this.db.update("ai_draft_queue", draftId, { tags });
  }
}

module.exports = { AiDraftService, InvalidTransitionError, VALID_TRANSITIONS };
