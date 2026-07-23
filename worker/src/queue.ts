import type { Knex } from 'knex';
import db from './db.js';
import type { AuditAiMetadataRow, AuditEntryRow } from './types.js';

export interface ClaimedRecord {
  trx: Knex.Transaction;
  entry: AuditEntryRow;
  metadata: AuditAiMetadataRow;
}

export async function claimPendingRecord(): Promise<ClaimedRecord | null> {
  const trx = await db.transaction();

  const metadata = await trx<AuditAiMetadataRow>('audit_ai_metadata')
    .where({ status: 'PENDING' })
    .orderBy('created_at', 'asc')
    .forUpdate()
    .skipLocked()
    .first();

  if (!metadata) {
    await trx.commit();
    return null;
  }

  const entry = await trx<AuditEntryRow>('audit_entries')
    .where({ id: metadata.audit_entry_id })
    .first();

  if (!entry) {
    await trx.rollback();
    throw new Error(
      `audit_entries row ${metadata.audit_entry_id} missing for audit_ai_metadata ${metadata.id}`
    );
  }

  return { trx, entry, metadata };
}
