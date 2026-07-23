import {
  AiMetadataApi,
  AiMetadataRow,
  AuditEntryApi,
  AuditEntryRow,
  JoinedAuditEntryRow,
} from '../types/auditEntry.types.js';

export function mapEntryRow(row: AuditEntryRow): Omit<AuditEntryApi, 'aiMetadata'> {
  return {
    id: row.id,
    eventType: row.event_type,
    evidenceId: row.evidence_id,
    entityName: row.entity_name,
    description: row.description,
    monetaryImpact: row.monetary_impact,
    controlId: row.control_id,
    actorUserId: row.actor_user_id,
    tenantId: row.tenant_id,
    timestamp: row.timestamp,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAiMetadataRow(row: AiMetadataRow): AiMetadataApi {
  return {
    status: row.status,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    aiSummary: row.ai_summary,
    anomalyFlags: row.anomaly_flags,
    auditorNotes: row.auditor_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEntryWithAiMetadata(entryRow: AuditEntryRow, aiMetadataRow: AiMetadataRow): AuditEntryApi {
  return {
    ...mapEntryRow(entryRow),
    aiMetadata: mapAiMetadataRow(aiMetadataRow),
  };
}

// Splits one flat joined row back into the two typed shapes the rest of the mapper already
// understands, so joined-query call sites can reuse mapEntryWithAiMetadata instead of a
// duplicate mapper. `semantic_vector` isn't selected in the join (unused by AiMetadataApi), so
// it's filled with `null` here — never actually read downstream.
export function splitJoinedRow(row: JoinedAuditEntryRow): { entry: AuditEntryRow; aiMetadata: AiMetadataRow } {
  return {
    entry: {
      id: row.id,
      event_type: row.event_type,
      evidence_id: row.evidence_id,
      entity_name: row.entity_name,
      description: row.description,
      monetary_impact: row.monetary_impact,
      control_id: row.control_id,
      actor_user_id: row.actor_user_id,
      tenant_id: row.tenant_id,
      timestamp: row.timestamp,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    aiMetadata: {
      id: row.ai_metadata_id,
      audit_entry_id: row.id,
      status: row.status,
      risk_score: row.risk_score,
      risk_level: row.risk_level,
      ai_summary: row.ai_summary,
      anomaly_flags: row.anomaly_flags,
      semantic_vector: null,
      auditor_notes: row.auditor_notes,
      created_at: row.ai_metadata_created_at,
      updated_at: row.ai_metadata_updated_at,
    },
  };
}

export function mapJoinedRow(row: JoinedAuditEntryRow): AuditEntryApi {
  const { entry, aiMetadata } = splitJoinedRow(row);
  return mapEntryWithAiMetadata(entry, aiMetadata);
}
