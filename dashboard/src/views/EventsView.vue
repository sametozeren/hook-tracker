<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useDeliveriesStore } from '../stores/deliveries.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { useQueryFilters } from '../composables/use-query-filters.js';
import { describeApiError } from '../lib/api-error-message.js';
import { DELIVERY_STATUSES, statusLabel } from '../components/ui/status.js';
import { fromDateTimeInput, toDateTimeInput } from '../components/ui/time.js';
import SectionFrame from '../components/SectionFrame.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import ErrorState from '../components/ui/ErrorState.vue';
import RelativeTime from '../components/ui/RelativeTime.vue';
import ResponseCode from '../components/ui/ResponseCode.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import StatusPill from '../components/ui/StatusPill.vue';
import UiButton from '../components/ui/UiButton.vue';

const EVENT_FILTER_KEYS = ['eventType', 'from', 'to'];
const UNDECIDED_STATUSES = new Set(['PENDING', 'IN_FLIGHT']);

const route = useRoute();
const deliveries = useDeliveriesStore();
const endpoints = useEndpointsStore();

// Only the three filters this screen offers are honoured, and anything else is
// stripped from the URL on arrival. A status or endpoint filter inherited from a
// Deliveries URL would hide part of an event's fan-out, which is the one thing
// this screen exists to show.
const {
  filters,
  filterKey,
  hasFilters,
  update: writeQuery,
  clear: clearFilters,
  dropped: droppedFilters,
} = useQueryFilters(EVENT_FILTER_KEYS, { dropUnlisted: true });

const draft = ref({ eventType: '', from: '', to: '' });

const projectId = computed(() => route.params.projectId);

const groups = computed(() => {
  const byEvent = new Map();

  for (const delivery of deliveries.items) {
    const group = byEvent.get(delivery.eventId);

    if (group) {
      group.deliveries.push(delivery);
    } else {
      byEvent.set(delivery.eventId, {
        eventId: delivery.eventId,
        eventType: delivery.eventType ?? '',
        receivedAt: delivery.receivedAt ?? delivery.createdAt,
        deliveries: [delivery],
      });
    }
  }

  return [...byEvent.values()]
    .sort((a, b) => Date.parse(b.receivedAt ?? '') - Date.parse(a.receivedAt ?? ''))
    .map((group) => ({ ...group, divergent: isDivergent(group) }));
});

const showSkeleton = computed(() => deliveries.loading && groups.value.length === 0);

function syncDraft() {
  draft.value = {
    eventType: filters.value.eventType ?? '',
    from: toDateTimeInput(filters.value.from),
    to: toDateTimeInput(filters.value.to),
  };
}

function applyFilters() {
  writeQuery({
    eventType: draft.value.eventType.trim(),
    from: fromDateTimeInput(draft.value.from),
    to: fromDateTimeInput(draft.value.to),
  });
}

function load() {
  deliveries.load(projectId.value, filters.value);
  endpoints.load(projectId.value).catch(() => undefined);
}

function statusCounts(group) {
  const counts = new Map();

  for (const delivery of group.deliveries) {
    counts.set(delivery.status, (counts.get(delivery.status) ?? 0) + 1);
  }

  return DELIVERY_STATUSES.filter((status) => counts.has(status)).map((status) => ({
    status,
    count: counts.get(status),
  }));
}

function fanOutSummary(group) {
  const total = group.deliveries.length;
  const noun = total === 1 ? 'delivery' : 'deliveries';
  const parts = statusCounts(group).map(
    (entry) => `${entry.count} ${statusLabel(entry.status).toLowerCase()}`,
  );

  return `${total} ${noun} · ${parts.join(', ')}`;
}

function isDivergent(group) {
  const succeeded = group.deliveries.some((delivery) => delivery.status === 'SUCCEEDED');
  const decidedOtherwise = group.deliveries.some(
    (delivery) => delivery.status !== 'SUCCEEDED' && !UNDECIDED_STATUSES.has(delivery.status),
  );

  return succeeded && decidedOtherwise;
}

watch([projectId, filterKey], () => {
  syncDraft();
  load();
});

onMounted(() => {
  syncDraft();
  load();
});
</script>

