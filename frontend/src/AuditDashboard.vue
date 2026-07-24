<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <h1>Audit Entries</h1>
      <div v-if="loading" class="initial-load-indicator" role="status" aria-live="polite">
        <svg class="clock-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
          <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span v-if="slowLoad" class="initial-load-hint">Free-tier hosting — this can take a bit longer to wake up</span>
      </div>
      <div class="new-entry-group">
        <span class="new-entry-hint">Quick testing — skip the API</span>
        <button type="button" class="btn-primary" @click="ingestModal.open()">
          + New Entry
        </button>
      </div>
    </header>

    <p v-if="error" class="form-error">{{ error }}</p>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Entity</th>
            <th>Event Type</th>
            <th>Timestamp</th>
            <th>Description</th>
            <th class="numeric-col">Monetary Impact</th>
            <th>Control ID</th>
            <th>Status</th>
            <th>AI Summary</th>
            <th class="numeric-col">Risk Score</th>
            <th>Anomaly Flags</th>
            <th>Auditor Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.id">
            <td>{{ entry.id }}</td>
            <td>{{ entry.entityName }}</td>
            <td>{{ entry.eventType }}</td>
            <td>{{ formatTimestamp(entry.timestamp) }}</td>
            <td class="description-cell">{{ entry.description }}</td>
            <td class="numeric-col">{{ entry.monetaryImpact.toLocaleString() }}</td>
            <td>{{ entry.controlId }}</td>
            <td>
              <StatusBadge :status="entry.aiMetadata.status" :risk-level="entry.aiMetadata.riskLevel" />
            </td>
            <td class="summary-cell">{{ entry.aiMetadata.aiSummary ?? '—' }}</td>
            <td class="numeric-col">{{ entry.aiMetadata.riskScore ?? '—' }}</td>
            <td class="anomaly-cell">
              <div class="anomaly-inner">
                <template v-if="entry.aiMetadata.anomalyFlags.length > 0">
                  <span
                    v-for="flag in entry.aiMetadata.anomalyFlags"
                    :key="flag"
                    class="anomaly-chip"
                  >{{ flag }}</span>
                </template>
                <template v-else>—</template>
              </div>
            </td>
            <td class="notes-cell">{{ entry.aiMetadata.auditorNotes || '—' }}</td>
            <td class="actions-cell">
              <div class="actions-inner">
                <button type="button" class="btn-action btn-edit" @click="editModal.open(entry)">Edit</button>
                <button
                  type="button"
                  class="btn-action btn-similar"
                  :disabled="entry.aiMetadata.status === 'PENDING'"
                  :title="entry.aiMetadata.status === 'PENDING' ? 'Available once AI processing completes' : undefined"
                  @click="similarityModal.open(entry)"
                >
                  Find Similar
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && entries.length === 0">
            <td colspan="13" class="empty-cell">No audit entries yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <IngestModal :open="ingestModal.isOpen.value" @close="ingestModal.close()" @created="ingestModal.handleCreated" />

    <EditModal
      :open="editModal.isOpen.value"
      :entry="editModal.selectedEntry.value"
      @submitted="editModal.handleSubmitted"
      @close="editModal.close()"
    />

    <SimilarityModal
      :open="similarityModal.isOpen.value"
      :entry="similarityModal.selectedEntry.value"
      @close="similarityModal.close()"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import StatusBadge from './components/StatusBadge.vue';
import IngestModal from './components/IngestModal.vue';
import EditModal from './components/EditModal.vue';
import SimilarityModal from './components/SimilarityModal.vue';
import { useIngestModal } from './composables/useIngestModal';
import { useEditModal } from './composables/useEditModal';
import { useSimilarityModal } from './composables/useSimilarityModal';
import { ApiError, fetchAuditEntries } from './api/client';
import type { AuditEntry } from './types/audit';

// ===== constants =====
const POLL_INTERVAL_MS = 5000;
// Subtracted from lastPolledAt when building the next poll's `since` — absorbs latency/clock
// jitter between "server computed this snapshot" and "client stores it," so a row updated right
// at the edge of the window can't slip through uncaught.
const POLL_OVERLAP_MS = 1000;

