<script setup>
import { computed } from 'vue';
import { resolveStatusMeta } from './status.js';

const props = defineProps({
  status: {
    type: String,
    required: true,
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['md', 'sm'].includes(value),
  },
});

const meta = computed(() => resolveStatusMeta(props.status));

const isSmall = computed(() => props.size === 'sm');

const pillClasses = computed(() =>
  isSmall.value ? 'gap-1 px-1.5 py-px text-[11px]' : 'gap-1.5 px-2 py-0.5 text-xs',
);

const glyphClasses = computed(() => (isSmall.value ? 'h-2.5 w-2.5' : 'h-3 w-3'));
</script>

<template>
  <span
    class="inline-flex max-w-full items-center rounded-full font-medium"
    :class="[meta.softClass, meta.textClass, pillClasses]"
  >
    <svg
      class="shrink-0"
      :class="glyphClasses"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline v-if="meta.glyph === 'check'" points="2.2,6.4 4.8,9 9.8,3.2" />
      <template v-else-if="meta.glyph === 'circular-arrow'">
        <path d="M9.7 6a3.7 3.7 0 1 1-1.2-2.73" />
        <polyline points="9.9,1.5 9.9,3.9 7.5,3.9" />
      </template>
      <template v-else-if="meta.glyph === 'cross'">
        <line x1="3" y1="3" x2="9" y2="9" />
        <line x1="9" y1="3" x2="3" y2="9" />
      </template>
      <template v-else-if="meta.glyph === 'clock'">
        <circle cx="6" cy="6" r="4.2" />
        <polyline points="6,3.3 6,6.2 8,7.4" />
      </template>
      <polygon
        v-else-if="meta.glyph === 'triangle'"
        points="3.2,2 10,6 3.2,10"
        fill="currentColor"
        stroke="none"
      />
      <template v-else>
        <circle cx="6" cy="6" r="4.2" />
        <line x1="3.2" y1="8.8" x2="8.8" y2="3.2" />
      </template>
    </svg>
    <span class="truncate">{{ meta.label }}</span>
  </span>
</template>
