import { ref } from 'vue';

function createRequest(gate, claimsSequence) {
  const loading = ref(false);
  const error = ref(null);

  let ownSeq = 0;

  async function run(fetcher, { onSuccess, onError, rethrow = false } = {}) {
    const mine = ++ownSeq;
    const seq = claimsSequence ? ++gate.latest : gate.latest;

    const isCurrent = () => seq === gate.latest;

    loading.value = true;
    error.value = null;

    try {
      const result = await fetcher();

      if (!isCurrent()) {
        return undefined;
      }

      onSuccess?.(result);

      return result;
    } catch (caught) {
      if (isCurrent()) {
        error.value = caught;
        onError?.(caught);
      }

      if (rethrow) {
        throw caught;
      }

      return undefined;
    } finally {
      // The gate decides who may write the result; this ref is this request's
      // own, so a superseded run must still clear it or the caller's in-flight
      // guard never reopens.
      if (mine === ownSeq) {
        loading.value = false;
      }
    }
  }

  // A follower reads the gate without claiming it: a newer run on the owner
  // invalidates the follower's in-flight request, and the follower never
  // invalidates the owner's. That is the load()/loadMore() relationship — a page
  // appended after a reload has replaced the list would corrupt it.
  function follower() {
    return createRequest(gate, false);
  }

  return { loading, error, run, follower };
}

export function useSequencedRequest() {
  return createRequest({ latest: 0 }, true);
}
