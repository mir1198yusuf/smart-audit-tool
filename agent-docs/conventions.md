# Cross-Cutting Conventions

Rules that apply across `backend/`, `frontend/`, and `worker/` — not specific to any one folder.

## Language

TypeScript everywhere — `backend/`, `frontend/`, `worker/`. Exception: `migrations/` stays plain
JS, matching knex's default `exports.up`/`exports.down` migration file format; no build step or
`ts-node` needed just to run one-off migration scripts.

No `any` type, anywhere — including implicit leaks (e.g. Joi's `.validate()` returns `value: any`
unless the schema is given an explicit generic, `Joi.object<T>({...})`; always supply one). If a
raw/aggregate query result needs a shape TypeScript can't infer, define a proper interface for it
instead of casting to `any`.

## Comments

Simple, readable code. No comments by default — well-named identifiers should carry the meaning.
Only add a comment when it explains a non-obvious *why* (a hidden constraint, a workaround, a
subtle invariant) — never to restate *what* the code already says.

## Repo tooling (root `package.json`)

No shared/hoisted `node_modules` between folders — explicitly **no** npm/yarn/pnpm `workspaces`.
Each of `backend/`, `frontend/`, `worker/`, `migrations/` keeps its own fully independent
`package.json` and `node_modules`. The root `package.json` exists only to orchestrate them; its
only own dependency is a small runner (e.g. `concurrently`) for the `dev` script.

Two root-level scripts:
- `install:all` — runs `npm install` inside each subfolder independently (`--prefix`), never a
  single shared install.
- `dev` — starts `backend/`, `frontend/`, and `worker/`'s own dev scripts concurrently (not
  `migrations/` — it has no long-running dev server, just one-off `make`/`up`/`down` commands, see
  [docs/backend.md](backend.md#migrations)).

```json
{
  "scripts": {
    "install:all": "npm install --prefix backend && npm install --prefix frontend && npm install --prefix worker && npm install --prefix migrations",
    "dev": "concurrently -n backend,frontend,worker \"npm run dev --prefix backend\" \"npm run dev --prefix frontend\" \"npm run dev --prefix worker\""
  }
}
```

## Env setup (`npm run setup:env` → `scripts/setup-env.js`)

Each folder's `.env.example` is the only source of truth for which env vars exist — `.env` files
themselves never carry comments, only `KEY=value` lines. To add a new env var, just add it (with
its explanatory comment, if any) to the relevant folder's `.env.example`; the next `setup:env` run
picks it up and prompts for it automatically, no script changes needed.

Every run fully wipes and rewrites each folder's `.env` from scratch (never merges with whatever
was there before). Within one run, a variable with the same name is only asked once and reused
across folders. A couple of special cases in the script:
- `worker`'s `PORT` and `RUN_PING_SERVER` are hardcoded defaults, never prompted.
- `frontend`'s API base URL var (any key matching `API.*URL`) is derived from `backend`'s `PORT`
  answer instead of being prompted for.
- `DB_SSL` only accepts `true`/`false`, re-prompting otherwise.
