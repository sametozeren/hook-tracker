<script setup>
import UiButton from './UiButton.vue';

defineProps({
  title: {
    type: String,
    default: 'Something failed to load.',
  },
  detail: {
    type: String,
    default: '',
  },
  requestId: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['retry']);
</script>

<template>
  <div class="rounded-md border border-rule bg-fail-soft px-4 py-4" role="alert">
    <h2 class="text-sm font-medium text-fail">{{ title }}</h2>
    <p v-if="detail" class="mt-1 max-w-prose text-sm break-words text-ink">{{ detail }}</p>
    <p class="mt-1 max-w-prose text-sm text-muted">Retry the request, or check the API logs.</p>
    <p v-if="requestId" class="mt-2 text-xs text-faint">
      Request id
      <span class="font-mono break-all text-muted">{{ requestId }}</span>
    </p>
    <div class="mt-4">
      <UiButton size="sm" @click="emit('retry')">Try again</UiButton>
    </div>
  </div>
</template>
