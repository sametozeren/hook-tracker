<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: {
    type: Number,
    default: null,
  },
  errorCode: {
    type: String,
    default: null,
  },
});

const statusClass = computed(() => {
  const family = Math.floor(props.status / 100);

  if (family === 2) {
    return 'text-ok';
  }

  if (family === 4) {
    return 'text-retry';
  }

  if (family === 5) {
    return 'text-fail';
  }

  return 'text-muted';
});
</script>

<template>
  <span
    v-if="status !== null && status !== undefined"
    class="tnum font-mono text-xs"
    :class="statusClass"
  >
    {{ status }}
  </span>
  <span v-else-if="errorCode" class="font-mono text-[11px] break-all text-fail">
    {{ errorCode }}
  </span>
  <span v-else class="font-mono text-xs text-faint">—</span>
</template>
