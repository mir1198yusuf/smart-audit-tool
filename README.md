# Smart Audit Interview

AI-Enriched Continuous Audit Pipeline — prototype Audit SaaS platform (Vue.js + Express + PostgreSQL, with a standalone worker for Gemini-powered AI enrichment).

## Getting Started

0. Have Postgres running locally or remotely, then create a new database via any db-client:
   ```sql
   CREATE DATABASE your_db_name;
   ```

At repo root, run below

1. `npm run install:all` — installs dependencies for root, `backend/`, `frontend/`, `worker/`, and `migrations/`.
2. `npm run setup:env` — prompts for env values and writes `.env` in `backend/`, `frontend/`, `worker/`, and `migrations/` from each folder's `.env.example`. This is to save your time.
3. `npm run migrate:up-all` — applies all database migrations.
4. `npm run seed` — seeds 10 sample audit entries.
5. `npm run dev` — starts the backend, frontend, and worker together.
6. Open [http://localhost:5173](http://localhost:5173) in your browser.

## Live Deployment

All 4 pieces run on free tiers:

- **Frontend** — Cloudflare Pages
- **Backend** and **worker** — Render.io Web Services
- **Postgres** — Aiven.io

The worker is a background script with no HTTP requests of its own, so Render's free tier would spin it down from inactivity; it's kept alive by an external cron trigger from [cron-job.org](https://cron-job.org/) hitting its ping endpoint.

Live website: https://smart-audit-tool.pages.dev/
