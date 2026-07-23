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
  timestamp: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface AuditAiMetadataRow {
  id: number;
  audit_entry_id: number;
  status: 'PENDING' | 'COMPLETED';
  risk_score: string | number | null;
  risk_level: string | null;
  ai_summary: string | null;
  anomaly_flags: string[];
  semantic_vector: string | null;
  auditor_notes: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface EnrichmentInput {
  timestamp: string;
  eventType: string;
  evidenceId: string;
  entityName: string;
  description: string;
  monetaryImpact: number;
  controlId: string;
}

export interface EnrichmentResult {
  riskScore: number;
  riskLevel: string;
  aiSummary: string;
  anomalyFlags: string[];
}
