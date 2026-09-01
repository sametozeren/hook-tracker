<script setup>
import { computed } from 'vue';

const VARIANT_CLASSES = {
  default: 'border-rule bg-surface text-ink hover:bg-sunken',
  primary: 'border-pending bg-pending text-page hover:opacity-90',
  quiet: 'border-transparent bg-transparent text-muted hover:bg-sunken hover:text-ink',
  danger: 'border-fail bg-fail text-page hover:opacity-90',
};

const SIZE_CLASSES = {
  md: 'h-8 gap-2 px-3 text-sm',
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
};

const props = defineProps({
  variant: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'primary', 'quiet', 'danger'].includes(value),
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['md', 'sm'].includes(value),
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  type: {
    type: String,
    default: 'button',
  },
});

const isInert = computed(() => props.disabled || props.loading);

const variantClasses = computed(() => VARIANT_CLASSES[props.variant] ?? VARIANT_CLASSES.default);

const sizeClasses = computed(() => SIZE_CLASSES[props.size] ?? SIZE_CLASSES.md);
</script>

<template>
  <button
    :type="type"
    :disabled="isInert"
    :aria-busy="loading ? 'true' : undefined"
    class="inline-flex max-w-full items-center justify-center rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55"
    :class="[variantClasses, sizeClasses]"
  >
    <svg
      v-if="loading"
      class="h-3.5 w-3.5 shrink-0 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <span v-else-if="$slots.icon" class="inline-flex shrink-0 items-center">
      <slot name="icon" />
    </span>
    <span class="truncate">
      <slot />
    </span>
  </button>
</template>
