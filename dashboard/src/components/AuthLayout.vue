<script setup>
import { useSlots } from 'vue';
import BrandMark from './ui/BrandMark.vue';

defineProps({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    default: '',
  },
});

const slots = useSlots();
</script>

<template>
  <main class="flex min-h-full flex-col justify-center bg-page px-4 py-10 text-ink sm:py-14">
    <div class="mx-auto w-full max-w-sm">
      <p class="flex items-center gap-2 text-ink">
        <BrandMark :size="24" />
        <span class="eyebrow">hook-tracker</span>
      </p>

      <div class="mt-3 rounded-lg border border-rule bg-surface px-5 py-6 sm:px-6">
        <h1 class="text-base font-medium text-ink">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 text-sm text-muted">{{ subtitle }}</p>

        <div class="mt-6">
          <slot />
        </div>
      </div>

      <div v-if="slots.footer" class="mt-4 text-sm text-muted">
        <slot name="footer" />
      </div>
    </div>
  </main>
</template>
