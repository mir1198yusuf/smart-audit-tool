# Frontend Conventions

Pull this file in when writing frontend code. Lives in its own top-level `frontend/` folder. See
also [docs/conventions.md](conventions.md) for cross-cutting rules (TypeScript, comments, root
tooling).

## Environment variables (`frontend/.env`)

- `VITE_API_BASE_URL` — base URL of the backend API (e.g. `http://localhost:3000/api`). No
  secrets/API keys here — the frontend never calls Gemini directly, only the backend/worker do.

## Dev server (`vite.config.ts`)

`server: { port: 5173, strictPort: true }` pins the dev server to `5173` explicitly rather than
relying on Vite's default-with-auto-increment-if-busy behavior — `strictPort` makes Vite fail
loudly if `5173` is already taken instead of silently shifting to the next free port. Matches the
backend's CORS setup (see [docs/backend.md](backend.md#cors)), which assumes the frontend is
always reachable at `localhost:5173`.

## Stack

Vite + Vue 3, **Composition API with `<script setup>`**. No Vue Router — genuinely single-page,
no multi-view navigation. No Vuex/Pinia — local `ref`/`reactive` state is enough at this scale;
state is managed natively in component state per the brief's requirement.

**Every `.vue` file uses `<script setup lang="ts">` (Composition API — `ref`, `reactive`,
`computed()`, `defineProps`, `defineEmits`, `onMounted`, etc.) — never the Options API
(`export default { data(), methods, ... }`), no exceptions.** Applies to every component in
`frontend/src`, not just the root.

