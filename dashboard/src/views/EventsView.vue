<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { FILTER_KEYS, useEventsStore } from '../stores/events.js';
import { useQueryFilters } from '../composables/use-query-filters.js';
import { describeApiError } from '../lib/api-error-message.js';
import { DELIVERY_STATUSES } from '../components/ui/status.js';
import { fromDateTimeInput, toDateTimeInput } from '../components/ui/time.js';
import SectionFrame from '../components/SectionFrame.vue';
import DetailOverlay from '../components/DetailOverlay.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import ErrorState from '../components/ui/ErrorState.vue';
import RelativeTime from '../components/ui/RelativeTime.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import StatusPill from '../components/ui/StatusPill.vue';
import UiButton from '../components/ui/UiButton.vue';

const DISAGREEING_STATUSES = ['FAILED_PERMANENTLY', 'SKIPPED'];

const EMPTY_DRAFT = { eventType: '', from: '', to: '', payloadPath: '', payloadValue: '' };

const route = useRoute();
const router = useRouter();
const events = useEventsStore();

// Only the filters this screen offers are honoured, and anything else is
// stripped from the URL on arrival. A status or endpoint filter inherited from a
// Deliveries URL has no meaning here: the event list is not filtered by the
// state of the deliveries it fanned out to.
const {
  filters,
  filterKey,
  hasFilters,
  update: writeQuery,
  clear: clearFilters,
  dropped: droppedFilters,
} = useQueryFilters(FILTER_KEYS, { dropUnlisted: true });

const draft = ref({ ...EMPTY_DRAFT });

const projectId = computed(() => route.params.projectId);

const detailOpen = computed(() => route.name === 'event');

const selectedId = computed(() => (detailOpen.value ? route.params.eventId : null));

const showSkeleton = computed(() => events.loading && events.items.length === 0);

const showEmpty = computed(() => !events.loading && !events.error && events.items.length === 0);

const payloadSearchIncomplete = computed(
  () => Boolean(filters.value.payloadPath) !== Boolean(filters.value.payloadValue),
);

function syncDraft() {
  draft.value = {
    eventType: filters.value.eventType ?? '',
    from: toDateTimeInput(filters.value.from),
    to: toDateTimeInput(filters.value.to),
    payloadPath: filters.value.payloadPath ?? '',
    payloadValue: filters.value.payloadValue ?? '',
  };
}

function applyFilters() {
  writeQuery({
    eventType: draft.value.eventType.trim(),
    from: fromDateTimeInput(draft.value.from),
    to: fromDateTimeInput(draft.value.to),
    payloadPath: draft.value.payloadPath.trim(),
    payloadValue: draft.value.payloadValue.trim(),
  });
}

function load() {
  events.load(projectId.value, filters.value);
}

function eventRoute(event) {
  return {
    name: 'event',
    params: { projectId: projectId.value, eventId: event.id },
    query: route.query,
  };
}

function closeDetail() {
  router.push({ name: 'events', params: { projectId: projectId.value }, query: route.query });
}

function statusCounts(event) {
  const byStatus = event.byStatus ?? {};

  return DELIVERY_STATUSES.filter((status) => byStatus[status] > 0).map((status) => ({
    status,
    count: byStatus[status],
  }));
}

function fanOutSummary(event) {
  const total = event.deliveryCount ?? 0;

  return `${total} ${total === 1 ? 'delivery' : 'deliveries'}`;
}

