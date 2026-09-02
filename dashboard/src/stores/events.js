import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';
import { useSequencedRequest } from '../composables/use-sequenced-request.js';

export const FILTER_KEYS = ['eventType', 'from', 'to', 'payloadPath', 'payloadValue'];

const PAGE_SIZE = 50;

// The API answers 400 to a payloadPath sent without a payloadValue, and an empty
// value never reaches the query string, so a half-filled pair is dropped here
// instead of being sent and rejected.
function searchable(filters) {
  const query = { ...filters };

  if (!query.payloadPath || !query.payloadValue) {
    delete query.payloadPath;
    delete query.payloadValue;
  }

  return query;
}

export const useEventsStore = defineStore('events', () => {
  const listRequest = useSequencedRequest();
  const moreRequest = listRequest.follower();
  const detailRequest = useSequencedRequest();

  const items = ref([]);
  const nextCursor = ref(null);
  const loading = listRequest.loading;
  const loadingMore = moreRequest.loading;
  const error = listRequest.error;
  const loadMoreError = moreRequest.error;
  const detail = ref(null);
  const detailLoading = detailRequest.loading;
  const detailError = detailRequest.error;
  const activeFilters = ref({});

  let projectId = null;

  const hasMore = computed(() => nextCursor.value !== null);

  function reset() {
    items.value = [];
    nextCursor.value = null;
    error.value = null;
    loadMoreError.value = null;
    detail.value = null;
    detailError.value = null;
  }

  async function load(id, filters = {}) {
    projectId = id;
    activeFilters.value = { ...filters };
    loadMoreError.value = null;

    await listRequest.run(
      () => api.get(`/projects/${id}/events`, { ...searchable(filters), limit: PAGE_SIZE }),
      {
        onSuccess(body) {
          items.value = body.events;
          nextCursor.value = body.nextCursor;
        },
        onError() {
          items.value = [];
          nextCursor.value = null;
        },
      },
    );
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) {
      return;
    }

    const cursor = nextCursor.value;
    const filters = searchable(activeFilters.value);

    await moreRequest.run(
      () => api.get(`/projects/${projectId}/events`, { ...filters, cursor, limit: PAGE_SIZE }),
      {
        onSuccess(body) {
          items.value = [...items.value, ...body.events];
          nextCursor.value = body.nextCursor;
        },
      },
    );
  }

  async function loadDetail(eventId) {
    await detailRequest.run(() => api.get(`/events/${eventId}`), {
      onSuccess(body) {
        detail.value = body;
      },
      onError() {
        detail.value = null;
      },
    });
  }

  return {
    items,
    nextCursor,
    loading,
    loadingMore,
    error,
    loadMoreError,
    detail,
    detailLoading,
    detailError,
    activeFilters,
    hasMore,
    reset,
    load,
    loadMore,
    loadDetail,
  };
});
