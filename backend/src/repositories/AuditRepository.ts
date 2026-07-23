import db from '../db.js';
import { mapEntryWithAiMetadata, mapJoinedRow } from './auditEntry.mapper.js';
import {
  AiMetadataRow,
  AuditEntriesListResult,
  AuditEntryApi,
  AuditEntryRow,
  CreateAuditEntryInput,
  FindSimilarResult,
  JoinedAuditEntryRow,
  SimilarAuditEntryRow,
  UpdateAuditEntryInput,
} from '../types/auditEntry.types.js';

interface CoreFieldDelta {
  monetary_impact?: number;
  description?: string;
  control_id?: string;
}

export type UpdateKind = 'none' | 'core' | 'notes' | 'core_and_notes';

export interface UpdateOutcome {
  entry: AuditEntryApi | null;
  updateKind: UpdateKind;
}

// Shared select list for `audit_entries` INNER JOIN `audit_ai_metadata`, aliasing the
// ai_metadata side's colliding column names (id/created_at/updated_at). One round trip instead
// of fetching each table separately and zipping them in JS.
const JOINED_COLUMNS = [
  'ae.id',
  'ae.event_type',
  'ae.evidence_id',
  'ae.entity_name',
  'ae.description',
  'ae.monetary_impact',
  'ae.control_id',
  'ae.actor_user_id',
  'ae.tenant_id',
  'ae.timestamp',
  'ae.created_at',
  'ae.updated_at',
  'am.id as ai_metadata_id',
  'am.status',
  'am.risk_score',
  'am.risk_level',
  'am.ai_summary',
  'am.anomaly_flags',
  'am.auditor_notes',
  'am.created_at as ai_metadata_created_at',
  'am.updated_at as ai_metadata_updated_at',
];

export class AuditRepository {
  async create(payload: CreateAuditEntryInput): Promise<AuditEntryApi> {
    const trx = await db.transaction();

    try {
      const [entry] = await trx<AuditEntryRow>('audit_entries')
        .insert({
          event_type: payload.eventType,
          evidence_id: payload.evidenceId,
          entity_name: payload.entityName,
          description: payload.description,
          monetary_impact: payload.monetaryImpact,
          control_id: payload.controlId,
          actor_user_id: payload.actorUserId,
          tenant_id: payload.tenantId,
          timestamp: payload.timestamp,
        })
        .returning('*');

      const [aiMetadata] = await trx<AiMetadataRow>('audit_ai_metadata')
        .insert({
          audit_entry_id: entry.id,
          status: 'PENDING',
        })
        .returning('*');

      return mapEntryWithAiMetadata(entry, aiMetadata);
    } catch (err) {
      await trx.rollback();
      throw err;
    } finally {
      if (!trx.isCompleted()) {
        await trx.commit();
      }
    }
  }

  // No `since` = full list (initial load). `since` given = only rows where either table's
  // updated_at is newer (new entries, core-field edits, notes edits, or worker completions all
  // bump one table or the other). Demo: no tenant isolation — lists across all tenants. One query
  // either way — the join is always present, `since` just adds a filter on top of it.
  async findAll(since?: string): Promise<AuditEntriesListResult> {
    const polledAt = new Date().toISOString();

    const query = db<JoinedAuditEntryRow>('audit_entries as ae')
      .innerJoin('audit_ai_metadata as am', 'am.audit_entry_id', 'ae.id')
      .select(JOINED_COLUMNS)
      .orderBy('ae.created_at', 'desc');

    if (since) {
      query.where((qb) => qb.where('ae.updated_at', '>', since).orWhere('am.updated_at', '>', since));
    }

    const rows = await query;

    return {
      data: rows.map(mapJoinedRow),
      polledAt,
    };
  }

  async findById(id: number): Promise<AuditEntryApi | null> {
    const row = await db<JoinedAuditEntryRow>('audit_entries as ae')
      .innerJoin('audit_ai_metadata as am', 'am.audit_entry_id', 'ae.id')
      .where('ae.id', id)
      .select(JOINED_COLUMNS)
      .first();

    return row ? mapJoinedRow(row) : null;
  }