function isDivergent(event) {
  const byStatus = event.byStatus ?? {};

  return (
    (byStatus.SUCCEEDED ?? 0) > 0 &&
    DISAGREEING_STATUSES.some((status) => (byStatus[status] ?? 0) > 0)
  );
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
      description="Every event this project has received, newest first, with the deliveries it produced and how each of them ended. Open one to read its payload and follow a delivery."
    >
      <template #note>
        <p v-if="droppedFilters.length > 0" class="mt-2 max-w-prose text-sm text-muted">
          The
          <span class="font-mono text-ink">{{ droppedFilters.join(' and ') }}</span>
          filter carried over from the deliveries view was cleared. Events are filtered by what was
          published, not by how their deliveries ended.
        </p>
      </template>
    </SectionFrame>

    <form class="flex flex-col gap-2 border-y border-rule py-3" @submit.prevent="applyFilters">
      <div class="flex flex-wrap items-end gap-3">
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

        <label class="flex min-w-0 flex-col gap-1">
          <span class="eyebrow">Payload field</span>
          <input
            v-model="draft.payloadPath"
            type="text"
            placeholder="customer.id"
            class="w-52 max-w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-faint"
          />
        </label>

        <label class="flex min-w-0 flex-col gap-1">
          <span class="eyebrow">Payload value</span>
          <input
            v-model="draft.payloadValue"
            type="text"
            placeholder="cus_1001"
            class="w-52 max-w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-faint"
          />
        </label>

        <div class="flex flex-wrap items-center gap-2">
          <UiButton type="submit" size="sm">Apply</UiButton>
          <UiButton v-if="hasFilters" variant="quiet" size="sm" @click="clearFilters">
            Clear filters
          </UiButton>
        </div>
      </div>

      <p class="max-w-prose text-xs text-muted">
        The payload search matches the whole value exactly — it does not search inside text.
        <span class="font-mono text-ink">customer.id</span> reaches a nested field;
        <span class="font-mono text-ink">orderId</span> a top-level one.
      </p>

      <p v-if="payloadSearchIncomplete" role="status" class="max-w-prose text-xs text-retry">
        A payload search needs both the field and the value. Until both are set the search is left
        out and the list is not narrowed by it.
      </p>
    </form>

    <div
      :class="
        detailOpen
          ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-6'
          : ''
      "
    >
      <div class="min-w-0">
        <SkeletonRows v-if="showSkeleton" :rows="6" :columns="['28%', '18%', '22%', '14%']" />

        <ErrorState
          v-else-if="events.error"
          title="The events could not be loaded."
          :detail="describeApiError(events.error)"
          :request-id="events.error.requestId || ''"
          @retry="load"
        />

        <EmptyState
          v-else-if="showEmpty && hasFilters"
          title="No events match these filters."
          description="No event in this project was received in that range, with that type, or carrying that payload value."
        >
          <template #actions>
            <UiButton size="sm" @click="clearFilters">Clear filters</UiButton>
          </template>
        </EmptyState>

        <EmptyState
          v-else-if="showEmpty"
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
          <ul class="space-y-2.5">
            <li v-for="event in events.items" :key="event.id">
              <RouterLink
                :to="eventRoute(event)"
                class="block rounded-lg border px-3 py-2.5 hover:bg-sunken"
                :class="[
                  isDivergent(event) ? 'border-retry' : 'border-rule',
                  event.id === selectedId ? 'bg-sunken' : 'bg-surface',
                ]"
              >
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span class="font-mono text-sm break-all text-ink">
                    {{ event.eventType || 'unknown event type' }}
                  </span>
                  <span
                    v-if="isDivergent(event)"
                    class="inline-flex items-center rounded-full bg-retry-soft px-2 py-0.5 text-[11px] font-medium text-retry"
                  >
                    Endpoints disagree
                  </span>
                  <RelativeTime v-if="event.receivedAt" :value="event.receivedAt" class="ml-auto" />
                </div>

                <p class="mt-0.5 font-mono text-[11px] break-all text-faint">{{ event.id }}</p>

                <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span class="tnum text-xs text-muted">{{ fanOutSummary(event) }}</span>
                  <span
                    v-for="entry in statusCounts(event)"
                    :key="entry.status"
                    class="inline-flex items-center gap-1"
                  >
                    <StatusPill :status="entry.status" size="sm" />
                    <span class="tnum font-mono text-[11px] text-faint">×{{ entry.count }}</span>
                  </span>
                  <span v-if="event.deliveryCount === 0" class="text-xs text-faint">
                    No endpoint was subscribed when this event arrived.
                  </span>
                </div>
              </RouterLink>
            </li>
          </ul>

          <div class="flex flex-wrap items-center gap-3 pt-1">
            <UiButton
              v-if="events.hasMore"
              size="sm"
              :loading="events.loadingMore"
              @click="events.loadMore()"
            >
              Load older
            </UiButton>
            <p class="tnum text-xs text-faint">
              {{ events.items.length }} events loaded.
              <span v-if="events.hasMore">Older events have not been loaded.</span>
              <span v-else>This reaches the oldest event this project has for these filters.</span>
            </p>
            <span v-if="events.loadMoreError" role="alert" class="text-fail">
              The next page could not be loaded: {{ describeApiError(events.loadMoreError) }} The
              events above are unaffected.
            </span>
          </div>
        </div>
      </div>

      <DetailOverlay v-if="detailOpen" label="Event detail" @close="closeDetail">
        <RouterView />
      </DetailOverlay>
    </div>
  </div>
</template>
