<script setup>
import { computed } from 'vue';

const WIDTH = 104;
const HEIGHT = 26;
const PADDING = 3;
const HEALTHY = 0.98;
const SHAKY = 0.9;

const props = defineProps({
  series: {
    type: Array,
    default: () => [],
  },
  subject: {
    type: String,
    default: 'the loaded deliveries',
  },
});

const plotted = computed(() => {
  const span = props.series.length > 1 ? props.series.length - 1 : 1;

  return props.series.map((value, index) => ({
    value,
    x: PADDING + (index * (WIDTH - PADDING * 2)) / span,
    y: value === null ? null : HEIGHT - PADDING - value * (HEIGHT - PADDING * 2),
  }));
});

const filled = computed(() => plotted.value.filter((point) => point.y !== null));

// Two points are the minimum that can describe a direction; one dot on its own
// would read as a trend it cannot support, so the whole graphic is dropped.
const drawable = computed(() => filled.value.length >= 2);

const segments = computed(() => {
  const runs = [];
  let current = [];

  for (const point of plotted.value) {
    if (point.y === null) {
      if (current.length > 1) {
        runs.push(current);
      }

      current = [];
    } else {
      current.push(point);
    }
  }

  if (current.length > 1) {
    runs.push(current);
  }

  return runs.map((run) =>
    run.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
  );
});

const last = computed(() => filled.value[filled.value.length - 1] ?? null);

const lastTone = computed(() => {
  if (last.value === null) {
    return 'text-skip';
  }

  if (last.value.value >= HEALTHY) {
    return 'text-ok';
  }

  return last.value.value >= SHAKY ? 'text-retry' : 'text-fail';
});

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

const ariaLabel = computed(() => {
  const values = filled.value.map((point) => point.value);
  const first = percent(values[0]);
  const latest = percent(values[values.length - 1]);
  const lowest = percent(Math.min(...values));

  return `Success rate across ${props.subject}, oldest first: from ${first} to ${latest}, lowest ${lowest}.`;
});
</script>

<template>
  <svg
    v-if="drawable"
    :width="WIDTH"
    :height="HEIGHT"
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    role="img"
    :aria-label="ariaLabel"
    class="shrink-0 overflow-visible text-ok"
  >
    <polyline
      v-for="(segment, index) in segments"
      :key="index"
      :points="segment"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle v-if="last" :cx="last.x" :cy="last.y" r="2.2" fill="currentColor" :class="lastTone" />
  </svg>
</template>
