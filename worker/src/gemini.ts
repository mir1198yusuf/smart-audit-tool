import { GoogleGenAI, Type } from '@google/genai';
import type { EnrichmentInput, EnrichmentResult } from './types.js';

// gemini-2.5-flash-lite is deprecated (shutdown scheduled, no longer available to new users as
// of mid-2026) — replaced with gemini-3.5-flash-lite, the current stable Flash-Lite tier model
// per ai.google.dev/gemini-api/docs/models. Flash-Lite tier over Pro-tier — enrichment is a
// lightweight classification/summary task, and Flash-Lite has a materially higher free-tier RPM
// ceiling than Pro, which is the binding constraint here.
// Plainly: the cheaper/faster model on purpose — the task doesn't need Pro's extra power, and
// Pro would mean hitting the free-tier rate limit several times more often for no real benefit.
const ENRICHMENT_MODEL = 'gemini-3.5-flash-lite';
// gemini-embedding-001 and gemini-embedding-2 produce incompatible vector spaces (per
// ai.google.dev/gemini-api/docs/embeddings) — 768 chosen as Google's recommended
// efficiency-tier output size via Matryoshka Representation Learning, same truncation mechanism
// gemini-embedding-001 used at 256. Call shape (embedContent + config.outputDimensionality) is
// unchanged between the two models — neither this codebase's prior call nor gemini-embedding-2's
// docs use the model-specific task_type/in-prompt-task-instruction options, so no other code
// here needed to change.
const EMBEDDING_MODEL = 'gemini-embedding-2';
const EMBEDDING_DIMENSIONS = 768;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const enrichmentResponseSchema = {
  type: Type.OBJECT,
  properties: {
    riskScore: { type: Type.NUMBER },
    riskLevel: { type: Type.STRING },
    aiSummary: { type: Type.STRING },
    anomalyFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['riskScore', 'riskLevel', 'aiSummary', 'anomalyFlags'],
};

function buildEnrichmentPrompt(entry: EnrichmentInput, knownFlags: string[]): string {
  return `You are an AI audit analyst reviewing a single audit evidence record for an enterprise continuous-audit platform.

Evidence record:
${JSON.stringify(entry, null, 2)}

Known anomaly flag vocabulary — reuse an existing flag ONLY if it is a strong, specific semantic
match for this record's actual scenario: same domain (e.g. financial control vs. IT access
control) AND same underlying mechanism/event, not just "also risky" or "also a control issue" in
some general sense. If every existing flag is only a loose, generic, or surface-level fit —
including one borrowed from a different domain that happens to sound control-related — do NOT
reuse it; propose a new, more precise flag name instead (SCREAMING_SNAKE_CASE, short and
categorical). When in doubt, prefer a new precise flag over forcing a mismatched reuse:
${knownFlags.length > 0 ? knownFlags.join(', ') : '(none defined yet)'}

Analyze this record and return:
- riskScore: integer 0-100, higher means higher audit risk.
- riskLevel: one of LOW, MEDIUM, HIGH, CRITICAL.
- aiSummary: a concise (1-3 sentence) plain-English narrative of why this record carries that risk.
- anomalyFlags: array of applicable flag names (reused or newly proposed; can be empty).`;
}

export async function runEnrichment(
  entry: EnrichmentInput,
  knownFlags: string[],
  logPrefix = ''
): Promise<EnrichmentResult> {
  console.log(`${logPrefix}calling Gemini enrichment (model=${ENRICHMENT_MODEL})`);
  const startedAt = Date.now();

  try {
    const response = await ai.models.generateContent({
      model: ENRICHMENT_MODEL,
      contents: buildEnrichmentPrompt(entry, knownFlags),
      config: {
        responseMimeType: 'application/json',
        responseSchema: enrichmentResponseSchema,
      },
    });

    const parsed = JSON.parse(response.text ?? '{}');

    const result: EnrichmentResult = {
      riskScore: Number(parsed.riskScore),
      riskLevel: String(parsed.riskLevel),
      aiSummary: String(parsed.aiSummary),
      anomalyFlags: Array.isArray(parsed.anomalyFlags) ? parsed.anomalyFlags.map(String) : [],
    };

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `${logPrefix}enrichment succeeded in ${elapsedMs}ms (riskLevel=${result.riskLevel}, riskScore=${result.riskScore})`
    );

    return result;
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    console.error(`${logPrefix}enrichment failed after ${elapsedMs}ms:`, err);
    throw err;
  }
}

// controlId follows a "CTRL-{DOMAIN}-{number}" convention (e.g. CTRL-FIN-302, CTRL-SEC-118) — the
// middle segment is itself a clean categorical domain tag, so it's pulled out rather than embedding
// the full controlId (the numeric suffix is just an identifier and adds no semantic signal).
// Falls back to the raw controlId if it doesn't match the convention, so unexpected formats still
// contribute something rather than being silently dropped.
function extractControlDomain(controlId: string): string {
  const match = /^CTRL-([A-Z0-9]+)-/.exec(controlId);
  return match ? match[1] : controlId;
}

// The embedding input combines the AI narrative (aiSummary) with categorical context that the
// narrative prose alone tends to wash out — two records from genuinely different domains (e.g. an
// IT access-control breach and a financial-approval override) can produce similarly-worded risk
// narratives ("bypass of controls", "significant risk", ...) and end up scored as more similar than
// they actually are. Prefixing eventType + control domain + anomalyFlags (all strong "what kind of
// thing is this" categorical signals) ahead of aiSummary gives the embedding model concrete category
// tokens to anchor on, rather than only literary/style similarity. Structured/concatenated text is
// fine input for an embedding model — it doesn't need to read as natural prose.
export function buildEmbeddingInput(input: {
  eventType: string;
  controlId: string;
  anomalyFlags: string[];
  aiSummary: string;
}): string {
  const flags = input.anomalyFlags.length > 0 ? input.anomalyFlags.join(', ') : 'NONE';
  const controlDomain = extractControlDomain(input.controlId);
  return `Event type: ${input.eventType}. Control domain: ${controlDomain}. Flags: ${flags}. ${input.aiSummary}`;
}

export async function runEmbedding(embeddingInput: string, logPrefix = ''): Promise<number[]> {
  console.log(
    `${logPrefix}calling Gemini embedding (model=${EMBEDDING_MODEL}, dimensions=${EMBEDDING_DIMENSIONS})`
  );
  const startedAt = Date.now();

  try {
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: embeddingInput,
      config: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values) {
      throw new Error('Gemini embedding response did not include vector values');
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`${logPrefix}embedding succeeded in ${elapsedMs}ms (dimensions=${values.length})`);

    return values;
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    console.error(`${logPrefix}embedding failed after ${elapsedMs}ms:`, err);
    throw err;
  }
}
