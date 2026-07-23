# Backend Code Conventions

Pull this file in when writing backend code. See also [docs/conventions.md](conventions.md) for
cross-cutting rules (TypeScript, comments, root tooling).

## Environment variables (`backend/.env`)

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — Postgres connection (individual
  values, not a URL — see [DB connection](#db-connection-dbjs) below).
- `PORT` — port the Express server listens on.

No Gemini API key here — the backend server never calls Gemini directly, only the worker does
(see [docs/worker.md](worker.md)).

## CORS

`app.use(cors())` in `app.ts`, wide open (no origin allowlist) — needed since the Vite dev server
(`localhost:5173`) calls the API (`localhost:3000`) cross-origin, and there's no auth/cookie-based
session to scope it against. Fine for a prototype; would need restricting to a specific origin for
a real deployment.

## API contracts

### POST /api/audit-entries — request body

Client sends baseline evidence only; AI metadata and DB-generated fields (`id`, `created_at`,
`updated_at`) are never accepted from the client. `timestamp` IS client-supplied (represents when
the event occurred at the client/source system, not when the DB row was inserted). `tenantId`
comes from the request body for now (no auth system yet in this prototype).

```json
{
  "eventType": "Control Execution",
  "evidenceId": "EVID-902188",
  "entityName": "Global Procurement Services",
  "description": "Manual approval override executed for vendor invoice payables exceeding $50k threshold",
  "monetaryImpact": 85000,
  "controlId": "CTRL-FIN-302",
  "actorUserId": "user_7731",
  "tenantId": "tenant_abc123",
  "timestamp": "2026-07-22T10:00:00.000Z"
}
```

### GET /api/audit-entries — full list / delta poll

No pagination. Query param: `since` (optional ISO timestamp) — omitted means "return every row"
(initial load); provided means "return only rows updated after this" (poll tick). A row counts as
updated if **either** `audit_entries.updated_at` or `audit_ai_metadata.updated_at` is newer than
`since` — covers new entries, core-field edits, notes edits, and worker completions, since each of
those bumps one table or the other. **No tenant filtering** — demo has no per-tenant isolation.
Returns each record's full baseline fields plus its nested `aiMetadata`, same shape as a single
record elsewhere in the API, plus `polledAt` (the server's own timestamp at query time — the
client uses this, not its own clock, as the basis for the next poll's `since`, to avoid
client/server clock drift).

```json
{
  "data": [
    {
      "id": 42,
      "eventType": "Control Execution",
      "evidenceId": "EVID-902188",
      "entityName": "Global Procurement Services",
      "description": "...",
      "monetaryImpact": 85000,
      "controlId": "CTRL-FIN-302",
      "actorUserId": "user_7731",
      "tenantId": "tenant_abc123",
      "timestamp": "...",
      "createdAt": "...",
      "updatedAt": "...",
      "aiMetadata": {
        "status": "PENDING",
        "riskScore": null,
        "riskLevel": null,
        "aiSummary": null,
        "anomalyFlags": [],
        "auditorNotes": "",
        "createdAt": "...",
        "updatedAt": "..."
      }
    }
  ],
  "polledAt": "2026-07-22T10:03:41.512Z"
}
```

### PUT /api/audit-entries/:id — delta-based update

Request body may include any of the core financial fields (`monetaryImpact`, `description`,
`controlId`) and/or `auditorNotes`. Which fields changed determines which table(s) get written and
whether AI gets requeued:

- **Core field changed** (any of `monetaryImpact` / `description` / `controlId` differs from the
  current value): update the changed field(s) + `updated_at` on `audit_entries`, and set
  `audit_ai_metadata.status = 'PENDING'` (+ its `updated_at`) to requeue the record for the AI
  worker to reprocess. Both writes happen in one transaction (same `db.transaction()` pattern as
  POST).
- **`auditorNotes` only changed**: immediate, atomic `UPDATE` on `audit_ai_metadata.auditor_notes`
  (+ its `updated_at`) only. Bypasses the AI queue entirely — `status` is left untouched, and
  `audit_entries` (including its `updated_at`) is never touched. Consistent with baseline evidence
  staying decoupled from AI/auditor-metadata edits.
- **Both changed in the same request**: both writes apply together in one transaction — baseline
  field(s) + `updated_at` on `audit_entries`, and `auditor_notes` + `status = 'PENDING'` +
  `updated_at` on `audit_ai_metadata`.
- `updated_at` only changes on whichever table was actually written — a notes-only edit never
  bumps `audit_entries.updated_at`, and a core-field-only edit never bumps `audit_ai_metadata`'s
  `auditor_notes` value (only its `status`/`updated_at`).

### GET /api/audit-entries/:id/similar — top-3 similarity search

Read-only lookup (no state mutation), hence `GET` not `POST`. `:id` is the `audit_entries.id` of
the record to compare against.

- Look up the target record's `semantic_vector` (via its `audit_ai_metadata` row).
- `404` if the record doesn't exist at all.
- `409` if the record exists but hasn't completed AI processing yet (`status != 'COMPLETED'` /
  `semantic_vector IS NULL`) — similarity search isn't allowed until a record has a vector to
  compare. The frontend disables the "Find Similar" button for `PENDING` rows (with a tooltip) so
  this shouldn't normally be reachable through the UI, but the backend enforces it independently
  regardless of what the frontend does.
- Otherwise, find the top 3 nearest neighbors using pgvector's `<=>` cosine distance operator,
  excluding the record itself, restricted to `status = 'COMPLETED'` rows with a non-null vector.
  **Not tenant-scoped** — demo has no per-tenant isolation, matches can come from any tenant.
- Returns the **full record** (every `audit_entries` column + every `audit_ai_metadata` column) for
  each of the 3 matches, not a trimmed field subset — plus a `similarityScore` per match.

```sql
SELECT ae.*, am.*, 1 - (am.semantic_vector <=> $1) AS similarity_score
FROM audit_ai_metadata am
JOIN audit_entries ae ON ae.id = am.audit_entry_id
WHERE am.status = 'COMPLETED'
  AND am.semantic_vector IS NOT NULL
  AND ae.id != $2
ORDER BY am.semantic_vector <=> $1
LIMIT 3;
```

`ae` and `am` both have `id`/`created_at`/`updated_at` columns — `ae.*, am.*` will collide in a raw
query, so the actual implementation must alias each side explicitly (e.g. `am.id AS ai_metadata_id`,
`am.created_at AS ai_metadata_created_at`, ...) and assemble the response by nesting the aliased AI
columns under `aiMetadata` in JS, rather than a flat `SELECT *`.

Response shape (full record per match, AI fields nested):
```json
{
  "similar": [
    {
      "id": 42,
      "eventType": "Control Execution",
      "evidenceId": "EVID-902188",
      "entityName": "Global Procurement Services",
      "description": "...",
      "monetaryImpact": 92000,
      "controlId": "CTRL-FIN-302",
      "actorUserId": "user_4432",
      "tenantId": "tenant_abc123",
      "timestamp": "...",
      "createdAt": "...",
      "updatedAt": "...",
      "aiMetadata": {
        "status": "COMPLETED",
        "riskScore": 82,
        "riskLevel": "HIGH",
        "aiSummary": "...",
        "anomalyFlags": ["MONETARY_THRESHOLD_EXCEEDED"],
        "auditorNotes": "",
        "createdAt": "...",
        "updatedAt": "..."
      },
      "similarityScore": 0.93
    }
  ]
}
```

**Index:** an ANN index on `semantic_vector` for faster lookups — HNSW (pgvector's modern default;
no `lists` tuning required like `ivfflat`, good query performance without needing table stats
built up first):
```sql
CREATE INDEX idx_ai_metadata_semantic_vector
  ON audit_ai_metadata
  USING hnsw (semantic_vector vector_cosine_ops);
```

## Database schema

### Conventions

- Field/column names: `snake_case`.
- Timestamp columns use `timestamp` **without** time zone (not `timestamptz`).
- No Postgres `enum` types used anywhere — status/level-type columns are plain `text`/`varchar`
  with validation handled in app code (Joi / constants), so adding a new value never needs a
  migration.

### `audit_entries` (baseline evidence)

Holds the raw evidence fields from the POST body plus server-generated fields. AI-generated data
does NOT live here (see `audit_ai_metadata`) — baseline evidence is decoupled from AI intelligence.

Columns: `id` (PK), `event_type`, `evidence_id`, `entity_name`, `description`, `monetary_impact`,
`control_id`, `actor_user_id`, `tenant_id`, `timestamp` (client-supplied), `created_at`,
`updated_at` (server-set).

### `audit_ai_metadata` (AI-generated intelligence)

Separate table, own PK, 1:1 with `audit_entries` via `audit_entry_id` FK. Decoupled so AI updates
never touch/rewrite the baseline row.

Columns:
- `id` — PK
- `audit_entry_id` — FK → `audit_entries.id`
- `status` — `text`, no enum. Values: `PENDING` | `COMPLETED` (no `FAILED` state)
- `risk_score` — `numeric`, nullable
- `risk_level` — `text`, no enum, nullable
- `ai_summary` — `text`, nullable
- `anomaly_flags` — `text[]`, default `'{}'` (plain array of flag-name strings, no FK/junction
  table linking individual flags — see `anomaly_flags` below for how the vocabulary is managed)
- `semantic_vector` — `vector(768)` (pgvector extension type — not a plain array — needed for the
  `<=>` cosine distance operator and future indexing in the `/similar` endpoint; 768 = Google's
  recommended efficiency-tier output size of Gemini's `gemini-embedding-2`, see
  [docs/worker.md](worker.md) for how it's generated)
- `auditor_notes` — `text`, default `''`
- `created_at`, `updated_at`

### `anomaly_flags` (dynamic flag vocabulary)

Anomaly flags are short categorical tags (not free text) so they stay filterable/aggregable. Since
LLM calls are stateless, letting the model invent flag wording freely causes drift (same condition
phrased differently each time), so the vocabulary is DB-backed and grown deliberately:

- `id` — PK
- `name` — `text`, unique — the canonical flag string (e.g. `MONETARY_THRESHOLD_EXCEEDED`)
- `created_at`

**Flow:** before each AI enrichment call, fetch existing flag names from this table and inject
them into the prompt ("use one of these if it fits, or propose a new one if none fit"). Any flag
the LLM returns that isn't already present gets inserted. This is a loose vocabulary table, not a
join table — `audit_ai_metadata.anomaly_flags` stores flag name strings directly, no FK/junction
linking. Race conditions on two concurrent inserts of the same new flag are accepted/unhandled for
now.

## Query patterns

Prefer one joined query over two separate table fetches zipped together in JS, when both tables'
data is needed for the same records (e.g. `findAll`/`findById` in `AuditRepository` join
`audit_entries`/`audit_ai_metadata` directly rather than fetching entries, then a second
`whereIn` query for their ai_metadata, then merging by id in JS). Fewer DB round trips, same
result. Since the two tables share column names (`id`/`created_at`/`updated_at`), the
`audit_ai_metadata` side must be explicitly aliased in the `SELECT` to avoid silent collisions —
see `JoinedAuditEntryRow` / `splitJoinedRow` / `mapJoinedRow` for the shared shape and helpers.

## DB connection (`db.js`)

Standalone file, only exports the configured knex instance. Connection uses individual values
(host, port, user, password, database), not a single connection URL.

```js
import knex from 'knex';

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  pool: { min: 2, max: 10 },
});

export default db;
```

## Transactions

Import the knex object from `db.js`, start a transaction at the call site with
`const trx = await db.transaction()`, run every query in that transaction on `trx(...)` (never
`db(...)`).

**No `await trx.commit()` at the end of `try`.** A successful early `return` partway through the
`try` block would skip a commit placed there, leaving the transaction open. Instead:
- `catch` always starts with `await trx.rollback()`, then rethrows.
- `finally` checks `if (!trx.isCompleted())` and commits there — this only fires when `catch`
  didn't run (so nothing had already been rolled back), meaning the `try` block completed
  successfully, however it returned.

```js
import db from './db.js';

async function createAuditEntry(payload) {
  const trx = await db.transaction();

  try {
    const [entry] = await trx('audit_entries')
      .insert({
        event_type: payload.eventType,
        evidence_id: payload.evidenceId,
        entity_name: payload.entityName,
        description: payload.description,
        monetary_impact: payload.monetaryImpact,
        control_id: payload.controlId,
        actor_user_id: payload.actorUserId,
        tenant_id: payload.tenantId,
        timestamp: payload.timestamp,
      })
      .returning('*');

    const [aiMetadata] = await trx('audit_ai_metadata')
      .insert({
        audit_entry_id: entry.id,
        status: 'PENDING',
      })
      .returning('*');

    return { ...entry, aiMetadata };
  } catch (err) {
    await trx.rollback();
    throw err;
  } finally {
    if (!trx.isCompleted()) {
      await trx.commit();
    }
  }
}
```

Exception: `worker/`'s row-claiming transaction (see [docs/worker.md](worker.md)) deliberately does
**not** follow this finally-commits pattern on its success path — it hands the still-open
transaction to the caller on purpose, so the caller can hold the row lock through processing. Only
apply the finally-commit pattern to a function that owns a transaction's *entire* lifecycle
start-to-finish.

## Indexes

`audit_ai_metadata` pending-queue lookup — partial index so the worker's oldest-pending-first poll
doesn't scan completed rows:

```sql
CREATE INDEX idx_ai_metadata_pending_queue
  ON audit_ai_metadata (created_at)
  WHERE status = 'PENDING';
```

## Logging

Plain `console.log`/`console.error` calls only — no logging framework/library (no morgan, winston,
pino). Every line is prefixed with a tag so the terminal is easy to scan: `[backend:http]` for
request logging, `[backend:audit]` for controller-level business events, `[backend:db]` for the DB
connection module.

- **Request logging** — a small middleware in `app.ts`, added before the routes, timestamps each
  incoming request and logs on `res.on('finish', ...)`:
  `[backend:http] GET /api/audit-entries 200 12ms`.
- **Controller-level business events** (`AuditController.ts`) — entry created (with its new id),
  entry updated (its id and whether it was a `core` / `notes` / `core_and_notes` update — i.e.
  core-field requeue vs auditor-notes-only fast-track, per the delta-detection logic in
  `AuditRepository.update`), similarity search performed (the id searched and outcome:
  `not_found` / `not_ready` / `ok` with match count), and any validation or DB error before the
  error response is sent, e.g. `[backend:audit] updated entry id=42 kind=core (core-field requeue)`.
- **Server startup** (`server.ts`) — logs the port once the server starts listening.
- **DB connection** (`db.ts`) — logs once at module load whether `DB_SSL` is enabled, e.g.
  `[backend:db] connecting (ssl=disabled)`. Host/database name are not logged.

Secrets are never logged — `DB_PASSWORD` and any API keys are excluded from every log line.

## Migrations

`migrations/` is its own top-level folder (sibling to `backend/`, `frontend/`, `worker/`), not
nested inside `backend/`. One migration file per feature. Never use `migrate:latest` or
`migrate:rollback` — they run/roll back everything. Always target a specific migration by filename.

**Environment variables (`migrations/.env`):** same Postgres connection values as backend —
`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — used by its own `knexfile`.

**Creating a new migration (always use this):**
```bash
# From migrations/ folder — auto-generates timestamped filename:
npm run make -- <name>
# e.g. npm run make -- add_notes_to_clients
# creates: migrations/20260526123456_add_notes_to_clients.js
```
Then fill in `exports.up` and `exports.down` in the generated file.

**Running a specific migration:**
```bash
# From migrations/ folder:
npm run up -- 20260525000000_initial_schema.js
npm run down -- 20260525000000_initial_schema.js
```

`package.json` scripts:
```json
{
  "scripts": {
    "make": "knex migrate:make",
    "up": "node scripts/migrate.js up",
    "down": "node scripts/migrate.js down"
  }
}
```

`scripts/migrate.js`:
```js
const { execSync } = require('child_process');

const direction = process.argv[2];
const filename = process.argv[3];

if (!direction || !filename) {
  console.error('Usage: npm run up -- <filename.js>  |  npm run down -- <filename.js>');
  process.exit(1);
}

execSync(`npx knex migrate:${direction} ${filename}`, { stdio: 'inherit' });
```