// ===== helpers =====
// Display-only formatting for entry.timestamp (client-supplied — when the event occurred at the
// source system, NOT createdAt/updatedAt which are our own DB's insert/modify times).
function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

function mergeEntries(existing: AuditEntry[], updates: AuditEntry[]): AuditEntry[] {
  const merged = [...existing];
  for (const update of updates) {
    const idx = merged.findIndex((entry) => entry.id === update.id);
    if (idx === -1) {
      merged.unshift(update); // new entry — newest first, matches initial load's ordering
    } else {
      merged[idx] = update;
    }
  }
  return merged;
}

// ===== reactive vars =====
const entries = ref<AuditEntry[]>([]);
const lastPolledAt = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
// Set only while the very first `loadInitial()` call is outstanding, past 3s — never touched
// by pollTick, so it can't resurface on a slow background poll, only on the initial page load.
const slowLoad = ref(false);

// Each modal composable owns its own open/closed flag AND (for edit/similarity)
// its snapshot data ref, fully decoupled from `entries` — polling logic only
// ever touches `entries`, never these, per the modal-isolation invariant.
// Callbacks are passed in at construction time so the composable's own
// exposed method (submit/handleCreated) is what the template binds to
// directly — no component-local wrapper function in between.
const ingestModal = useIngestModal({
  onCreated: (created) => {
    entries.value = mergeEntries(entries.value, [created]);
  },
});
const editModal = useEditModal({
  onSubmitted: (updated) => {
    entries.value = mergeEntries(entries.value, [updated]);
  },
});
const similarityModal = useSimilarityModal();
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null);

// ===== methods =====
async function loadInitial() {
  loading.value = true;
  slowLoad.value = false;
  // Render's free-tier cold start can take several seconds — only mention it if the initial
  // fetch is still outstanding after 3s, so a normal fast load never flashes this message.
  const slowLoadTimer = setTimeout(() => {
    slowLoad.value = true;
  }, 3000);
  console.log('[poll] loading initial entries…');
  try {
    const res = await fetchAuditEntries();
    entries.value = res.data;
    lastPolledAt.value = res.polledAt;
    error.value = null;
    console.log(`[poll] initial load complete: ${res.data.length} entries`);
  } catch (err) {
    error.value = err instanceof ApiError
      ? err.userMessage
      : err instanceof Error ? err.message : 'Failed to load audit entries.';
    console.error('[poll] initial load failed:', err);
  } finally {
    clearTimeout(slowLoadTimer);
    loading.value = false;
  }
}

function schedulePoll() {
  if (pollTimer.value !== null) clearTimeout(pollTimer.value);
  pollTimer.value = setTimeout(pollTick, POLL_INTERVAL_MS);
}

// Recursive setTimeout, not setInterval: schedulePoll() is only called again from pollTick's
// finally block, i.e. only after the previous request fully settles. setInterval would keep
// firing on a fixed clock even if a request is slow, stacking up overlapping requests whose
// responses could resolve out of order.
async function pollTick() {
  try {
    const since = lastPolledAt.value
      ? new Date(new Date(lastPolledAt.value).getTime() - POLL_OVERLAP_MS).toISOString()
      : undefined;
    const res = await fetchAuditEntries(since);
    entries.value = mergeEntries(entries.value, res.data);
    lastPolledAt.value = res.polledAt;
    if (res.data.length > 0) {
      console.log(`[poll] delta received: ${res.data.length} row(s) updated since ${since ?? '(none)'}`);
    } else {
      console.log('[poll] delta received: 0 rows (no changes)');
    }
  } catch (err) {
    console.error('[poll] poll failed:', err);
  } finally {
    schedulePoll();
  }
}

// ===== lifecycle hooks =====
onMounted(async () => {
  await loadInitial();
  schedulePoll();
});

onBeforeUnmount(() => {
  if (pollTimer.value !== null) clearTimeout(pollTimer.value);
});
</script>

