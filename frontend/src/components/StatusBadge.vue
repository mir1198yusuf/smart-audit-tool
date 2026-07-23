<template>
  <span class="status-badge" :class="badgeClass">{{ badgeLabel }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AiStatus } from '../types/audit';

// ===== props =====
const props = withDefaults(
  defineProps<{
    status: AiStatus;
    riskLevel?: string | null;
  }>(),
  {
    riskLevel: null,
  },
);

// ===== computed =====
const badgeLabel = computed((): string => {
  if (props.status === 'PENDING') return 'PENDING';
  return props.riskLevel ?? 'COMPLETED';
});

const badgeClass = computed((): string => {
  if (props.status === 'PENDING') return 'badge-pending';
  switch ((props.riskLevel ?? '').toUpperCase()) {
    case 'LOW':
      return 'badge-low';
    case 'MEDIUM':
      return 'badge-medium';
    case 'HIGH':
      return 'badge-high';
    case 'CRITICAL':
      return 'badge-critical';
    default:
      return 'badge-completed';
  }
});
</script>

<style scoped>
.status-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.badge-pending {
  background: #e5e7eb;
  color: #374151;
}
.badge-low {
  background: #d1fae5;
  color: #065f46;
}
.badge-medium {
  background: #fef3c7;
  color: #92400e;
}
.badge-high {
  background: #fed7aa;
  color: #9a3412;
}
.badge-critical {
  background: #fecaca;
  color: #991b1b;
}
.badge-completed {
  background: #dbeafe;
  color: #1e40af;
}
</style>
