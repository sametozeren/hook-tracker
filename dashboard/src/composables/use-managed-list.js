import { ref, watch } from 'vue';
import { api } from '../lib/api.js';
import { describeApiError } from '../lib/api-error-message.js';
import { useSequencedRequest } from './use-sequenced-request.js';

export function useApiAction(errors = {}) {
  const pending = ref(false);
  const error = ref('');

  async function run(action) {
    pending.value = true;
    error.value = '';

    try {
      await action();

      return true;
    } catch (caught) {
      error.value = describeApiError(caught, errors);

      return false;
    } finally {
      pending.value = false;
    }
  }

  return { pending, error, run };
}

export function useManagedList({ projectId, resource, collection, errors = {} }) {
  const listRequest = useSequencedRequest();
  const action = useApiAction(errors);

  const rows = ref([]);
  const target = ref(null);

  function load() {
    return listRequest.run(() => api.get(`/projects/${projectId()}/${resource}`), {
      onSuccess(body) {
        rows.value = body[collection];
      },
      onError() {
        rows.value = [];
      },
    });
  }

  function ask(row) {
    target.value = row;
    action.error.value = '';
  }

  function cancel() {
    target.value = null;
    action.error.value = '';
  }

  // The mutation stays with the caller: revoking replaces a row, removing a
  // member can navigate away instead of reloading. The composable owns only the
  // envelope — pending, the message map, and closing the dialog on success.
  async function confirm(mutate) {
    const subject = target.value;
    const done = await action.run(() => mutate(subject));

    if (done) {
      target.value = null;
    }

    return done;
  }

  watch(projectId, load, { immediate: true });

  return {
    rows,
    loading: listRequest.loading,
    loadError: listRequest.error,
    load,
    target,
    ask,
    cancel,
    pending: action.pending,
    actionError: action.error,
    confirm,
  };
}
