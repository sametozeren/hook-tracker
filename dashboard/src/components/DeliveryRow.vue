<script>
export const DELIVERY_GRID =
  'md:grid-cols-[118px_minmax(0,1fr)_minmax(0,1.5fr)_86px_62px_82px_62px] md:gap-x-3.5';
</script>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useEndpointsStore } from '../stores/endpoints.js';
import AttemptLadder from './ui/AttemptLadder.vue';
import RelativeTime from './ui/RelativeTime.vue';
import ResponseCode from './ui/ResponseCode.vue';
import StatusPill from './ui/StatusPill.vue';

const RESET = 'md:col-start-auto md:col-end-auto md:row-start-auto';

// lastError is a human message, not a short code, and the cell it lands in is
// 62px wide; the untruncated string would set the height of the whole row.
const ERROR_CODE_MAX = 18;

const props = defineProps({
  delivery: {
    type: Object,
    required: true,
  },
  projectId: {
    type: String,
    required: true,
  },
  query: {
    type: Object,
    default: () => ({}),
  },
  now: {
    type: Number,
    default: () => Date.now(),
  },
  selected: {
    type: Boolean,
    default: false,
  },
});

const gridClass = DELIVERY_GRID;

const endpoints = useEndpointsStore();

const endpointName = computed(() => endpoints.displayName(props.delivery.endpointId));

const duration = computed(() => {
  const value = props.delivery.lastDurationMs;

  return value === null || value === undefined ? '—' : `${value.toLocaleString('en-US')} ms`;
});

const shortError = computed(() => {
  const value = props.delivery.lastError;

  if (!value) {
    return null;
  }

  return value.length > ERROR_CODE_MAX ? `${value.slice(0, ERROR_CODE_MAX - 1)}…` : value;
});

const target = computed(() => ({
  name: 'delivery',
  params: { projectId: props.projectId, deliveryId: props.delivery.id },
  query: props.query,
}));
</script>

<template>
  <RouterLink
    :to="target"
    class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 rounded-lg border border-rule p-3 text-ink md:items-center md:gap-y-0 md:rounded-none md:border-0 md:border-b md:border-rule-soft md:px-2.5 md:py-2.5 hover:bg-sunken"
    :class="[gridClass, selected ? 'bg-sunken' : 'bg-surface md:bg-transparent']"
  >
    <span class="col-start-1 col-end-2 row-start-1 min-w-0" :class="RESET">
      <StatusPill :status="delivery.status" size="sm" />
    </span>

    <span
      class="col-start-1 col-end-3 row-start-3 truncate font-mono text-[13px] text-muted md:text-ink"
      :class="RESET"
    >
      {{ delivery.eventType }}
    </span>

    <span class="col-start-1 col-end-3 row-start-2 min-w-0" :class="RESET">
      <span class="block truncate text-[13px] text-muted">{{ endpointName }}</span>
      <span class="tnum block truncate font-mono text-[11px] text-faint">
        {{ delivery.endpointId }}
      </span>
    </span>

    <span class="col-start-1 col-end-3 row-start-4" :class="RESET">
      <AttemptLadder :attempt-count="delivery.attemptCount" :status="delivery.status" />
    </span>

    <span
      class="col-start-1 col-end-2 row-start-5 min-w-0 truncate md:justify-self-end"
      :class="RESET"
      :title="delivery.lastError || undefined"
    >
      <ResponseCode :status="delivery.lastResponseStatus" :error-code="shortError" />
    </span>

    <span
      class="tnum col-start-2 col-end-3 row-start-5 justify-self-end font-mono text-xs text-muted"
      :class="RESET"
    >
      {{ duration }}
    </span>

    <span class="col-start-2 col-end-3 row-start-1 justify-self-end" :class="RESET">
      <RelativeTime :value="delivery.createdAt" :now="now" />
    </span>
  </RouterLink>
</template>