Within each `<script setup>` block (and the same applies inside composable files under
`frontend/src/composables/`), group code under section-header comments, in this order (omit any
section that's empty):

```ts
// ===== types =====
// ===== constants =====
// ===== helpers =====
// ===== props =====
// ===== emits =====
// ===== reactive vars =====
// ===== computed =====
// ===== methods =====
// ===== lifecycle hooks =====
```

The first three cover module-level code that sits above the component's/composable's own body —
`types` for interfaces (e.g. a modal's data-shape interface, a callbacks interface), `constants`
for plain (non-reactive) module-level values (e.g. a poll interval, a template list, a demo
tenant id), `helpers` for standalone pure functions not tied to component/composable state (e.g. a
merge function, a blank-form factory). Every top-level declaration in the file gets a heading —
nothing sits unlabeled above the first labeled section.

## Root component

One root component (e.g. `AuditDashboard.vue`) owns:
- `entries` — the full list of records (each with nested `aiMetadata`) — no pagination, see
  Polling below
- `lastPolledAt` — server-returned timestamp used as the basis for the next poll's delta filter
- `ingestModal` — a `useIngestModal({ onCreated })` instance, `{ isOpen, open, close, handleCreated }`
- `editModal` — a `useEditModal({ onSubmitted })` instance, `{ isOpen, selectedEntry, open, close,
  handleSubmitted }` — just the flag, which entry is being edited, and callback forwarding (see
  Composables below)
- `similarityModal` — a `useSimilarityModal()` instance, `{ isOpen, selectedEntry, open, close }` —
  same shape, no callback needed since nothing about a similarity search needs to notify the rest
  of the app

## Table

One row per record: `id`, entity name, event type, timestamp, description, monetary impact, control
ID, a status badge (`PENDING`, or color-coded by `riskLevel` once `COMPLETED`), `aiSummary`,
`riskScore`, anomaly flags, `auditorNotes`. Rows keyed by `id` in `v-for` (not array index), so
re-renders from polling can't misassociate a row.

The ID column (the record's own DB primary key, `entry.id`) leads the table, before Entity — a
record's own identifier conventionally comes first in a data table. It stays left-aligned plain
text rather than getting the `.numeric-col` right-align/tabular-nums treatment: despite being a
`number`, it's an identifier to scan/reference (like Control ID), not a quantity whose magnitude
gets compared against other rows (like Monetary Impact/Risk Score).

The Anomaly Flags column renders `entry.aiMetadata.anomalyFlags` (a `string[]`) as small pill chips
(`.anomaly-chip`, styled inline in `AuditDashboard.vue` to match `StatusBadge.vue`'s pill look —
rounded, small padding, small font), one chip per flag, wrapping onto multiple lines within the
cell rather than overflowing. Unlike the status badge's `riskLevel`, which has exactly 4 known
values and gets a distinct color per value, anomaly flags come from a DB-backed, open-ended
vocabulary that grows over time (see [docs/backend.md](backend.md)) — there's no fixed small set of
values to color-code against, so every chip uses the same single neutral color instead of inventing
per-flag colors. When the array is empty (e.g. `status` is still `PENDING` and no flags have been
assigned yet), the cell shows `—`, matching the same fallback already used for `aiSummary`/
`riskScore` when null.

`description`, `aiSummary`, and `auditorNotes` are unbounded free-text fields, so
`.description-cell`/`.summary-cell`/`.notes-cell` wrap normally (`white-space: normal` +
`overflow-wrap: break-word` for long unbroken tokens) so the full text is visible without hovering,
rather than being hidden behind a truncating ellipsis and a `:title` tooltip. To keep row height
reasonable now that these columns wrap again, they get a wider `max-width` (340px, up from the
240px used when the container was narrower) than the short columns (Entity, Status, Timestamp, Risk
Score, etc.) — the container was widened to 1800px, so there's enough horizontal room to let these
three text-heavy columns breathe without any row growing past a small, reasonable number of lines
(roughly 2-4 for typical content). `th, td { vertical-align: top }` keeps shorter cells (badges,
chips, short IDs) pinned to the top of a row rather than centering oddly once row heights vary
again. Auditor Notes is the last column of the AI-metadata cluster (Status, AI Summary, Risk Score,
Anomaly Flags, Auditor Notes), right before the row actions column. Most records won't have notes
yet (auditor-entered, not AI-populated), so an empty string falls back to `—`, matching the same
fallback already used for `aiSummary`/`riskScore`/anomaly flags when null/empty.

The Timestamp column shows `entry.timestamp` (client-supplied — when the event occurred at the
third-party/source system, e.g. what was sent in the `POST /api/audit-entries` request body), NOT
`entry.createdAt`/`updatedAt` (when the row was inserted/last modified in our own DB — see
[docs/backend.md](backend.md)). Formatted for readability via `new Date(entry.timestamp).toLocaleString()`
in a small local `formatTimestamp` helper in `AuditDashboard.vue`.

Monetary Impact and Risk Score are the table's only numeric columns, so their `th`/`td` cells get
a shared `.numeric-col` class (`text-align: right` + `font-variant-numeric: tabular-nums`) — every
other column stays left-aligned. `.table-wrapper` carries a subtle box-shadow so the table reads as
a distinct surface, and the header row's bottom border is a 2px `#2563eb` accent (vs. the 1px gray
border elsewhere).

`tbody tr:nth-child(even)` gets a zebra stripe (`#f1f5f9`) — deliberately a step darker than the
`#f8fafc` used for the header background, since that lighter shade reads as indistinguishable from
white at a glance. `tbody tr:hover` (declared after the stripe rule, so it wins on equal
specificity) applies a flat `rgba(37, 99, 235, 0.08)` blue tint on top of any row regardless of
whether it's striped or not, so hover always reads as one distinct, consistent state rather than
blending with or cancelling out the stripe.

The header is pinned while scrolling: `th` gets `position: sticky; top: 0` (plus `z-index: 1` and
its existing opaque `#f8fafc` background/border-bottom, so rows don't show through and the pinned
header still looks intentional rather than glitchy). This sticks relative to the whole page, not a
bounded inner box: the table grows down the full document and the *window* scrolls through it.

`.table-wrapper` sets **no `overflow` property at all** — confirmed by live browser testing (not
just reasoned about) that this is load-bearing, not incidental. An earlier version kept
`overflow-x: auto` here (for horizontal scroll on wide content) on the theory that since the wrapper
has no height cap it never overflows vertically, so the CSS-computed `overflow-y: auto` this forces
would never become an *active* scroll container. That theory was wrong in practice: as soon as
`overflow-x` is set to anything other than `visible` on an ancestor, browsers treat that ancestor as
the nearest scroll container for any `position: sticky` descendant regardless of whether it
currently overflows — so the sticky `th` ended up stuck relative to a box that itself never
scrolls (the window does), which renders identically to not being sticky at all: the header just
scrolled away with the rest of the page. Verified live in Chrome via scroll + screenshot: with
`overflow-x: auto` on `.table-wrapper`, `th`'s `getBoundingClientRect().top` tracked further and
further negative as the page scrolled; with no `overflow` set on `.table-wrapper` at all, it stayed
pinned at `0` from the top of the table all the way to the bottom.

With `.table-wrapper` clean, nothing between the `th` and the document root (`.dashboard`, `body`,
`html`) sets its own overflow/height clip, so the document itself is the nearest scrolling ancestor
and `top: 0` pins the header to the browser viewport top as the page scrolls. Trade-off: a table
wide enough to overflow `.table-wrapper`'s box (e.g. a very narrow viewport) now scrolls the whole
page horizontally instead of being clipped to just that box — an acceptable cost for a sticky
header that actually works, and not a concern at the widths this table is designed for.

## Ingest button (demo convenience)

Not part of the real system's normal flow (evidence would normally arrive from an external
source), but needed for the demo: a button top-right opens a modal with a form to manually create
a record, which calls `POST /api/audit-entries`. On success, the new row appears (via the next
poll tick, or an immediate optimistic refresh) as `PENDING`.

The modal offers **3 template buttons**, each a one-click CTA that pre-fills every field with a
default sample scenario (fields stay editable after picking a template — the auditor can tweak
values before submitting, or just click a template then submit immediately without typing
anything):

1. **High-risk override** — matches the assessment brief's own example: `eventType: "Control
   Execution"`, `entityName: "Global Procurement Services"`, `description: "Manual approval
   override executed for vendor invoice payables exceeding $50k threshold"`, `monetaryImpact:
   85000`, `controlId: "CTRL-FIN-302"`, `actorUserId: "user_7731"`.
2. **Routine low-risk approval** — `eventType: "Transaction Approval"`, `entityName: "Regional
   Sales Division"`, `description: "Routine purchase order approval within standard delegation of
   authority limits"`, `monetaryImpact: 4200`, `controlId: "CTRL-OPS-118"`, `actorUserId:
   "user_2210"`.
3. **Emergency access anomaly** — `eventType: "Access Control Change"`, `entityName: "IT
   Infrastructure Team"`, `description: "Emergency access grant to production financial database
   outside standard change window"`, `monetaryImpact: 15000`, `controlId: "CTRL-SEC-045"`,
   `actorUserId: "user_5589"`.

All three share the same demo `tenantId` and default `timestamp` to "now" (both still editable).
`evidenceId` is template-prefilled but gets a unique suffix (e.g. timestamp/random) appended at
the moment a template is applied, so clicking the same template repeatedly doesn't submit
duplicate evidence IDs.

## Polling (no pagination)

No pagination at all. Initial load calls `GET /api/audit-entries` with no filter and populates
`entries` with every row. From then on, polling only fetches **deltas**: `GET
/api/audit-entries?since=<timestamp>`, which returns rows where either `audit_entries.updated_at`
or `audit_ai_metadata.updated_at` is newer than `since` (new entries, core-field edits, notes
edits, or worker completions — see [docs/backend.md](backend.md)).

`since` is built from `lastPolledAt` (the server's `polledAt` from the previous response, not the
client's own clock — avoids client/server clock drift) minus a 1s overlap buffer, so a row updated
right at the edge of the previous poll window can't slip through uncaught.

Poll results are **merged** into `entries` by `id`, not replaced wholesale: an id already present
gets updated in place, an id not yet present gets prepended (new entries are always newest-first,
matching initial load's ordering). Since the table's `v-for` is keyed by `entry.id`, this merge
lets Vue's diffing patch only the DOM for rows that actually changed, not the whole table.

Poll cadence: flat 5s interval, always — no fast/slow split. New entries need to surface within a
few seconds regardless of whether anything is currently `PENDING`, so there's no idle-slowdown
case to special-case here.

Creating a record (ingest modal) or saving an edit both merge their result directly into `entries`
the same way, instead of triggering a full refetch.

## Composables

Each modal gets its own dedicated composable in `frontend/src/composables/`, importable on its own
for that specific modal, instead of one generic `useModal()` paired with a separate plain data ref:

- **`useIngestModal(callbacks?: { onCreated?: (entry: AuditEntry) => void })`**
  (`useIngestModal.ts`) — returns `{ isOpen, open, close, handleCreated }`. `handleCreated(entry)`
  just invokes `callbacks.onCreated?.(entry)`.
- **`useEditModal(callbacks?: { onSubmitted?: (entry: AuditEntry) => void })`**
  (`useEditModal.ts`) — returns `{ isOpen, selectedEntry, open, close, handleSubmitted }`.
  `open(entry: AuditEntry)` sets `selectedEntry.value = entry` and flips `isOpen` true.
  `handleSubmitted(entry)` just invokes `callbacks.onSubmitted?.(entry)`.
- **`useSimilarityModal()`** (`useSimilarityModal.ts`) — returns `{ isOpen, selectedEntry, open,
  close }`. `open(entry: AuditEntry)` guards on `entry.aiMetadata.status === 'PENDING'` (mirrors
  the row button's `disabled`, a second line of defense), otherwise sets `selectedEntry.value =
  entry` and flips `isOpen` true immediately — no callback, since nothing about a similarity
  search needs to notify the rest of the app.

Each composable owns its `isOpen` ref and `open()`/`close()` toggles directly, inline — there's no
shared `useModal()` helper. That's a 3-line pattern (one `ref`, two one-line functions); duplicating
it across the three composables is cheaper than the indirection of a shared wrapper.

**A modal composable owns only what the parent container needs to see or react to — never the
actual API-call logic.** That's: the open/closed flag and its toggles, a `selectedEntry` ref for
whatever data needs to be passed down to the modal as a prop, and callback registration
(`onSubmitted`, `onCreated`, ...) for events the parent needs to react to (e.g. merging a result
into `entries`) — passed in at construction time, never wrapped in a component-local handler
function. The actual submit/create/fetch logic is the same regardless of where the modal is used,
so it lives inside the modal's own `.vue` component (exactly like `IngestModal.vue` already did),
not in the composable — **`EditModal.vue` and `SimilarityModal.vue` both call their own API
functions (`updateAuditEntry`, `fetchSimilarEntries`) directly inside their own `<script setup>`**,
triggered by their own `open`/`entry` prop, and emit an event (`submitted`, or nothing for
similarity) when done. The composable's exposed method (`handleSubmitted`, `handleCreated`) is
just a forwarder the component's template binds to directly (`@submitted="editModal.handleSubmitted"`,
`@created="ingestModal.handleCreated"`) — never a separate component-local wrapper function. This
keeps the modal's actual behavior colocated with its own template/props (so it's copy-pasteable as
one `.vue` file), while the composable stays a thin, parent-visible surface. Apply this every time
a modal composable or its component is created or touched.

## Modal isolation from polling

`editModal` and `similarityModal` are populated as a **snapshot at open time**, not a live
reactive binding into the polled `entries` array. The poll refresh function only ever
reads/writes `entries` — it never touches modal state. This guarantees:
- A background poll tick can never close an open modal.
- An open modal can never end up showing a different record than the one it was opened for.
- Unsaved in-progress edits in the edit form are never silently overwritten by a poll refresh.

## Edit modal

Single form covering both core fields (`monetaryImpact`, `description`, `controlId`) and
`auditorNotes`, submitted together via `PUT /api/audit-entries/:id`. The backend's delta logic
(see [docs/backend.md](backend.md)) decides server-side whether this was a core-field change (AI
requeue) or notes-only (fast track) — the frontend just reacts to what comes back:
- If the response's `status` is `PENDING`, show an "AI is reprocessing this record" indicator on
  that row.
- If `status` stays `COMPLETED`, the save is done immediately, no reprocessing indicator.

`auditorNotes` is disabled in the form while the record's current `status` is `PENDING` — an
auditor can't annotate a record that hasn't received a risk assessment yet. It becomes editable
once `status` is `COMPLETED`.

## Similarity modal

Opened via a per-row "Find Similar" button, which opens the modal immediately (same as Ingest/Edit)
rather than fetching first — `SimilarityModal.vue` itself calls `GET /api/audit-entries/:id/similar`
internally once it's open (triggered off its own `open`/`entry` props), showing its own loading
state inside the modal while waiting, then displaying the 3 full matched records plus their
similarity scores.

The button is **disabled while the row's `status` is `PENDING`**, with a tooltip ("Available once
AI processing completes") explaining why — a record without a completed risk assessment has no
`semantic_vector` to compare against, so there's nothing to search yet. `similarityModal.open`
also guards on this itself (not just the disabled attribute) as a second line of defense. The backend
enforces the same rule independently (`409` for a not-yet-`COMPLETED` record — see
[docs/backend.md](backend.md)), so this is blocked on both ends, not just hidden in the UI.

## Logging

Plain `console.log`/`console.error`/`console.warn` throughout — no logging library. Purely for a
developer watching the browser dev console to follow along in real time; it never changes
behavior. Each line is prefixed by area so devtools filtering (typing the prefix into the console
filter box) isolates one concern:

- `[poll]` — `AuditDashboard.vue`'s `loadInitial()` and `pollTick()`: initial load count/failure,
  and each poll tick's outcome (delta row count, or 0 when nothing changed; failures keep the
  original error object logged via `console.error`).
- `[ingest]` — `IngestModal.vue`'s `submit()`: logs before calling `createAuditEntry` and then
  either the new entry's id on success or the error message on failure.
- `[edit]` — `EditModal.vue`'s `submit()`: logs before calling `updateAuditEntry` and then either
  the updated entry's id plus resulting `status` (`PENDING`/`COMPLETED`) on success, or the error
  message on failure.
- `[similarity]` — `SimilarityModal.vue`'s internal fetch watcher: logs before calling
  `fetchSimilarEntries` and then either the match count on success or the error message on
  failure.

No secrets are ever logged — `VITE_API_BASE_URL` is just a base URL, not sensitive, and nothing
else client-side warrants redaction.

## API error handling (`frontend/src/api/client.ts`)

`request()`'s shared fetch wrapper throws `ApiError` (extends `Error`) on any non-2xx response, and
deliberately keeps two separate strings on it instead of one:
- `.message` (inherited from `Error`) — the full technical string: method, path, status, and raw
  response body. This is what a `console.error(err)` call prints, so devtools/logs retain everything
  needed to debug (matches the `[poll]`/`[ingest]`/`[edit]`/`[similarity]` logging above).
- `.userMessage` — just the parsed response body's `.error` field (falling back to a generic
  `Request failed (<status>)` if the body isn't JSON or has no `.error`). This is the only thing
  ever bound into a `<p v-if="error">` banner.

Every call site that sets a component's `error` ref (`AuditDashboard.vue`'s `loadInitial()`,
`IngestModal.vue`/`EditModal.vue`/`SimilarityModal.vue`'s `submit()`/fetch handlers) follows the
same pattern: `err instanceof ApiError ? err.userMessage : err instanceof Error ? err.message : '<fallback>'`,
and the paired `console.error` logs the original `err` object (not `error.value`) so the full
technical detail is never lost even though the UI-facing message is clean.
