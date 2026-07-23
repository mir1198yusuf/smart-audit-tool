<template>
  <div v-if="open" class="modal-overlay" @click.self="close">
    <div class="modal">
      <header class="modal-header">
        <h2>Edit Audit Entry #{{ entryId }}</h2>
        <button class="icon-btn" type="button" @click="close">&times;</button>
      </header>

      <form @submit.prevent="submit">
        <label>
          Monetary Impact
          <input v-model.number="form.monetaryImpact" type="number" step="0.01" />
        </label>
        <label>
          Description
          <textarea v-model="form.description" rows="3"></textarea>
        </label>
        <label>
          Control ID
          <input v-model="form.controlId" type="text" />
        </label>
        <label>
          Auditor Notes
          <textarea
            v-model="form.auditorNotes"
            rows="3"
            :disabled="notesDisabled"
            :placeholder="notesDisabled ? 'Available once AI risk assessment completes' : ''"
          ></textarea>
        </label>

        <p v-if="reprocessing" class="info-banner">AI is reprocessing this record.</p>
        <p v-else-if="saved" class="success-banner">Saved.</p>
        <p v-if="error" class="form-error">{{ error }}</p>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="close">Close</button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ApiError, updateAuditEntry } from '../api/client';
import type { AiStatus, AuditEntry, EditForm } from '../types/audit';

// ===== helpers =====
function blankForm(): EditForm {
  return { monetaryImpact: 0, description: '', controlId: '', auditorNotes: '' };
}

// ===== props =====
const props = defineProps<{
  open: boolean;
  entry: AuditEntry | null;
}>();

// ===== emits =====
const emit = defineEmits<{
  (e: 'submitted', entry: AuditEntry): void;
  (e: 'close'): void;
}>();

// ===== reactive vars =====
const entryId = ref<number | null>(null);
const status = ref<AiStatus | null>(null);
const form = reactive<EditForm>(blankForm());
const saving = ref(false);
const reprocessing = ref(false);
const saved = ref(false);
const error = ref<string | null>(null);

// ===== computed =====
const notesDisabled = computed((): boolean => {
  return status.value === 'PENDING';
});

// ===== methods =====
function close() {
  emit('close');
}

// Guards on the locally snapshotted entryId (not props.entry, which may have
// moved on since open time under polling) — submits the current form fields
// via PUT, then updates the local status/reprocessing/saved state from the
// response and notifies the parent so it can merge the updated entry into
// `entries` itself.
async function submit() {
  if (entryId.value === null) return;
  saving.value = true;
  error.value = null;
  saved.value = false;
  console.log(`[edit] submitting update for entry id=${entryId.value}…`);
  try {
    const updated = await updateAuditEntry(entryId.value, {
      monetaryImpact: form.monetaryImpact,
      description: form.description,
      controlId: form.controlId,
      auditorNotes: form.auditorNotes,
    });
    status.value = updated.aiMetadata.status;
    reprocessing.value = updated.aiMetadata.status === 'PENDING';
    saved.value = !reprocessing.value;
    console.log(`[edit] update succeeded for entry id=${updated.id}, status=${updated.aiMetadata.status}`);
    emit('submitted', updated);
  } catch (err) {
    error.value = err instanceof ApiError
      ? err.userMessage
      : err instanceof Error ? err.message : 'Failed to save changes.';
    console.error(`[edit] update failed for entry id=${entryId.value}:`, err);
  } finally {
    saving.value = false;
  }
}

// ===== lifecycle hooks =====
// Snapshot form/status from props.entry the moment the modal transitions to
// open — this is a one-time copy, not a live binding, so the modal-isolation
// invariant holds: if the parent's `entries` list changes underneath while
// the modal is open (via polling), the open modal's form doesn't shift under
// the user.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen || props.entry === null) return;
    entryId.value = props.entry.id;
    status.value = props.entry.aiMetadata.status;
    form.monetaryImpact = props.entry.monetaryImpact;
    form.description = props.entry.description;
    form.controlId = props.entry.controlId;
    form.auditorNotes = props.entry.aiMetadata.auditorNotes;
    saving.value = false;
    reprocessing.value = false;
    saved.value = false;
    error.value = null;
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
  width: min(520px, 92vw);
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
form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
}
input,
textarea {
  font: inherit;
  padding: 0.4rem 0.55rem;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
}
input:disabled,
textarea:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  cursor: not-allowed;
}
.info-banner {
  background: #dbeafe;
  color: #1e40af;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
}
.success-banner {
  background: #d1fae5;
  color: #065f46;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
}
.form-error {
  color: #b91c1c;
  font-size: 0.85rem;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-secondary {
  background: #e5e7eb;
  color: #111827;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  cursor: pointer;
}
</style>
