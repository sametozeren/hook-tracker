<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { FILTER_KEYS, filtersFromQuery, useDeliveriesStore } from '../stores/deliveries.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { useRealtimeStore } from '../stores/realtime.js';
import { describeApiError } from '../lib/api-error-message.js';
import { apiOrigin, buildCurl } from '../lib/curl.js';
import { statusLabel } from '../components/ui/status.js';
import { formatAbsoluteUtc } from '../components/ui/time.js';
import EmptyState from '../components/ui/EmptyState.vue';
import ErrorState from '../components/ui/ErrorState.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import UiButton from '../components/ui/UiButton.vue';
import CopyButton from '../components/ui/CopyButton.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import DeliveryFilters from '../components/DeliveryFilters.vue';
import DeliveryRow, { DELIVERY_GRID } from '../components/DeliveryRow.vue';
import SuccessSparkline from '../components/SuccessSparkline.vue';

const TICK_MS = 30 * 1000;

const REALTIME_EVENTS = [
  'delivery.created',
  'delivery.attempted',
  'delivery.succeeded',
  'delivery.failed',
];

const COUNT_ORDER = [
  { status: 'SUCCEEDED', tone: 'text-ok' },
  { status: 'RETRYING', tone: 'text-retry' },
  { status: 'FAILED_PERMANENTLY', tone: 'text-fail' },
  { status: 'PENDING', tone: 'text-ink' },
  { status: 'IN_FLIGHT', tone: 'text-ink' },
  { status: 'SKIPPED', tone: 'text-ink' },
];

const SKELETON_COLUMNS = ['118px', '20%', '26%', '86px', '62px', '82px', '62px'];

// The API sends no per-row attempt timestamp, so the only time a row carries is
// the one it was created at. The column is named after the value it holds.
const HEAD_COLUMNS = ['Status', 'Event', 'Endpoint', 'Attempts', 'Code', 'Duration', 'Created'];

// Mirrors the server's BULK_REPLAY_LIMIT default. The client cannot ask for it,
// and the operator needs the cap before the run, not only in the result.
const BULK_REPLAY_CAP = 500;

const route = useRoute();
const router = useRouter();
const deliveries = useDeliveriesStore();
const endpoints = useEndpointsStore();
const realtime = useRealtimeStore();

const now = ref(Date.now());
const confirmOpen = ref(false);
const bulkRunning = ref(false);
const bulkResult = ref(null);
const bulkError = ref(null);

let unsubscribes = [];
let ticker = null;

const projectId = computed(() => route.params.projectId);

const filters = computed(() => filtersFromQuery(route.query));

const filterKey = computed(() => FILTER_KEYS.map((key) => filters.value[key] ?? '').join('|'));

const hasFilters = computed(() => Object.keys(filters.value).length > 0);

const detailOpen = computed(() => route.name === 'delivery');

const selectedId = computed(() => (detailOpen.value ? route.params.deliveryId : null));

const showSkeleton = computed(() => deliveries.loading && deliveries.items.length === 0);

const showEmpty = computed(
  () => !deliveries.loading && !deliveries.error && deliveries.items.length === 0,
);

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

// The list only holds the pages that were loaded, so the exact size of the
// match set is known only once the cursor is exhausted. Claiming a number
// before that would be a guess the server would not honour.
const bulkLabel = computed(() =>
  deliveries.hasMore ? 'Replay all matching' : `Replay all ${deliveries.items.length}`,
);

const bulkMessage = computed(() => {
  const result = bulkResult.value;

  if (!result) {
    return '';
  }

  if (result.matched > result.cappedAt) {
    const left = result.matched - result.cappedAt;

    return `${result.replayed} of ${result.matched} matching deliveries were replayed. Bulk replay is capped at ${result.cappedAt} per run, so ${left} were not replayed. Run it again to take the next batch.`;
  }

  if (result.replayed < result.matched) {
    return `${result.replayed} of ${result.matched} matching deliveries were replayed. Deliveries that are still queued or in flight are left alone.`;
  }

  return `Replayed ${result.replayed} of ${result.matched} matching deliveries.`;
});

const bulkErrorMessage = computed(() =>
  bulkError.value ? `Bulk replay failed: ${describeApiError(bulkError.value)}` : '',
);

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

function updateFilters(patch) {
  const query = { ...route.query };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') {
      delete query[key];
    } else {
      query[key] = value;
    }
  }

  router.replace({ name: route.name, params: route.params, query });
}

function clearFilters() {
  updateFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, undefined])));
}

function toggleStatus(status) {
  updateFilters({ status: filters.value.status === status ? undefined : status });
}

function loadAll() {
  bulkResult.value = null;
  bulkError.value = null;
  deliveries.load(projectId.value, filters.value);
  deliveries.loadStats(projectId.value);
  endpoints.load(projectId.value).catch(() => undefined);
}

async function runBulkReplay() {
  bulkRunning.value = true;
  bulkError.value = null;

  try {
    bulkResult.value = await deliveries.bulkReplay(projectId.value, filters.value);
    confirmOpen.value = false;

    await deliveries.refresh();
  } catch (caught) {
    bulkError.value = caught;
  } finally {
    bulkRunning.value = false;
  }
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
            :class="filters.status === count.status ? 'border-ink' : 'border-transparent'"
            :aria-pressed="filters.status === count.status"
            @click="toggleStatus(count.status)"
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
      @change="updateFilters"
      @clear="clearFilters"
    />

    <div class="flex flex-wrap items-center gap-3">
      <UiButton
        :disabled="deliveries.items.length === 0"
        :loading="bulkRunning"
        @click="confirmOpen = true"
      >
        {{ bulkLabel }}
      </UiButton>

      <p role="status" :class="bulkMessage ? 'text-sm text-muted' : 'sr-only'">
        {{ bulkMessage }}
      </p>

      <p v-if="bulkErrorMessage && !confirmOpen" role="alert" class="text-sm text-fail">
        {{ bulkErrorMessage }}
      </p>
    </div>

    <ConfirmDialog
      v-if="confirmOpen"
      eyebrow="Bulk replay"
      title="Replay every delivery matching this view?"
      confirm-label="Replay them"
      variant="primary"
      size="lg"
      :pending="bulkRunning"
      :error="bulkErrorMessage"
      @close="confirmOpen = false"
      @confirm="runBulkReplay"
    >
      <p class="max-w-prose text-sm text-muted">
        This replays the deliveries matching {{ filterSummary }}. Each replay creates a new delivery
        against the same event; the original attempt history is left as it happened.
      </p>
      <p class="mt-1 max-w-prose text-sm text-muted">
        The server replays at most
        <span class="tnum font-mono text-ink">{{ BULK_REPLAY_CAP }}</span>
        deliveries per run and reports how many it took. Run it again to take the next batch.
      </p>
      <p v-if="deliveries.hasMore" class="mt-1 max-w-prose text-sm text-muted">
        More rows match than are loaded, so the server decides the final count and reports it back.
      </p>
    </ConfirmDialog>

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
            <UiButton size="sm" @click="clearFilters">Clear filters</UiButton>
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

      <div v-if="detailOpen" class="mt-5 min-w-0 lg:mt-0">
        <RouterView />
      </div>
    </div>
  </div>
</template>
