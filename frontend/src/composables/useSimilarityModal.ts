import { ref } from 'vue';
import type { AuditEntry } from '../types/audit';

// Owns only what the parent container needs: the open/closed flag and a
// `selectedEntry` snapshot ref for the entry to look up similar records for
// (passed down to SimilarityModal.vue as a prop). No callback is needed —
// nothing about a similarity search needs to notify the rest of the app. The
// actual fetch (`fetchSimilarEntries`) and its loading/results/error state
// live inside SimilarityModal.vue itself now, triggered by its own
// `open`/`entry` props, per the modal-composable convention (see
// docs/frontend.md).
export function useSimilarityModal() {
  // ===== reactive vars =====
  const isOpen = ref(false);
  const selectedEntry = ref<AuditEntry | null>(null);

  // ===== methods =====
  function open(entry: AuditEntry) {
    if (entry.aiMetadata.status === 'PENDING') return; // guard, mirrors the disabled row button
    selectedEntry.value = entry;
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
  }

  return { isOpen, selectedEntry, open, close };
}
