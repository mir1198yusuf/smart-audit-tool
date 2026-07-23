import { Request, Response } from 'express';
import { AuditRepository } from '../repositories/AuditRepository.js';
import {
  auditEntryIdParamSchema,
  createAuditEntrySchema,
  listAuditEntriesQuerySchema,
  updateAuditEntrySchema,
} from '../validation/auditEntry.validation.js';

export class AuditController {
  private readonly repository = new AuditRepository();

  create = async (req: Request, res: Response): Promise<void> => {
    const { error, value } = createAuditEntrySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      console.error('[backend:audit] create validation failed:', error.details.map((d) => d.message).join('; '));
      res.status(400).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
      return;
    }

    try {
      const created = await this.repository.create(value);
      console.log(`[backend:audit] created entry id=${created.id}`);
      res.status(201).json(created);
    } catch (err) {
      console.error('[backend:audit] create failed:', err);
      res.status(500).json({ error: 'Failed to create audit entry' });
    }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const { error, value } = listAuditEntriesQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: true });
    if (error) {
      console.error('[backend:audit] list validation failed:', error.details.map((d) => d.message).join('; '));
      res.status(400).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
      return;
    }

    try {
      const result = await this.repository.findAll(value.since?.toISOString());
      res.status(200).json(result);
    } catch (err) {
      console.error('[backend:audit] list failed:', err);
      res.status(500).json({ error: 'Failed to list audit entries' });
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { error: paramError, value: params } = auditEntryIdParamSchema.validate(req.params);
    if (paramError) {
      console.error('[backend:audit] update param validation failed:', paramError.details.map((d) => d.message).join('; '));
      res.status(400).json({ error: 'Validation failed', details: paramError.details.map((d) => d.message) });
      return;
    }

    const { error: bodyError, value: body } = updateAuditEntrySchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (bodyError) {
      console.error('[backend:audit] update body validation failed:', bodyError.details.map((d) => d.message).join('; '));
      res.status(400).json({ error: 'Validation failed', details: bodyError.details.map((d) => d.message) });
      return;
    }

    try {
      const { entry: updated, updateKind } = await this.repository.update(params.id, body);
      if (!updated) {
        console.error(`[backend:audit] update failed: entry id=${params.id} not found`);
        res.status(404).json({ error: 'Audit entry not found' });
        return;
      }
      console.log(
        `[backend:audit] updated entry id=${params.id} kind=${updateKind} (${
          updateKind === 'core' || updateKind === 'core_and_notes'
            ? 'core-field requeue'
            : updateKind === 'notes'
              ? 'auditor-notes fast-track'
              : 'no-op'
        })`,
      );
      res.status(200).json(updated);
    } catch (err) {
      console.error(`[backend:audit] update failed for id=${params.id}:`, err);
      res.status(500).json({ error: 'Failed to update audit entry' });
    }
  };

  similar = async (req: Request, res: Response): Promise<void> => {
    const { error, value: params } = auditEntryIdParamSchema.validate(req.params);
    if (error) {
      console.error('[backend:audit] similar validation failed:', error.details.map((d) => d.message).join('; '));
      res.status(400).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
      return;
    }

    try {
      const result = await this.repository.findSimilar(params.id);
      if (result.outcome === 'not_found') {
        console.log(`[backend:audit] similarity search id=${params.id} outcome=not_found`);
        res.status(404).json({ error: 'Audit entry not found' });
        return;
      }
      if (result.outcome === 'not_ready') {
        console.log(`[backend:audit] similarity search id=${params.id} outcome=not_ready`);
        res.status(409).json({ error: 'Audit entry has not completed AI processing yet' });
        return;
      }
      console.log(`[backend:audit] similarity search id=${params.id} outcome=ok matches=${result.data.length}`);
      res.status(200).json({ similar: result.data });
    } catch (err) {
      console.error(`[backend:audit] similarity search failed for id=${params.id}:`, err);
      res.status(500).json({ error: 'Failed to fetch similar audit entries' });
    }
  };
}
