import { ref } from 'vue';
import type { AuditEntry } from '../types/audit';

// ===== types =====
export interface UseEditModalCallbacks {
  onSubmitted?: (entry: AuditEntry) => void;
}

// Owns only what the parent container needs: the open/closed flag, a
// `selectedEntry` snapshot ref for the entry being edited (passed down to
// EditModal.vue as a prop), and callback forwarding for the one event the
// parent needs to react to (merging the updated entry into `entries`). The
// actual form state, saving/error/status tracking, and the `updateAuditEntry`
// API call all live inside EditModal.vue itself now — this composable never
// touches them, per the modal-composable convention (see docs/frontend.md).
export function useEditModal(callbacks: UseEditModalCallbacks = {}) {
  // ===== reactive vars =====
  const isOpen = ref(false);
  const selectedEntry = ref<AuditEntry | null>(null);

  // ===== methods =====
  function open(entry: AuditEntry) {
    selectedEntry.value = entry;
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
  }

  function handleSubmitted(entry: AuditEntry) {
    callbacks.onSubmitted?.(entry);
  }

  return { isOpen, selectedEntry, open, close, handleSubmitted };
}