<style scoped>
.dashboard {
  max-width: 1800px;
  margin: 0 auto;
  padding: 1.5rem;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--text, #111827);
}
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.dashboard-header h1 {
  font-size: 1.4rem;
  margin: 0;
}
.initial-load-indicator {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted, #6b7280);
}
.clock-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  animation: clock-pulse 1.4s ease-in-out infinite;
}
@keyframes clock-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.initial-load-hint {
  font-size: 0.75rem;
  color: var(--text-muted, #6b7280);
  white-space: nowrap;
}
.new-entry-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.new-entry-hint {
  font-size: 0.75rem;
  color: var(--text-muted, #6b7280);
  white-space: nowrap;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-weight: 600;
}
.table-wrapper {
  /* No `overflow` property set here at all, on purpose — verified live (not just reasoned
     about) that setting `overflow-x: auto` here, even alone, breaks the header's
     `position: sticky`. The CSS overflow computed-value rule forces overflow-y's *used*
     value to `auto` too as soon as overflow-x is non-visible, and — contrary to the
     previous assumption here — that alone is enough for the browser to treat this element
     as the nearest ancestor scroll container for any sticky descendant, regardless of
     whether this box actually overflows. Since this wrapper never scrolls itself (the
     window does), the sticky `th` ended up "stuck" relative to a container that never
     moves, which visually looks identical to not being sticky at all. With no overflow
     set here, the document/window is unambiguously the nearest scrolling ancestor, so
     `top: 0` on `th` pins it to the real viewport as the page scrolls. Trade-off: a table
     wide enough to overflow this box (e.g. very narrow viewport) now scrolls the whole
     page horizontally instead of just this box — an acceptable cost for a sticky header
     that actually works, and not a concern at the widths this table is designed for. */
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th,
td {
  text-align: left;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
}
th {
  background: #f8fafc;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #64748b;
  border-bottom: 2px solid #2563eb;
  /* Sticks relative to the page/document viewport, not any bounded inner box:
     .table-wrapper no longer has overflow-y/max-height, .dashboard has no height cap
     or overflow of its own, and neither html nor body clip/scroll independently — so
     the browser window itself is the nearest scrolling ancestor and `top: 0` pins the
     header to the top of the viewport as the whole page scrolls. Background must stay
     solid (it already is: #f8fafc, opaque) so rows don't show through while pinned, and
     the existing border-bottom/box-shadow are preserved so the pinned header still reads
     as an intentional header bar rather than a rendering glitch. */
  position: sticky;
  top: 0;
  z-index: 1;
}
.numeric-col {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
tbody tr {
  transition: background-color 0.15s ease;
}
/* Zebra striping: #f1f5f9 chosen specifically because #f8fafc (used elsewhere, e.g. the
   header background) reads as "basically white" — this is one step further down the
   slate-gray scale so alternating rows are clearly perceptible at a glance, not just
   technically present. */
tbody tr:nth-child(even) {
  background-color: #f1f5f9;
}
/* Declared after nth-child(even) so it wins on equal specificity: hover always renders
   this same distinct blue tint (not layered/added on top of the stripe), so striped and
   unstriped rows both get an unambiguous, identical hover state instead of the tint and
   stripe cancelling out or blending into each other. */
tbody tr:hover {
  background-color: rgba(37, 99, 235, 0.08);
}
.description-cell,
.summary-cell,
.notes-cell {
  max-width: 340px;
  white-space: normal;
  overflow-wrap: break-word;
}
.actions-cell {
  white-space: nowrap;
}
.actions-inner {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}
.anomaly-cell {
  max-width: 220px;
}
.anomaly-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.anomaly-chip {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  background: #e5e7eb;
  color: #374151;
}
.btn-action {
  display: inline-block;
  border-radius: 5px;
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.btn-edit {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  color: #374151;
}
.btn-edit:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.btn-similar {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #2563eb;
}
.btn-similar:hover:not(:disabled) {
  background: #dbeafe;
  border-color: #93c5fd;
}
.btn-action:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.btn-action:disabled {
  background: #f8fafc;
  border-color: #e2e8f0;
  color: #94a3b8;
  cursor: not-allowed;
}
.empty-cell {
  text-align: center;
  color: #94a3b8;
  padding: 2rem;
}
.form-error {
  color: #b91c1c;
  font-size: 0.9rem;
}
</style>
