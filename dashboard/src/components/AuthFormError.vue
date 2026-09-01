<script setup>
defineProps({
  message: {
    type: String,
    required: true,
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
</script>

<template>
  <div role="alert" class="rounded-md border border-rule bg-fail-soft px-4 py-3">
    <h2 class="text-sm font-medium text-fail">{{ message }}</h2>
    <p v-if="detail" class="mt-1 text-sm break-words text-ink">{{ detail }}</p>
    <slot />
    <p v-if="requestId" class="mt-2 text-xs text-faint">
      Request id
      <span class="font-mono break-all text-muted">{{ requestId }}</span>
    </p>
  </div>
</template>
