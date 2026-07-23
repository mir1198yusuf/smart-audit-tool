import { fetchAnomalyFlagNames, insertNewAnomalyFlags } from './anomalyFlags.js';
import { buildEmbeddingInput, runEmbedding, runEnrichment } from './gemini.js';
import type { ClaimedRecord } from './queue.js';
import { withRateLimitRetry } from './rateLimit.js';
import type { AuditEntryRow, EnrichmentInput } from './types.js';

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toEnrichmentInput(entry: AuditEntryRow): EnrichmentInput {
  return {
    timestamp: toIsoString(entry.timestamp),
    eventType: entry.event_type,
    evidenceId: entry.evidence_id,
    entityName: entry.entity_name,
    description: entry.description,
    monetaryImpact: Number(entry.monetary_impact),
    controlId: entry.control_id,
  };
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

export async function processClaimedRecord({ trx, entry, metadata }: ClaimedRecord): Promise<void> {
  const logPrefix = `[worker] audit_entries.id=${entry.id}: `;

  try {
    const knownFlags = await fetchAnomalyFlagNames(trx);

    const enrichment = await withRateLimitRetry(
      () => runEnrichment(toEnrichmentInput(entry), knownFlags, logPrefix),
      logPrefix
    );

    await insertNewAnomalyFlags(trx, enrichment.anomalyFlags, knownFlags);

    const embeddingInput = buildEmbeddingInput({
      eventType: entry.event_type,
      controlId: entry.control_id,
      anomalyFlags: enrichment.anomalyFlags,
      aiSummary: enrichment.aiSummary,
    });

    const vector = await withRateLimitRetry(
      () => runEmbedding(embeddingInput, logPrefix),
      logPrefix
    );

    await trx('audit_ai_metadata')
      .where({ id: metadata.id })
      .update({
        risk_score: enrichment.riskScore,
        risk_level: enrichment.riskLevel,
        ai_summary: enrichment.aiSummary,
        anomaly_flags: enrichment.anomalyFlags,
        semantic_vector: toVectorLiteral(vector),
        status: 'COMPLETED',
        updated_at: trx.fn.now(),
      });

    console.log(`${logPrefix}update applied, committing transaction (status=COMPLETED)`);
  } catch (err) {
    await trx.rollback();
    throw err;
  } finally {
    if (!trx.isCompleted()) {
      await trx.commit();
    }
  }
}
