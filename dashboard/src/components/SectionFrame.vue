<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  heading: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
});
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <component :is="heading ? 'p' : 'h2'" class="eyebrow">{{ title }}</component>
        <h1 v-if="heading" class="mt-1 text-lg font-medium text-ink">{{ heading }}</h1>
        <p v-if="description" class="mt-1.5 max-w-prose text-sm text-muted">{{ description }}</p>
        <slot name="note" />
      </div>

      <slot name="actions" />
    </div>

    <slot />
  </section>
</template>
