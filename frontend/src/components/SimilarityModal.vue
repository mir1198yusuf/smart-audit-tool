<template>
  <div v-if="open" class="modal-overlay" @click.self="close">
    <div class="modal">
      <header class="modal-header">
        <h2>Similar Entries</h2>
        <button class="icon-btn" type="button" @click="close">&times;</button>
      </header>

      <p v-if="loading" class="info-text">Searching for similar entries…</p>
      <p v-else-if="error" class="form-error">{{ error }}</p>
      <p v-else-if="results.length === 0" class="info-text">
        No similar entries found (record may not have finished AI processing yet).
      </p>

      <div v-else class="results">
        <article v-for="match in results" :key="match.id" class="result-card">
          <div class="result-header">
            <strong>{{ match.entityName }}</strong>
            <span class="similarity-score">{{ (match.similarityScore * 100).toFixed(1) }}% match</span>
          </div>
          <p class="description">{{ match.description }}</p>
          <dl>
            <div>
              <dt>Monetary Impact</dt>
              <dd>{{ match.monetaryImpact.toLocaleString() }}</dd>
            </div>
            <div>
              <dt>Control ID</dt>
              <dd>{{ match.controlId }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge :status="match.aiMetadata.status" :risk-level="match.aiMetadata.riskLevel" />
              </dd>
            </div>
            <div>
              <dt>Risk Score</dt>
              <dd>{{ match.aiMetadata.riskScore ?? '—' }}</dd>
            </div>
          </dl>
          <p v-if="match.aiMetadata.aiSummary" class="ai-summary">{{ match.aiMetadata.aiSummary }}</p>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import StatusBadge from './StatusBadge.vue';
import { ApiError, fetchSimilarEntries } from '../api/client';
import type { AuditEntry, SimilarAuditEntry } from '../types/audit';

// ===== props =====
const props = defineProps<{
  open: boolean;
  entry: AuditEntry | null;
}>();

// ===== emits =====
const emit = defineEmits<{
  (e: 'close'): void;
}>();

// ===== reactive vars =====
const loading = ref(false);
const results = ref<SimilarAuditEntry[]>([]);
const error = ref<string | null>(null);

// ===== methods =====
function close() {
  emit('close');
}

// ===== lifecycle hooks =====
// Fires the actual similarity fetch internally, triggered by the modal's own
// open/entry props rather than by a composable — mirrors IngestModal.vue's
// pattern of owning its own API call. Reset then reload each time the modal
// transitions to an open state for a given entry, so a poll tick touching
// `entries` in the parent can never affect this modal's own fetch/loading
// state (modal isolation from polling).
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen || props.entry === null) return;
    results.value = [];
    error.value = null;
    loading.value = true;
    const entryId = props.entry.id;
    console.log(`[similarity] fetching similar entries for entry id=${entryId}…`);
    fetchSimilarEntries(entryId)
      .then((res) => {
        results.value = res.similar;
        console.log(`[similarity] found ${res.similar.length} match(es) for entry id=${entryId}`);
      })
      .catch((err) => {
        error.value = err instanceof ApiError
          ? err.userMessage
          : err instanceof Error ? err.message : 'Failed to load similar entries.';
        console.error(`[similarity] fetch failed for entry id=${entryId}:`, err);
      })
      .finally(() => {
        loading.value = false;
      });
  },
);
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: var(--surface, #fff);
  color: var(--text, #111827);
  border-radius: 10px;
  padding: 1.5rem;
  width: min(680px, 92vw);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.icon-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  line-height: 1;
}
.info-text {
  color: #475569;
  font-size: 0.9rem;
}
.form-error {
  color: #b91c1c;
  font-size: 0.85rem;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.result-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.75rem 1rem;
}
.result-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.35rem;
}
.similarity-score {
  font-size: 0.8rem;
  font-weight: 600;
  color: #2563eb;
}
.description {
  font-size: 0.85rem;
  color: #334155;
  margin: 0 0 0.5rem;
}
dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.5rem;
  margin: 0 0 0.5rem;
}
dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: #94a3b8;
}
dd {
  margin: 0;
  font-size: 0.85rem;
}
.ai-summary {
  font-size: 0.8rem;
  font-style: italic;
  color: #475569;
  margin: 0;
}
</style>
