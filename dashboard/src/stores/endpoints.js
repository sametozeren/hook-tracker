import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';

export const useEndpointsStore = defineStore('endpoints', () => {
  const items = ref([]);
  const loadedProjectId = ref(null);
  const loading = ref(false);
  const error = ref(null);

  const byId = computed(() =>
    Object.fromEntries(items.value.map((endpoint) => [endpoint.id, endpoint])),
  );

  function displayName(endpointId) {
    const endpoint = byId.value[endpointId];

    if (!endpoint) {
      return endpointId;
    }

    try {
      const url = new URL(endpoint.url);

      return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return endpoint.url;
    }
  }

  async function load(projectId, { force = false } = {}) {
    if (!force && loadedProjectId.value === projectId && items.value.length > 0) {
      return items.value;
    }

    loading.value = true;
    error.value = null;

    try {
      const body = await api.get(`/projects/${projectId}/endpoints`);

      items.value = body.endpoints;
      loadedProjectId.value = projectId;

      return items.value;
    } catch (caught) {
      error.value = caught;

      throw caught;
    } finally {
      loading.value = false;
    }
  }

  function upsert(endpoint) {
    const index = items.value.findIndex((item) => item.id === endpoint.id);

    if (index === -1) {
      items.value = [endpoint, ...items.value];

      return;
    }

    items.value = items.value.map((item) => (item.id === endpoint.id ? endpoint : item));
  }

  async function create(projectId, payload) {
    const created = await api.post(`/projects/${projectId}/endpoints`, payload);

    upsert(stripSecret(created));

    return created;
  }

  async function update(endpointId, patch) {
    const updated = await api.patch(`/endpoints/${endpointId}`, patch);

    upsert(updated);

    return updated;
  }

  async function rotateSecret(endpointId) {
    const rotated = await api.post(`/endpoints/${endpointId}/rotate-secret`);

    upsert(stripSecret(rotated));

    return rotated;
  }

  async function enable(endpointId) {
    const updated = await api.post(`/endpoints/${endpointId}/enable`);

    upsert(updated);

    return updated;
  }

  async function disable(endpointId) {
    const updated = await api.post(`/endpoints/${endpointId}/disable`);

    upsert(updated);

    return updated;
  }

  async function remove(endpointId) {
    await api.delete(`/endpoints/${endpointId}`);

    items.value = items.value.filter((item) => item.id !== endpointId);
  }

  async function sendTest(endpointId) {
    return api.post(`/endpoints/${endpointId}/test`);
  }

  function markDisabled(endpointId, consecutiveFailures) {
    const endpoint = byId.value[endpointId];

    if (endpoint) {
      upsert({ ...endpoint, status: 'DISABLED', consecutiveFailures });
    }
  }

  function reset() {
    items.value = [];
    loadedProjectId.value = null;
    error.value = null;
  }

  return {
    items,
    loading,
    error,
    byId,
    displayName,
    load,
    create,
    update,
    rotateSecret,
    enable,
    disable,
    remove,
    sendTest,
    markDisabled,
    reset,
  };
});

// The plaintext secret is returned once and must never be cached in a store
// that other screens read from.
function stripSecret(endpoint) {
  const copy = { ...endpoint };

  delete copy.secret;
  delete copy.previousSecretExpiresAt;

  return copy;
}
