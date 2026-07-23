import { ref } from 'vue';
import type { AuditEntry } from '../types/audit';

// ===== types =====
export interface UseIngestModalCallbacks {
  onCreated?: (entry: AuditEntry) => void;
}

// Ingest modal owns no snapshot data of its own — IngestModal.vue manages its
// own form state internally, so this composable is just a dedicated open/closed
// flag for the ingest dialog.
//
// `onCreated` is passed in at construction time (never wrapped in a
// component-local handler) and is invoked by `handleCreated`, which the
// consuming component's template binds to directly (`@created="ingestModal.handleCreated"`).
export function useIngestModal(callbacks: UseIngestModalCallbacks = {}) {
  // ===== reactive vars =====
  const isOpen = ref(false);

  // ===== methods =====
  function open() {
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
  }

  function handleCreated(entry: AuditEntry) {
    callbacks.onCreated?.(entry);
  }

  return { isOpen, open, close, handleCreated };
}
