<script setup>
import { computed } from 'vue';
import { formatAbsoluteUtc, formatRelativeTime } from './time.js';

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  now: {
    type: Number,
    default: () => Date.now(),
  },
});

const relative = computed(() => formatRelativeTime(props.value, props.now));

const absolute = computed(() => formatAbsoluteUtc(props.value));
</script>

<template>
  <time :datetime="value" :title="absolute" class="tnum font-mono text-xs text-muted">
    {{ relative }}
  </time>
</template>
