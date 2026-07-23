<template>
  <div v-if="open" class="modal-overlay" @click.self="close">
    <div class="modal">
      <header class="modal-header">
        <h2>New Audit Entry</h2>
        <button class="icon-btn" type="button" @click="close">&times;</button>
      </header>

      <div class="templates">
        <button
          v-for="template in templates"
          :key="template.label"
          type="button"
          class="template-btn"
          @click="applyTemplate(template)"
        >
          {{ template.label }}
        </button>
      </div>

      <p class="info-text">Fill in the fields below, or use a template above for quicker testing.</p>

      <form @submit.prevent="submit">
        <label>
          Event Type
          <input v-model="form.eventType" type="text" required />
        </label>
        <label>
          Evidence ID
          <input v-model="form.evidenceId" type="text" required />
        </label>
        <label>
          Entity Name
          <input v-model="form.entityName" type="text" required />
        </label>
        <label>
          Description
          <textarea v-model="form.description" rows="3" required></textarea>
        </label>
        <label>
          Monetary Impact
          <input v-model.number="form.monetaryImpact" type="number" step="0.01" required />
        </label>
        <label>
          Control ID
          <input v-model="form.controlId" type="text" required />
        </label>
        <label>
          Actor User ID
          <input v-model="form.actorUserId" type="text" required />
        </label>
        <label>
          Tenant ID
          <input v-model="form.tenantId" type="text" required />
        </label>
        <label>
          Timestamp
          <input v-model="form.timestampLocal" type="datetime-local" required />
        </label>

        <p v-if="error" class="form-error">{{ error }}</p>

        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="close">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="submitting">
            {{ submitting ? 'Submitting…' : 'Submit' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ApiError, createAuditEntry } from '../api/client';
import type { AuditEntry } from '../types/audit';

// ===== types =====
interface Template {
  label: string;
  values: {
    eventType: string;
    evidenceId: string;
    entityName: string;
    description: string;
    monetaryImpact: number;
    controlId: string;
    actorUserId: string;
  };
}

// ===== constants =====
const DEMO_TENANT_ID = 'tenant_abc123';

const TEMPLATES: Template[] = [
  {
    label: 'High-risk override',
    values: {
      eventType: 'Control Execution',
      evidenceId: 'EVID-TEMPLATE-HIGHRISK',
      entityName: 'Global Procurement Services',
      description:
        'Manual approval override executed for vendor invoice payables exceeding $50k threshold',
      monetaryImpact: 85000,
      controlId: 'CTRL-FIN-302',
      actorUserId: 'user_7731',
    },
  },
  {
    label: 'Routine low-risk approval',
    values: {
      eventType: 'Transaction Approval',
      evidenceId: 'EVID-TEMPLATE-ROUTINE',
      entityName: 'Regional Sales Division',
      description: 'Routine purchase order approval within standard delegation of authority limits',
      monetaryImpact: 4200,
      controlId: 'CTRL-OPS-118',
      actorUserId: 'user_2210',
    },
  },
  {
    label: 'Emergency access anomaly',
    values: {
      eventType: 'Access Control Change',
      evidenceId: 'EVID-TEMPLATE-EMERGENCY',
      entityName: 'IT Infrastructure Team',
      description:
        'Emergency access grant to production financial database outside standard change window',
      monetaryImpact: 15000,
      controlId: 'CTRL-SEC-045',
      actorUserId: 'user_5589',
    },
  },
];

// ===== helpers =====
function nowAsDatetimeLocal(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function blankForm() {
  return {
    eventType: '',
    evidenceId: '',
    entityName: '',
    description: '',
    monetaryImpact: 0,
    controlId: '',
    actorUserId: '',
    tenantId: DEMO_TENANT_ID,
    timestampLocal: nowAsDatetimeLocal(),
  };
}

// ===== props =====
defineProps<{
  open: boolean;
}>();

// ===== emits =====
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created', entry: AuditEntry): void;
}>();

// ===== reactive vars =====
const templates = ref(TEMPLATES);
const form = ref(blankForm());
const submitting = ref(false);
const error = ref<string | null>(null);

// ===== methods =====
function applyTemplate(template: Template) {
  form.value = {
    ...form.value,
    ...template.values,
    evidenceId: `${template.values.evidenceId}-${Date.now()}`,
    tenantId: DEMO_TENANT_ID,
    timestampLocal: nowAsDatetimeLocal(),
  };
}

function close() {
  emit('close');
}

async function submit() {
  submitting.value = true;
  error.value = null;
  console.log(`[ingest] submitting new entry (evidenceId=${form.value.evidenceId})…`);
  try {
    const created: AuditEntry = await createAuditEntry({
      eventType: form.value.eventType,
      evidenceId: form.value.evidenceId,
      entityName: form.value.entityName,
      description: form.value.description,
      monetaryImpact: form.value.monetaryImpact,
      controlId: form.value.controlId,
      actorUserId: form.value.actorUserId,
      tenantId: form.value.tenantId,
      timestamp: new Date(form.value.timestampLocal).toISOString(),
    });
    console.log(`[ingest] created entry id=${created.id}`);
    emit('created', created);
    form.value = blankForm();
    emit('close');
  } catch (err) {
    error.value = err instanceof ApiError
      ? err.userMessage
      : err instanceof Error ? err.message : 'Failed to submit entry.';
    console.error('[ingest] submit failed:', err);
  } finally {
    submitting.value = false;
  }
}
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
  width: min(560px, 92vw);
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
.templates {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.template-btn {
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  cursor: pointer;
  font-size: 0.85rem;
}
.template-btn:hover {
  background: #eef2ff;
}
.info-text {
  color: #475569;
  font-size: 0.9rem;
  margin-bottom: 1rem;
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
