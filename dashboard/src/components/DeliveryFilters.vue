<script setup>
import { computed, ref, watch } from 'vue';
import { DELIVERY_STATUSES } from '../stores/deliveries.js';
import { statusLabel } from './ui/status.js';
import { formatAbsoluteUtc, fromDateTimeInput, toDateTimeInput } from './ui/time.js';
import FilterChip from './ui/FilterChip.vue';
import UiButton from './ui/UiButton.vue';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RANGE_PRESETS = [
  { label: 'Last hour', span: HOUR },
  { label: '24 h', span: DAY },
  { label: '7 d', span: 7 * DAY },
  { label: '30 d', span: 30 * DAY },
];

const CONTROL =
  'h-8 rounded-md border border-rule bg-surface px-2 text-sm text-ink focus:border-focus';

const props = defineProps({
  filters: {
    type: Object,
    required: true,
  },
  endpoints: {
    type: Array,
    default: () => [],
  },
  endpointName: {
    type: Function,
    default: (id) => id,
  },
});

const emit = defineEmits(['change', 'clear']);

const eventTypeDraft = ref(props.filters.eventType ?? '');

watch(
  () => props.filters.eventType,
  (value) => {
    eventTypeDraft.value = value ?? '';
  },
);

const fromDate = computed(() => toDateTimeInput(props.filters.from));

const toDate = computed(() => toDateTimeInput(props.filters.to));

const chips = computed(() => {
  const list = [];

  if (props.filters.status) {
    list.push({ key: 'status', label: 'Status', value: statusLabel(props.filters.status) });
  }

  if (props.filters.endpointId) {
    list.push({
      key: 'endpointId',
      label: 'Endpoint',
      value: props.endpointName(props.filters.endpointId),
    });
  }

  if (props.filters.eventType) {
    list.push({ key: 'eventType', label: 'Event', value: props.filters.eventType });
  }

  if (props.filters.from) {
    list.push({ key: 'from', label: 'From', value: formatAbsoluteUtc(props.filters.from) });
  }

  if (props.filters.to) {
    list.push({ key: 'to', label: 'To', value: formatAbsoluteUtc(props.filters.to) });
  }

  return list;
});

function change(patch) {
  emit('change', patch);
}

function applyPreset(span) {
  change({ from: new Date(Date.now() - span).toISOString(), to: undefined });
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
      <span class="eyebrow pb-2">Filters</span>

      <label class="flex flex-col gap-1">
        <span class="eyebrow">Status</span>
        <select
          :value="filters.status ?? ''"
          :class="CONTROL"
          @change="change({ status: $event.target.value || undefined })"
        >
          <option value="">Any status</option>
          <option v-for="status in DELIVERY_STATUSES" :key="status" :value="status">
            {{ statusLabel(status) }}
          </option>
        </select>
      </label>

      <label class="flex min-w-0 flex-col gap-1">
        <span class="eyebrow">Endpoint</span>
        <select
          :value="filters.endpointId ?? ''"
          :class="CONTROL"
          class="max-w-60 truncate"
          @change="change({ endpointId: $event.target.value || undefined })"
        >
          <option value="">Any endpoint</option>
          <option v-for="endpoint in endpoints" :key="endpoint.id" :value="endpoint.id">
            {{ endpointName(endpoint.id) }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="eyebrow">Event type</span>
        <input
          v-model="eventTypeDraft"
          type="text"
          maxlength="64"
          placeholder="order.created"
          :class="CONTROL"
          class="w-44 font-mono"
          @change="change({ eventType: eventTypeDraft.trim() || undefined })"
          @keyup.enter="change({ eventType: eventTypeDraft.trim() || undefined })"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="eyebrow">From</span>
        <input
          type="datetime-local"
          :value="fromDate"
          :class="CONTROL"
          class="tnum"
          @change="change({ from: fromDateTimeInput($event.target.value) })"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="eyebrow">To</span>
        <input
          type="datetime-local"
          :value="toDate"
          :class="CONTROL"
          class="tnum"
          @change="change({ to: fromDateTimeInput($event.target.value) })"
        />
      </label>

      <span class="flex flex-wrap items-center gap-1.5 pb-0.5">
        <UiButton
          v-for="preset in RANGE_PRESETS"
          :key="preset.label"
          variant="quiet"
          size="sm"
          @click="applyPreset(preset.span)"
        >
          {{ preset.label }}
        </UiButton>
      </span>
    </div>

    <div v-if="chips.length > 0" class="flex flex-wrap items-center gap-2">
      <FilterChip
        v-for="chip in chips"
        :key="chip.key"
        :label="chip.label"
        :value="chip.value"
        @remove="change({ [chip.key]: undefined })"
      />
      <UiButton variant="quiet" size="sm" @click="emit('clear')">Clear filters</UiButton>
    </div>
  </div>
</template>