  async update(id: number, changes: UpdateAuditEntryInput): Promise<UpdateOutcome> {
    const currentEntry = await db<AuditEntryRow>('audit_entries').where({ id }).first();
    if (!currentEntry) return { entry: null, updateKind: 'none' };

    const currentAiMetadata = await db<AiMetadataRow>('audit_ai_metadata')
      .where({ audit_entry_id: id })
      .first();
    if (!currentAiMetadata) return { entry: null, updateKind: 'none' };

    const coreDelta: CoreFieldDelta = {};
    if (changes.monetaryImpact !== undefined && Number(changes.monetaryImpact) !== Number(currentEntry.monetary_impact)) {
      coreDelta.monetary_impact = changes.monetaryImpact;
    }
    if (changes.description !== undefined && changes.description !== currentEntry.description) {
      coreDelta.description = changes.description;
    }
    if (changes.controlId !== undefined && changes.controlId !== currentEntry.control_id) {
      coreDelta.control_id = changes.controlId;
    }
    const hasCoreChange = Object.keys(coreDelta).length > 0;

    const hasNotesChange =
      changes.auditorNotes !== undefined && changes.auditorNotes !== currentAiMetadata.auditor_notes;

    if (!hasCoreChange && !hasNotesChange) {
      return { entry: mapEntryWithAiMetadata(currentEntry, currentAiMetadata), updateKind: 'none' };
    }

    let updateKind: UpdateKind;
    if (hasCoreChange && !hasNotesChange) {
      await this.applyCoreFieldUpdate(id, coreDelta);
      updateKind = 'core';
    } else if (!hasCoreChange && hasNotesChange) {
      await this.applyAuditorNotesUpdate(id, changes.auditorNotes as string);
      updateKind = 'notes';
    } else {
      await this.applyCoreAndNotesUpdate(id, coreDelta, changes.auditorNotes as string);
      updateKind = 'core_and_notes';
    }

    return { entry: await this.findById(id), updateKind };
  }

  private async applyCoreFieldUpdate(id: number, coreDelta: CoreFieldDelta): Promise<void> {
    const trx = await db.transaction();

    try {
      await trx<AuditEntryRow>('audit_entries').where({ id }).update({ ...coreDelta, updated_at: trx.fn.now() });
      await trx<AiMetadataRow>('audit_ai_metadata')
        .where({ audit_entry_id: id })
        .update({ status: 'PENDING', updated_at: trx.fn.now() });
    } catch (err) {
      await trx.rollback();
      throw err;
    } finally {
      if (!trx.isCompleted()) {
        await trx.commit();
      }
    }
  }

  private async applyAuditorNotesUpdate(id: number, auditorNotes: string): Promise<void> {
    // Single-statement UPDATE — intentionally not wrapped in a transaction, per docs/backend.md
    // ("immediate, atomic UPDATE"); a lone statement is already atomic.
    await db<AiMetadataRow>('audit_ai_metadata')
      .where({ audit_entry_id: id })
      .update({ auditor_notes: auditorNotes, updated_at: db.fn.now() });
  }

  private async applyCoreAndNotesUpdate(id: number, coreDelta: CoreFieldDelta, auditorNotes: string): Promise<void> {
    const trx = await db.transaction();

    try {
      await trx<AuditEntryRow>('audit_entries').where({ id }).update({ ...coreDelta, updated_at: trx.fn.now() });
      await trx<AiMetadataRow>('audit_ai_metadata')
        .where({ audit_entry_id: id })
        .update({ auditor_notes: auditorNotes, status: 'PENDING', updated_at: trx.fn.now() });
    } catch (err) {
      await trx.rollback();
      throw err;
    } finally {
      if (!trx.isCompleted()) {
        await trx.commit();
      }
    }
  }

  async findSimilar(id: number): Promise<FindSimilarResult> {
    // Demo: similarity search is not tenant-scoped — matches can come from any tenant.
    const target = await db<AiMetadataRow>('audit_ai_metadata')
      .where({ audit_entry_id: id })
      .select('status', 'semantic_vector')
      .first();

    if (!target) return { outcome: 'not_found' };
    if (target.status !== 'COMPLETED' || !target.semantic_vector) return { outcome: 'not_ready' };

    const result = await db.raw<{ rows: SimilarAuditEntryRow[] }>(
      `
      SELECT
        ae.id, ae.event_type, ae.evidence_id, ae.entity_name, ae.description,
        ae.monetary_impact, ae.control_id, ae.actor_user_id, ae.tenant_id,
        ae.timestamp, ae.created_at, ae.updated_at,
        am.id AS ai_metadata_id, am.status, am.risk_score, am.risk_level,
        am.ai_summary, am.anomaly_flags, am.auditor_notes,
        am.created_at AS ai_metadata_created_at, am.updated_at AS ai_metadata_updated_at,
        1 - (am.semantic_vector <=> ?) AS similarity_score
      FROM audit_ai_metadata am
      JOIN audit_entries ae ON ae.id = am.audit_entry_id
      WHERE am.status = 'COMPLETED'
        AND am.semantic_vector IS NOT NULL
        AND ae.id != ?
      ORDER BY am.semantic_vector <=> ?
      LIMIT 3
      `,
      [target.semantic_vector, id, target.semantic_vector],
    );

    return {
      outcome: 'ok',
      data: result.rows.map((row) => ({
        ...mapJoinedRow(row),
        similarityScore: Number(row.similarity_score),
      })),
    };
  }
}
