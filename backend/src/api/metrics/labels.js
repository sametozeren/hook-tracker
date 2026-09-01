export const PUBLISH_RESULTS = Object.freeze(['accepted', 'rejected', 'error']);

const NO_RESPONSE_CLASS = 'none';

const UNKNOWN_RESPONSE_CLASS = 'other';

// The class, not the code: a label per status code would add a time series for
// every value a receiver ever returns, and §14 keeps the labels bounded.
export function responseClass(responseStatus) {
  if (!Number.isFinite(responseStatus)) {
    return NO_RESPONSE_CLASS;
  }

  const hundreds = Math.floor(responseStatus / 100);

  if (hundreds < 1 || hundreds > 5) {
    return UNKNOWN_RESPONSE_CLASS;
  }

  return `${hundreds}xx`;
}

export function attemptOutcome(responseStatus) {
  const succeeded =
    Number.isFinite(responseStatus) && responseStatus >= 200 && responseStatus < 300;

  return succeeded ? 'success' : 'failure';
}

export function publishResult(statusCode) {
  if (statusCode >= 200 && statusCode < 300) {
    return 'accepted';
  }

  if (statusCode >= 400 && statusCode < 500) {
    return 'rejected';
  }

  return 'error';
}
