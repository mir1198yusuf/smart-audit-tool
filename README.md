# Smart Audit Interview

AI-Enriched Continuous Audit Pipeline — prototype Audit SaaS platform (Vue.js + Express + PostgreSQL, with a standalone worker for Gemini-powered AI enrichment).

## Getting Started

At repo root, run below

1. `npm run install:all` — installs dependencies for root, `backend/`, `frontend/`, `worker/`, and `migrations/`.
2. `npm run migrate:up-all` — applies all database migrations.
3. `npm run seed` — seeds 10 sample audit entries.
4. `npm run dev` — starts the backend, frontend, and worker together.
5. Open [http://localhost:5173](http://localhost:5173) in your browser.
