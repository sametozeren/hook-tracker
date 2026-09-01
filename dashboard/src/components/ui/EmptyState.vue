<script setup>
import { useSlots } from 'vue';

defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
});

const slots = useSlots();
</script>

<template>
  <div class="rounded-md border border-rule-soft bg-surface px-4 py-6">
    <h2 class="text-sm font-medium text-ink">{{ title }}</h2>
    <p v-if="description" class="mt-1 max-w-prose text-sm break-words text-muted">
      {{ description }}
    </p>
    <div v-if="slots.default" class="mt-3 max-w-prose text-sm text-muted">
      <slot />
    </div>
    <div v-if="slots.actions" class="mt-4 flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
