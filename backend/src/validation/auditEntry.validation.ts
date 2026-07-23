import Joi from 'joi';
import {
  AuditEntryIdParam,
  CreateAuditEntryInput,
  ListAuditEntriesQuery,
  UpdateAuditEntryInput,
} from '../types/auditEntry.types.js';

// Baseline evidence only — AI metadata and DB-generated fields (id, createdAt, updatedAt)
// are never accepted from the client (see docs/backend.md).
export const createAuditEntrySchema = Joi.object<CreateAuditEntryInput>({
  eventType: Joi.string().trim().min(1).max(255).required(),
  evidenceId: Joi.string().trim().min(1).max(255).required(),
  entityName: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().min(1).required(),
  monetaryImpact: Joi.number().required(),
  controlId: Joi.string().trim().min(1).max(255).required(),
  actorUserId: Joi.string().trim().min(1).max(255).required(),
  tenantId: Joi.string().trim().min(1).max(255).required(),
  timestamp: Joi.date().iso().required(),
}).required();

// Delta update: any subset of the core fields and/or auditorNotes, at least one key.
export const updateAuditEntrySchema = Joi.object<UpdateAuditEntryInput>({
  monetaryImpact: Joi.number(),
  description: Joi.string().trim().min(1),
  controlId: Joi.string().trim().min(1).max(255),
  auditorNotes: Joi.string().trim().allow(''),
})
  .min(1)
  .required();

// No `since` = full initial load. `since` present = only rows updated after it (delta poll).
export const listAuditEntriesQuerySchema = Joi.object<ListAuditEntriesQuery>({
  since: Joi.date().iso(),
});

export const auditEntryIdParamSchema = Joi.object<AuditEntryIdParam>({
  id: Joi.number().integer().min(1).required(),
});