<template>
  <div class="space-y-5">
    <SectionFrame
      title="Events"
      heading="Event fan-out"
      description="One event, the deliveries it produced, and how each of them ended. The API has no event endpoint, so this page groups the delivery rows it has loaded: it shows the events represented by those deliveries, not every event this project has received. Load older to reach further back."
    >
      <template #note>
        <p v-if="droppedFilters.length > 0" class="mt-2 max-w-prose text-sm text-muted">
          The
          <span class="font-mono text-ink">{{ droppedFilters.join(' and ') }}</span>
          filter carried over from the deliveries view was cleared. This screen shows every delivery
          an event produced, so filtering part of a fan-out away would misreport it.
        </p>
      </template>
    </SectionFrame>

    <form
      class="flex flex-wrap items-end gap-3 border-y border-rule py-3"
      @submit.prevent="applyFilters"
    >
      <label class="flex min-w-0 flex-col gap-1">
        <span class="eyebrow">Event type</span>
        <input
          v-model="draft.eventType"
          type="text"
          placeholder="order.created"
          class="w-52 max-w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-faint"
        />
      </label>

      <label class="flex min-w-0 flex-col gap-1">
        <span class="eyebrow">From</span>
        <input
          v-model="draft.from"
          type="datetime-local"
          class="tnum w-52 max-w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 font-mono text-sm text-ink"
        />
      </label>

      <label class="flex min-w-0 flex-col gap-1">
        <span class="eyebrow">To</span>
        <input
          v-model="draft.to"
          type="datetime-local"
          class="tnum w-52 max-w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 font-mono text-sm text-ink"
        />
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <UiButton type="submit" size="sm">Apply</UiButton>
        <UiButton v-if="hasFilters" variant="quiet" size="sm" @click="clearFilters">
          Clear filters
        </UiButton>
      </div>
    </form>

    <SkeletonRows v-if="showSkeleton" :rows="6" :columns="['28%', '18%', '22%', '14%']" />

    <ErrorState
      v-else-if="deliveries.error"
      title="The deliveries behind these events failed to load."
      :detail="describeApiError(deliveries.error)"
      :request-id="deliveries.error.requestId || ''"
      @retry="load"
    />

    <EmptyState
      v-else-if="groups.length === 0 && hasFilters"
      title="No events match these filters."
      description="The event type and date range you set matched none of the deliveries in this project."
    >
      <template #actions>
        <UiButton size="sm" @click="clearFilters">Clear filters</UiButton>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="groups.length === 0"
      title="No events yet."
      description="An event lands here as soon as something is published to this project and fans out to your endpoints."
    >
      Create an API key in Settings, add an endpoint, then publish to
      <span class="font-mono text-ink">POST /v1/publish</span>.

      <template #actions>
        <RouterLink
          :to="{ name: 'settings', params: { projectId } }"
          class="inline-flex h-7 items-center rounded-md border border-rule bg-surface px-2.5 text-xs font-medium text-ink hover:bg-sunken"
        >
          Go to settings
        </RouterLink>
        <RouterLink
          :to="{ name: 'endpoints', params: { projectId } }"
          class="inline-flex h-7 items-center rounded-md border border-rule bg-surface px-2.5 text-xs font-medium text-ink hover:bg-sunken"
        >
          Add an endpoint
        </RouterLink>
      </template>
    </EmptyState>

    <div v-else class="space-y-3">
      <ul class="space-y-3">
        <li v-for="group in groups" :key="group.eventId">
          <article
            class="rounded-lg border bg-surface"
            :class="group.divergent ? 'border-retry' : 'border-rule'"
          >
            <div class="border-b border-rule-soft px-3 py-2.5">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span class="font-mono text-sm break-all text-ink">
                  {{ group.eventType || 'unknown event type' }}
                </span>
                <span
                  v-if="group.divergent"
                  class="inline-flex items-center rounded-full bg-retry-soft px-2 py-0.5 text-[11px] font-medium text-retry"
                >
                  Endpoints disagree
                </span>
                <RelativeTime v-if="group.receivedAt" :value="group.receivedAt" />
              </div>
              <p class="mt-0.5 font-mono text-[11px] break-all text-faint">{{ group.eventId }}</p>
              <p class="tnum mt-1 text-xs text-muted">{{ fanOutSummary(group) }}</p>
            </div>

            <ul class="divide-y divide-rule-soft">
              <li
                v-for="delivery in group.deliveries"
                :key="delivery.id"
                class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 md:grid md:grid-cols-[7.5rem_minmax(0,1fr)_4rem_6rem] md:gap-3"
              >
                <StatusPill :status="delivery.status" size="sm" />
                <span class="min-w-0 truncate font-mono text-xs text-ink">
                  {{ endpoints.displayName(delivery.endpointId) }}
                </span>
                <ResponseCode
                  :status="delivery.lastResponseStatus ?? null"
                  :error-code="delivery.lastError ?? null"
                />
                <RouterLink
                  :to="{ name: 'delivery', params: { projectId, deliveryId: delivery.id } }"
                  class="text-xs text-muted underline underline-offset-2 hover:text-ink md:justify-self-end"
                >
                  Open delivery
                </RouterLink>
              </li>
            </ul>
          </article>
        </li>
      </ul>

      <div class="flex flex-wrap items-center gap-3 pt-1">
        <UiButton
          v-if="deliveries.hasMore"
          size="sm"
          :loading="deliveries.loadingMore"
          @click="deliveries.loadMore()"
        >
          Load older
        </UiButton>
        <p class="tnum text-xs text-faint">
          {{ groups.length }} events from the {{ deliveries.items.length }} deliveries loaded so
          far.
          <span v-if="deliveries.hasMore">Older deliveries have not been loaded.</span>
          <span v-else>This reaches the oldest delivery this project has for these filters.</span>
        </p>
        <span v-if="deliveries.loadMoreError" role="alert" class="text-fail">
          The next page could not be loaded: {{ describeApiError(deliveries.loadMoreError) }} The
          events above are unaffected.
        </span>
      </div>
    </div>
  </div>
</template>
