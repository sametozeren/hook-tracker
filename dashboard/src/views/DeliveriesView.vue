<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { FILTER_KEYS, useDeliveriesStore } from '../stores/deliveries.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { useRealtimeStore } from '../stores/realtime.js';
import { useQueryFilters } from '../composables/use-query-filters.js';
import { describeApiError } from '../lib/api-error-message.js';
import { apiOrigin, buildCurl } from '../lib/curl.js';
import { formatAbsoluteUtc } from '../components/ui/time.js';
import EmptyState from '../components/ui/EmptyState.vue';
import ErrorState from '../components/ui/ErrorState.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import UiButton from '../components/ui/UiButton.vue';
import CopyButton from '../components/ui/CopyButton.vue';
import BulkReplayControl from '../components/BulkReplayControl.vue';
import DeliverySummary from '../components/DeliverySummary.vue';
import DetailOverlay from '../components/DetailOverlay.vue';
import DeliveryFilters from '../components/DeliveryFilters.vue';
import DeliveryRow, { DELIVERY_GRID } from '../components/DeliveryRow.vue';

const TICK_MS = 30 * 1000;

const REALTIME_EVENTS = [
  'delivery.created',
  'delivery.attempted',
  'delivery.succeeded',
  'delivery.failed',
];

const SKELETON_COLUMNS = ['118px', '20%', '26%', '86px', '62px', '82px', '62px'];

// The API sends no per-row attempt timestamp, so the only time a row carries is
// the one it was created at. The column is named after the value it holds.
const HEAD_COLUMNS = ['Status', 'Event', 'Endpoint', 'Attempts', 'Code', 'Duration', 'Created'];

const route = useRoute();
const router = useRouter();
const deliveries = useDeliveriesStore();
const endpoints = useEndpointsStore();
const realtime = useRealtimeStore();

const { filters, filterKey, hasFilters, update, clear } = useQueryFilters(FILTER_KEYS);

const now = ref(Date.now());

let unsubscribes = [];
let ticker = null;

const projectId = computed(() => route.params.projectId);

const detailOpen = computed(() => route.name === 'delivery');

const selectedId = computed(() => (detailOpen.value ? route.params.deliveryId : null));

const showSkeleton = computed(() => deliveries.loading && deliveries.items.length === 0);

const showEmpty = computed(
  () => !deliveries.loading && !deliveries.error && deliveries.items.length === 0,
);

