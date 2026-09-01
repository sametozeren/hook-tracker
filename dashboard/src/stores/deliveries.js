import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';

export const DELIVERY_STATUSES = [
  'PENDING',
  'IN_FLIGHT',
  'RETRYING',
  'SUCCEEDED',
  'FAILED_PERMANENTLY',
  'SKIPPED',
];

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED_PERMANENTLY', 'SKIPPED']);

export const FILTER_KEYS = ['status', 'endpointId', 'eventType', 'from', 'to'];

export function filtersFromQuery(query) {
  const filters = {};

  for (const key of FILTER_KEYS) {
    if (typeof query[key] === 'string' && query[key] !== '') {
      filters[key] = query[key];
    }
  }

  return filters;
}

export const useDeliveriesStore = defineStore('deliveries', () => {
  const items = ref([]);
  const nextCursor = ref(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref(null);
  const loadMoreError = ref(null);
  const stats = ref(null);
  const statsError = ref(null);
  const pendingIds = ref([]);
  const activeFilters = ref({});

  let projectId = null;
  let requestSeq = 0;

  const hasMore = computed(() => nextCursor.value !== null);
  const pendingCount = computed(() => pendingIds.value.length);
  const knownIds = computed(() => new Set(items.value.map((item) => item.id)));

  const successRateSeries = computed(() => {
    const ordered = [...items.value].reverse();
    const bucketSize = Math.max(1, Math.ceil(ordered.length / 12));
    const series = [];

    for (let start = 0; start < ordered.length; start += bucketSize) {
      const bucket = ordered.slice(start, start + bucketSize);
      const settled = bucket.filter((item) => TERMINAL_STATUSES.has(item.status));
      const succeeded = settled.filter((item) => item.status === 'SUCCEEDED').length;

      series.push(settled.length === 0 ? null : succeeded / settled.length);
    }

    return series;
  });

  function reset() {
    items.value = [];
    nextCursor.value = null;
    error.value = null;
    loadMoreError.value = null;
    pendingIds.value = [];
  }

  // Realtime payloads carry no project id, and the socket is joined to one room
  // per membership, so an unknown id may belong to another project or to a row
  // the active filters exclude. Every id counted before a reload is settled by
  // that reload: it is either on screen now or it is not the operator's to see.
  function settlePending(counted) {
    pendingIds.value = pendingIds.value.filter((id) => !counted.has(id));
  }

  async function load(id, filters = {}) {
    const seq = ++requestSeq;
    const counted = new Set(pendingIds.value);

    projectId = id;
    activeFilters.value = { ...filters };
    loading.value = true;
    error.value = null;
    loadMoreError.value = null;

    try {
      const body = await api.get(`/projects/${id}/deliveries`, { ...filters, limit: 50 });

      if (seq !== requestSeq) {
        return;
      }

      items.value = body.deliveries;
      nextCursor.value = body.nextCursor;
      settlePending(counted);
    } catch (caught) {
      if (seq === requestSeq) {
        error.value = caught;
        items.value = [];
        nextCursor.value = null;
      }
    } finally {
      if (seq === requestSeq) {
        loading.value = false;
      }
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) {
      return;
    }

    loadingMore.value = true;
    loadMoreError.value = null;

    try {
      const body = await api.get(`/projects/${projectId}/deliveries`, {
        ...activeFilters.value,
        cursor: nextCursor.value,
        limit: 50,
      });

      items.value = [...items.value, ...body.deliveries];
      nextCursor.value = body.nextCursor;
    } catch (caught) {
      loadMoreError.value = caught;
    } finally {
      loadingMore.value = false;
    }
  }

  async function loadStats(id) {
    statsError.value = null;

    try {
      stats.value = await api.get(`/projects/${id}/stats`);
    } catch (caught) {
      statsError.value = caught;
    }
  }

  function refresh() {
    return Promise.all([load(projectId, activeFilters.value), loadStats(projectId)]);
  }

  function patch(deliveryId, changes) {
    const index = items.value.findIndex((item) => item.id === deliveryId);

    if (index === -1) {
      return false;
    }

    items.value = items.value.map((item) =>
      item.id === deliveryId ? { ...item, ...changes } : item,
    );

    return true;
  }

  // A realtime event for a delivery that is not on screen means a new row the
  // operator has not asked for yet. It is counted, not inserted: the list must
  // not move under the cursor while it is being read.
  function noteUnknown(deliveryId) {
    if (!knownIds.value.has(deliveryId) && !pendingIds.value.includes(deliveryId)) {
      pendingIds.value = [...pendingIds.value, deliveryId];
    }
  }

  function applyRealtime(event, payload) {
    if (event === 'delivery.succeeded') {
      const applied = patch(payload.deliveryId, {
        status: 'SUCCEEDED',
        attemptCount: payload.attempt,
        lastResponseStatus: payload.responseStatus,
        lastDurationMs: payload.durationMs,
        completedAt: payload.completedAt,
        nextAttemptAt: null,
      });

      if (!applied) {
        noteUnknown(payload.deliveryId);
      }

      return;
    }

    if (event === 'delivery.attempted') {
      const applied = patch(payload.deliveryId, {
        status: 'RETRYING',
        attemptCount: payload.attempt,
        lastResponseStatus: payload.responseStatus,
        lastDurationMs: payload.durationMs,
        nextAttemptAt: payload.nextAttemptAt,
      });

      if (!applied) {
        noteUnknown(payload.deliveryId);
      }

      return;
    }

    if (event === 'delivery.failed') {
      const applied = patch(payload.deliveryId, {
        status: 'FAILED_PERMANENTLY',
        attemptCount: payload.attempt,
        lastResponseStatus: payload.responseStatus ?? null,
        lastError: payload.errorCode ?? null,
        completedAt: payload.completedAt,
        nextAttemptAt: null,
      });

      if (!applied) {
        noteUnknown(payload.deliveryId);
      }

      return;
    }

    if (event === 'delivery.created') {
      noteUnknown(payload.deliveryId);
    }
  }

  async function applyPending() {
    await refresh();
  }

  function dismissPending() {
    pendingIds.value = [];
  }

  async function replay(deliveryId) {
    return api.post(`/deliveries/${deliveryId}/replay`);
  }

  async function bulkReplay(id, filters, limit) {
    return api.post(`/projects/${id}/deliveries/bulk-replay`, {
      ...filters,
      ...(limit ? { limit } : {}),
    });
  }

  function fetchOne(deliveryId) {
    return api.get(`/deliveries/${deliveryId}`);
  }

  return {
    items,
    nextCursor,
    loading,
    loadingMore,
    error,
    loadMoreError,
    stats,
    statsError,
    pendingIds,
    pendingCount,
    activeFilters,
    hasMore,
    successRateSeries,
    reset,
    load,
    loadMore,
    loadStats,
    refresh,
    applyRealtime,
    applyPending,
    dismissPending,
    replay,
    bulkReplay,
    fetchOne,
  };
});
