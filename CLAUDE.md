# Smart Audit Interview — AI-Enriched Continuous Audit Pipeline

> This file is for the AI agent (Claude) to record its own learnings about this repo — conventions,
> decisions, and gotchas discovered while working here. It is not primarily written for human readers.

Prototype for an enterprise Audit SaaS platform (Vue.js + PostgreSQL, adapted from a React/MongoDB brief).

## Stack

- Express.js server
- Joi for request validation
- Knex to connect to Postgres
- Vue.js frontend
- Gemini (free tier) for AI enrichment and embeddings
- TypeScript everywhere (`backend/`, `frontend/`, `worker/`) except `migrations/` (plain JS)

## Repo structure

Four top-level folders: `backend/`, `frontend/`, `migrations/`, `worker/`.

## Architecture (finalized)

- Baseline evidence and AI-generated intelligence are decoupled into separate Postgres tables (not
  embedded together), so AI enrichment updates never touch or rewrite the baseline evidence row.
- Anomaly flags use a DB-backed, dynamic vocabulary rather than a fixed enum/whitelist — the flag
  taxonomy grows over time as the LLM encounters new scenarios, instead of being hardcoded upfront.
- Async AI enrichment runs via a standalone worker process (separate from the backend), polling a
  status column (native Postgres polling), not a dedicated message queue.
- PUT updates use delta detection: changes to core financial fields requeue the record for AI
  reprocessing; auditor-notes-only edits fast-track with a direct update, bypassing AI entirely.
- Semantic vectors come from Gemini's real embedding model (not a mock/local generator) — deviates
  from the original assessment brief's literal "8-dimensional" spec in favor of the model's actual
  smallest supported output size.
- Frontend is a single-page Vue app with no router and no state library (Vuex/Pinia) — local
  component state is enough at this scale. No pagination: initial load fetches every row, then
  polling only fetches deltas (rows updated since the last poll, checked across both tables) and
  merges them into the existing list by id rather than replacing it wholesale.
- Edit/Similarity modals hold their own decoupled local state, snapshotted at open time — the
  background polling refresh never touches modal state, so a poll tick can't close an open modal
  or associate it with the wrong record.

## Code conventions

- Cross-cutting: see [agent-docs/conventions.md](agent-docs/conventions.md) — language, comment style,
  root repo tooling (install/dev scripts, no shared node_modules).
- Backend: see [agent-docs/backend.md](agent-docs/backend.md) — API contracts, schema, db connection,
  transactions, migrations, env vars.
- Worker: see [agent-docs/worker.md](agent-docs/worker.md) — polling loop, row claiming, AI/embedding
  calls, rate limiting, env vars.
- Frontend: see [agent-docs/frontend.md](agent-docs/frontend.md) — component structure, delta polling,
  modal isolation, env vars.

## Workflow note

Only content the user has explicitly said is "final" belongs in this file. Architecture discussion,
proposals, and options are not written here until confirmed.

## Working with Claude

Any work touching a file inside `backend/`, `frontend/`, `migrations/`, or `worker/` — code
changes AND debugging/troubleshooting (running commands, reading logs/output, diagnosing errors,
tracing a root cause) — goes via a subagent, not directly in the main session, no exceptions for
size or urgency. Don't rationalize a direct edit or a direct debugging command as "too small/
urgent to delegate" — this includes things like running a migration, hitting an endpoint to
reproduce a bug, or reading a stack trace. The point is keeping the main session's context window
free of that noise, not just avoiding edits. Only files outside those four folders (root
`package.json`, root `.gitignore`, this file, `agent-docs/*.md`) are worked on directly.
