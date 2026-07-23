// ===== req body type =====
// Post-Joi-validation shapes for incoming requests (camelCase, JS-native types).

export interface CreateAuditEntryInput {
  eventType: string;
  evidenceId: string;
  entityName: string;
  description: string;
  monetaryImpact: number;
  controlId: string;
  actorUserId: string;
  tenantId: string;
  // Joi.date() converts the incoming ISO string to a Date instance on validation.
  timestamp: Date;
}

export interface UpdateAuditEntryInput {
  monetaryImpact?: number;
  description?: string;
  controlId?: string;
  auditorNotes?: string;
}

export interface ListAuditEntriesQuery {
  since?: Date;
}

export interface AuditEntryIdParam {
  id: number;
}

// ===== db response type =====
// One row from a single table, snake_case, matching Postgres column names/types exactly.
// numeric/decimal columns come back as `string | number` — the pg driver returns them as
// strings to avoid float precision loss, not always as JS numbers.

export interface AuditEntryRow {
  id: number;
  event_type: string;
  evidence_id: string;
  entity_name: string;
  description: string;
  monetary_impact: string | number;
  control_id: string;
  actor_user_id: string;
  tenant_id: string;
  timestamp: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AiMetadataRow {
  id: number;
  audit_entry_id: number;
  status: string;
  risk_score: string | number | null;
  risk_level: string | null;
  ai_summary: string | null;
  anomaly_flags: string[];
  semantic_vector: string | null;
  auditor_notes: string;
  created_at: Date | string;
  updated_at: Date | string;
}

// ===== api response types =====
// What actually gets JSON-serialized back to the client (camelCase).

export interface AiMetadataApi {
  status: string;
  riskScore: string | number | null;
  riskLevel: string | null;
  aiSummary: string | null;
  anomalyFlags: string[];
  auditorNotes: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface AuditEntryApi {
  id: number;
  eventType: string;
  evidenceId: string;
  entityName: string;
  description: string;
  monetaryImpact: string | number;
  controlId: string;
  actorUserId: string;
  tenantId: string;
  timestamp: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  aiMetadata: AiMetadataApi;
}

export interface SimilarAuditEntryApi extends AuditEntryApi {
  similarityScore: number;
}

export interface AuditEntriesListResult {
  data: AuditEntryApi[];
  polledAt: string;
}

// Not a wire type — an internal repository→controller contract so the controller can decide
// 404 vs 409 vs 200 without magic null/[] sentinels. `not_ready` = record exists but hasn't
// completed AI processing yet (status != COMPLETED), distinct from `not_found` (no such record).
export type FindSimilarResult =
  | { outcome: 'not_found' }
  | { outcome: 'not_ready' }
  | { outcome: 'ok'; data: SimilarAuditEntryApi[] };

// ===== repo mapper type =====
// Row shape for queries that JOIN audit_entries + audit_ai_metadata in one round trip. Both
// tables have id/created_at/updated_at, so the ai_metadata side is aliased to avoid collision.
// splitJoinedRow/mapJoinedRow (auditEntry.mapper.ts) convert this into AuditEntryApi.

export interface JoinedAuditEntryRow {
  id: number;
  event_type: string;
  evidence_id: string;
  entity_name: string;
  description: string;
  monetary_impact: string | number;
  control_id: string;
  actor_user_id: string;
  tenant_id: string;
  timestamp: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  ai_metadata_id: number;
  status: string;
  risk_score: string | number | null;
  risk_level: string | null;
  ai_summary: string | null;
  anomaly_flags: string[];
  auditor_notes: string;
  ai_metadata_created_at: Date | string;
  ai_metadata_updated_at: Date | string;
}

export interface SimilarAuditEntryRow extends JoinedAuditEntryRow {
  similarity_score: string | number;
}