const filterSummary = computed(() => {
  const active = filters.value;
  const parts = [];

  if (active.status) {
    parts.push(`status ${active.status}`);
  }

  if (active.endpointId) {
    parts.push(`endpoint ${endpoints.displayName(active.endpointId)}`);
  }

  if (active.eventType) {
    parts.push(`event type ${active.eventType}`);
  }

  if (active.from) {
    parts.push(`from ${formatAbsoluteUtc(active.from)}`);
  }

  if (active.to) {
    parts.push(`to ${formatAbsoluteUtc(active.to)}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no filters, so every delivery in this project';
});

const listErrorMessage = computed(() => describeApiError(deliveries.error));

const loadMoreErrorMessage = computed(() => describeApiError(deliveries.loadMoreError));

const publishExample = computed(() =>
  buildCurl(
    `${apiOrigin()}/v1/publish`,
    [
      ['Authorization', 'Bearer ht_...'],
      ['Content-Type', 'application/json'],
    ],
    '{"eventType":"order.created","payload":{"orderId":"ord_1001"}}',
  ),
);

function endpointName(endpointId) {
  return endpoints.displayName(endpointId);
}

function closeDetail() {
  router.push({ name: 'deliveries', params: { projectId: projectId.value }, query: route.query });
}

function toggleStatus(status) {
  update({ status: filters.value.status === status ? undefined : status });
}

function loadAll() {
  deliveries.load(projectId.value, filters.value);
  deliveries.loadStats(projectId.value);
  endpoints.load(projectId.value).catch(() => undefined);
}

watch([projectId, filterKey], loadAll, { immediate: true });

onMounted(() => {
  unsubscribes = REALTIME_EVENTS.map((event) =>
    realtime.on(event, (payload) => deliveries.applyRealtime(event, payload)),
  );

  ticker = setInterval(() => {
    now.value = Date.now();
  }, TICK_MS);
});

onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribes) {
    unsubscribe();
  }

  unsubscribes = [];
  clearInterval(ticker);
});
</script>

<template>
  <div class="space-y-5">
    <DeliverySummary :active-status="filters.status" @toggle-status="toggleStatus" />

    <div
      role="status"
      :class="
        deliveries.pendingCount > 0
          ? 'flex flex-wrap items-center gap-3 rounded-lg border border-pending bg-pending-soft px-3.5 py-2.5 text-sm'
          : 'sr-only'
      "
    >
      <template v-if="deliveries.pendingCount > 0">
        <span>
          <b class="font-medium text-pending">
            {{ deliveries.pendingCount }} new
            {{ deliveries.pendingCount === 1 ? 'delivery' : 'deliveries' }}
          </b>
          arrived while you were reading.
        </span>
        <UiButton size="sm" @click="deliveries.applyPending()">Show them</UiButton>
        <UiButton variant="quiet" size="sm" @click="deliveries.dismissPending()">Dismiss</UiButton>
        <span class="text-xs text-muted">The list stays still until you ask.</span>
      </template>
    </div>

    <DeliveryFilters
      :filters="filters"
      :endpoints="endpoints.items"
      :endpoint-name="endpointName"
      @change="update"
      @clear="clear"
    />

    <BulkReplayControl
      :project-id="projectId"
      :filters="filters"
      :filter-key="filterKey"
      :filter-summary="filterSummary"
    />

    <div
      :class="
        detailOpen
          ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-6'
          : ''
      "
    >
      <div class="min-w-0">
        <ErrorState
          v-if="deliveries.error"
          title="The deliveries could not be loaded."
          :detail="listErrorMessage"
          :request-id="deliveries.error.requestId"
          @retry="loadAll"
        />

        <SkeletonRows v-else-if="showSkeleton" :rows="8" :columns="SKELETON_COLUMNS" />

        <EmptyState
          v-else-if="showEmpty && hasFilters"
          title="No deliveries match these filters."
          :description="`Active: ${filterSummary}.`"
        >
          <template #actions>
            <UiButton size="sm" @click="clear">Clear filters</UiButton>
          </template>
        </EmptyState>

        <EmptyState
          v-else-if="showEmpty"
          title="No deliveries yet."
          description="Nothing has been published to this project. Three steps get the first one on this screen."
        >
          <ol class="list-decimal space-y-1 pl-4">
            <li>
              Create an endpoint on the
              <RouterLink
                :to="{ name: 'endpoints', params: { projectId } }"
                class="underline underline-offset-2"
              >
                Endpoints
              </RouterLink>
              screen.
            </li>
            <li>
              Copy an API key from
              <RouterLink
                :to="{ name: 'settings', params: { projectId } }"
                class="underline underline-offset-2"
              >
                Settings
              </RouterLink>
              — the plaintext key is shown once.
            </li>
            <li>Send the first event:</li>
          </ol>
          <div class="mt-3 overflow-hidden rounded-md border border-rule bg-sunken">
            <div class="flex items-center gap-2 border-b border-rule-soft px-3 py-1.5">
              <span class="eyebrow">First event</span>
              <span class="ml-auto"><CopyButton :text="publishExample" /></span>
            </div>
            <pre
              class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-ink"
            ><code>{{ publishExample }}</code></pre>
          </div>
        </EmptyState>

        <div v-else class="md:overflow-x-auto">
          <div class="space-y-2 md:min-w-[880px] md:space-y-0">
            <div
              class="hidden border-b border-rule px-2.5 pb-2 font-mono text-[10.5px] tracking-[0.09em] text-faint uppercase md:grid"
              :class="DELIVERY_GRID"
              aria-hidden="true"
            >
              <span
                v-for="(column, index) in HEAD_COLUMNS"
                :key="column"
                :class="index >= 4 ? 'justify-self-end' : ''"
              >
                {{ column }}
              </span>
            </div>

            <DeliveryRow
              v-for="delivery in deliveries.items"
              :key="delivery.id"
              :delivery="delivery"
              :project-id="projectId"
              :query="route.query"
              :now="now"
              :selected="delivery.id === selectedId"
            />
          </div>
        </div>

        <div
          v-if="!showSkeleton && deliveries.items.length > 0"
          class="flex flex-wrap items-center gap-3 pt-3.5 text-xs text-muted"
        >
          <span>
            Showing
            <b class="tnum font-mono font-medium text-ink">{{ deliveries.items.length }}</b>
          </span>
          <UiButton
            v-if="deliveries.hasMore"
            size="sm"
            :loading="deliveries.loadingMore"
            @click="deliveries.loadMore()"
          >
            Load older
          </UiButton>
          <span v-else>That is every delivery matching this view.</span>

          <span v-if="deliveries.loadMoreError" role="alert" class="text-fail">
            The next page could not be loaded:
            {{ loadMoreErrorMessage }} The rows above are unaffected.
          </span>
        </div>
      </div>

      <DetailOverlay v-if="detailOpen" label="Delivery detail" @close="closeDetail">
        <RouterView />
      </DetailOverlay>
    </div>
  </div>
</template>
