// ===== api response types =====
// What the backend actually sends back over the wire (camelCase, JSON-serialized).

export type AiStatus = 'PENDING' | 'COMPLETED';

export interface AiMetadata {
  status: AiStatus;
  riskScore: number | null;
  riskLevel: string | null;
  aiSummary: string | null;
  anomalyFlags: string[];
  auditorNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: number;
  eventType: string;
  evidenceId: string;
  entityName: string;
  description: string;
  monetaryImpact: number;
  controlId: string;
  actorUserId: string;
  tenantId: string;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
  aiMetadata: AiMetadata;
}

export interface SimilarAuditEntry extends AuditEntry {
  similarityScore: number;
}

export interface AuditEntriesResponse {
  data: AuditEntry[];
  polledAt: string;
}

export interface SimilarEntriesResponse {
  similar: SimilarAuditEntry[];
}

// ===== req body types =====
// Shapes sent from the client to the backend (POST/PUT bodies).

export interface NewAuditEntryPayload {
  eventType: string;
  evidenceId: string;
  entityName: string;
  description: string;
  monetaryImpact: number;
  controlId: string;
  actorUserId: string;
  tenantId: string;
  timestamp: string;
}

export interface AuditEntryUpdatePayload {
  monetaryImpact?: number;
  description?: string;
  controlId?: string;
  auditorNotes?: string;
}

// ===== ui form types =====
// Not a wire type — the local edit-modal form shape. All 4 fields are always present
// (non-optional), unlike AuditEntryUpdatePayload's optional-partial shape.

export interface EditForm {
  monetaryImpact: number;
  description: string;
  controlId: string;
  auditorNotes: string;
}
