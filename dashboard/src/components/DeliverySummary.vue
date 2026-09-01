<script setup>
import { computed } from 'vue';
import { useDeliveriesStore } from '../stores/deliveries.js';
import { statusLabel } from './ui/status.js';
import SuccessSparkline from './SuccessSparkline.vue';

// Three of the six counts deliberately read in text-ink rather than their status
// colour: this strip is a set of totals, and only the outcomes an operator acts
// on are coloured. These tones are not STATUS_META's and must not be unified
// with them.
const COUNT_ORDER = [
  { status: 'SUCCEEDED', tone: 'text-ok' },
  { status: 'RETRYING', tone: 'text-retry' },
  { status: 'FAILED_PERMANENTLY', tone: 'text-fail' },
  { status: 'PENDING', tone: 'text-ink' },
  { status: 'IN_FLIGHT', tone: 'text-ink' },
  { status: 'SKIPPED', tone: 'text-ink' },
];

defineProps({
  activeStatus: {
    type: String,
    default: undefined,
  },
});

const emit = defineEmits(['toggle-status']);

const deliveries = useDeliveriesStore();

const counts = computed(() =>
  COUNT_ORDER.map((entry) => ({
    ...entry,
    label: statusLabel(entry.status),
    value: deliveries.stats?.byStatus?.[entry.status] ?? 0,
  })),
);

const successRate = computed(() => {
  const stats = deliveries.stats;

  if (!stats || stats.total === 0) {
    return '—';
  }

  return `${(((stats.byStatus?.SUCCEEDED ?? 0) / stats.total) * 100).toFixed(1)}%`;
});

const latency = computed(() => deliveries.stats?.latency ?? null);
</script>

<template>
  <section
    aria-label="Project delivery summary"
    class="flex flex-wrap items-start gap-x-7 gap-y-4 rounded-lg bg-sunken px-4 py-3.5"
  >
    <div class="min-w-0">
      <p class="eyebrow">Project totals · all time</p>
      <div class="mt-2 flex flex-wrap gap-x-6 gap-y-3">
        <button
          v-for="count in counts"
          :key="count.status"
          type="button"
          class="flex flex-col gap-px border-b text-left"
          :class="activeStatus === count.status ? 'border-ink' : 'border-transparent'"
          :aria-pressed="activeStatus === count.status"
          @click="emit('toggle-status', count.status)"
        >
          <span class="tnum font-mono text-lg leading-tight font-medium" :class="count.tone">
            {{ count.value.toLocaleString('en-US') }}
          </span>
          <span class="text-xs text-muted">{{ count.label }}</span>
        </button>
      </div>
      <p class="mt-2 max-w-prose text-xs text-muted">
        Every delivery this project has ever had, whatever the filters below. Click one to filter
        the list by that status; the count itself does not change.
      </p>
    </div>

    <div class="flex flex-wrap items-start gap-x-6 gap-y-4 md:ml-auto">
      <div>
        <p class="eyebrow">Delivered · all time</p>
        <p class="tnum mt-2 font-mono text-sm font-medium text-ink">{{ successRate }}</p>
      </div>

      <div>
        <p class="eyebrow">Success rate · loaded rows</p>
        <div class="mt-2 flex items-center gap-2.5">
          <SuccessSparkline
            :series="deliveries.successRateSeries"
            :subject="`the ${deliveries.items.length} loaded deliveries`"
          />
          <span class="text-xs text-muted">
            across the {{ deliveries.items.length }} rows loaded here
          </span>
        </div>
      </div>

      <div v-if="latency">
        <p class="eyebrow">Attempt latency · all time</p>
        <p class="tnum mt-2 flex flex-wrap gap-x-3.5 font-mono text-xs text-muted">
          <span>
            attempts
            <b class="font-medium text-ink">{{ latency.attempts.toLocaleString('en-US') }}</b>
          </span>
          <span>
            avg
            <b class="font-medium text-ink">
              {{ latency.averageMs === null ? '—' : `${Math.round(latency.averageMs)} ms` }}
            </b>
          </span>
          <span>
            slowest
            <b class="font-medium text-ink">
              {{ latency.slowestMs === null ? '—' : `${Math.round(latency.slowestMs)} ms` }}
            </b>
          </span>
        </p>
      </div>
    </div>

    <p v-if="deliveries.statsError" class="w-full text-xs text-muted">
      The project totals could not be loaded. The list below is still current.
    </p>
  </section>
</template>
