# Worker

Pull this file in when writing worker code. Lives in its own top-level `worker/` folder (sibling
to `backend/`, `frontend/`, `migrations/`). See also
[docs/conventions.md](conventions.md) for cross-cutting rules (TypeScript, comments, root tooling).

## Environment variables (`worker/.env`)

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — same Postgres connection as backend
  (worker connects directly, independent from the Express server).
- `GEMINI_API_KEY` — only the worker calls Gemini; the backend API never does.

## Startup

A single command starts one independent worker process — no prompt, no in-process concurrency. It
connects to the DB and immediately starts its one continuous poll loop. Written this way so it can
later become a Docker container image: scaling to more concurrent workers means running more
container instances (e.g. increasing an ECS service's desired task count), not one process
internally managing multiple loops. (No Docker/ECS work exists yet — this is just why the process
itself stays deliberately simple/stateless-at-the-orchestration-level.)

## Loop

Each worker runs an infinite loop:
1. Try to claim the oldest `PENDING` row.
2. If none found, wait 10s before polling again (avoids hitting the DB in a tight loop when the
   queue is empty).
3. If claimed, process it (AI + embedding calls), then update it to `COMPLETED`.

## Row claiming (no two workers get the same record)

Claim via `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction. The transaction stays open for
the full duration of processing — including both LLM calls — and only commits after the final
`UPDATE ... status = 'COMPLETED'`. Other workers' claim queries automatically skip any row already
locked by an in-progress transaction. This keeps `status` as just `PENDING` | `COMPLETED` — no
third "in-progress" status needed.

## AI enrichment call (risk + summary + flags)

Fields sent to Gemini (subset of baseline evidence — excludes `actorUserId`, `tenantId`):
```json
{
  "timestamp": "2026-07-21T10:00:00.000Z",
  "eventType": "Control Execution",
  "evidenceId": "EVID-902188",
  "entityName": "Global Procurement Services",
  "description": "Manual approval override executed for vendor invoice payables exceeding $50k threshold",
  "monetaryImpact": 85000,
  "controlId": "CTRL-FIN-302"
}
```

Also fetch current flag names from the `anomaly_flags` table and inject them into the prompt
("use one of these if applicable, or propose a new one if none fit") — see
[docs/backend.md](backend.md) for the `anomaly_flags` vocabulary design. Any new flag name
returned gets inserted into `anomaly_flags` if not already present.

Returns: `riskScore`, `riskLevel`, `aiSummary`, `anomalyFlags`.

## Embedding call (semantic vector)

Separate Gemini call using `gemini-embedding-2` with `output_dimensionality: 768` (Google's
recommended efficiency-tier output size — a genuine model-native reduction via Matryoshka
Representation Learning, not a manual truncation). `gemini-embedding-001` and `gemini-embedding-2`
produce incompatible vector spaces, so switching models requires clearing and re-embedding every
existing stored vector (done once as a migration + one-off backfill; not an ongoing concern).

Input text: a combined string, not `aiSummary` alone — narrative-only input let two records from
genuinely different domains (an IT access-control breach and a financial-approval override) score
a moderate-to-high similarity purely because their `aiSummary` prose shared risk-narrative language
("bypass of controls", "significant risk", ...) even though the underlying scenarios differed. The
combined input adds categorical context ahead of the narrative so the vector has concrete
"what kind of thing is this" signal to anchor on, not just prose style:

```
Event type: ${eventType}. Control domain: ${controlDomain}. Flags: ${anomalyFlags.join(', ') || 'NONE'}. ${aiSummary}
```

- `eventType` and `anomalyFlags` come straight off the record/enrichment result.
- `controlDomain` is the middle segment of `controlId`'s `CTRL-{DOMAIN}-{number}` convention (e.g.
  `CTRL-FIN-302` → `FIN`, `CTRL-SEC-045` → `SEC`) via `extractControlDomain` in `gemini.ts` — the
  numeric suffix is just an identifier and adds no semantic signal, so only the domain tag is
  pulled out. Falls back to the raw `controlId` if it doesn't match the convention.
- `aiSummary` (the enrichment call's narrative) stays part of the input — this is additive, not a
  replacement of the narrative signal.

Built by `buildEmbeddingInput()` in `gemini.ts`, called from `processEntry.ts` right before
`runEmbedding()`. Structured/concatenated text like this is fine input for an embedding model — it
doesn't need to read as natural prose.

Changing this input format makes every previously-stored vector stale (embedded from different
text), so it required a one-off backfill re-embedding all `COMPLETED` rows with the new combined
text — same pattern as the `gemini-embedding-001` → `gemini-embedding-2` migration backfill above,
just recomputing the input text instead of the model/dimensionality.

Returns: 768-dim float vector, stored in `audit_ai_metadata.semantic_vector` (`vector(768)`).

## Final update

Single `UPDATE` on `audit_ai_metadata`, inside the same held transaction as the claim: sets
`risk_score`, `risk_level`, `ai_summary`, `anomaly_flags`, `semantic_vector`, `status = 'COMPLETED'`,
`updated_at`. Then commit.

## Failure handling

If either Gemini call throws (rate limit, bad key, network error), the held transaction rolls
back — nothing commits, so the row is left exactly as it was: `status = 'PENDING'`. There's no
`FAILED` state to set. Any worker picks it up again on a later poll cycle and retries
automatically; the frontend sees no difference from normal processing latency.

Open risk, not yet decided: a permanently-failing record (e.g. consistently invalid input) would
retry forever with no visible error surfaced anywhere. Currently accepted as-is for the prototype
— revisit if a retry cap or error surfacing becomes necessary.

## Rate limiting

Gemini's free tier is genuinely tight — as low as 5–15 requests/minute depending on model, plus a
daily request cap, and the quota applies per-project (shared across every worker, not per-worker).
Since each record costs 2 calls (enrichment + embedding) and up to 5 workers can run concurrently,
hitting 429s is expected, not an edge case — this needs real handling, not just the generic
rollback-and-retry above.

- **Model choice:** default to a higher-RPM model (e.g. Gemini Flash-Lite tier, ~15 RPM) for the
  enrichment call rather than a Pro-tier model (~5 RPM) — it's a lightweight classification/summary
  task that doesn't need the strongest model, and the free-tier ceiling is the binding constraint.
- **On a 429 specifically:** honor the API's `Retry-After` header if present; otherwise back off
  with a fixed/exponential wait (a few seconds, capped) *before* letting the transaction roll back
  and the worker loop continue. This is distinct from the generic error path — without it, a
  rate-limited worker would immediately reclaim the same row and hit the same 429 again in a tight
  loop, making the rate limit worse instead of just waiting it out.
- **Instance count is itself a rate-limit control:** since each process is one independent worker,
  however many instances you run (today: just one, manually; later: an ECS service's desired task
  count) bounds how many concurrent callers share Gemini's per-project quota — running many
  instances against the free tier will rate-limit often; 1–2 is the realistic default for demo use.
- If backoff retries are exhausted, it falls through to the existing failure-handling behavior
  above (transaction rolls back, row stays `PENDING`, retried on a later cycle).

## Logging

Plain `console.log`/`console.error` calls throughout — no logging framework/library. Every line
from the worker loop (or work done on its behalf) is prefixed `[worker]` — no per-instance number,
since each process only ever runs one loop now (an external orchestrator, once one exists, would
distinguish between instances at the container/task level, not inside the log line itself).

What gets logged:
- **Startup:** `db.ts` logs once at module load whether `DB_SSL` is enabled — never the host,
  port, database name, or password — then `Starting worker...` and `[worker] started`.
- **Poll cycles:** an empty poll logs one line before sleeping, e.g.
  `[worker] no pending records, waiting 10s`; a successful claim logs the claimed row, e.g.
  `[worker] claimed audit_entries.id=482`.
- **AI enrichment / embedding calls:** logged before the call (model, and dimensions for
  embedding) and after (success with a short result summary — risk level/score, or vector
  dimensions — plus elapsed ms; or failure with elapsed ms), e.g.
  `[worker] audit_entries.id=482: enrichment succeeded in 812ms (riskLevel=HIGH, riskScore=78)`.
- **Rate limit retries:** every retry attempt logs the attempt number out of the max, the delay
  being waited, and whether that delay came from the parsed `RetryInfo` or the exponential-backoff
  fallback, e.g.
  `[worker] audit_entries.id=482: Gemini rate limited (attempt 1/3), waiting 13000ms before retrying (source=RetryInfo)`.
- **Completion:** logged once the final `UPDATE` is applied and the transaction is committing, and
  again from the worker loop once `processClaimedRecord` returns, both including the record id and
  final `COMPLETED` status.

Secrets (`DB_PASSWORD`, `GEMINI_API_KEY`) are never logged, not even partially.
