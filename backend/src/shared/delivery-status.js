import { FAILURE } from './retry.js';

export const DELIVERY_STATUS = Object.freeze({
  PENDING: 'PENDING',
  IN_FLIGHT: 'IN_FLIGHT',
  RETRYING: 'RETRYING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED_PERMANENTLY: 'FAILED_PERMANENTLY',
  SKIPPED: 'SKIPPED',
});

export const DELIVERY_STATUS_VALUES = Object.freeze(Object.values(DELIVERY_STATUS));

// A delivery in one of these has finished for good. A message that arrives for
// one of them is a redelivery of work that was already committed.
export const TERMINAL_STATUSES = Object.freeze(
  new Set([DELIVERY_STATUS.SUCCEEDED, DELIVERY_STATUS.FAILED_PERMANENTLY, DELIVERY_STATUS.SKIPPED]),
);

// Replay is offered for a delivery that stopped, and for one still walking the
// ladder — an operator who fixed the endpoint should not have to wait out the
// remaining retries.
export const REPLAYABLE_STATUSES = Object.freeze(
  new Set([
    DELIVERY_STATUS.SUCCEEDED,
    DELIVERY_STATUS.FAILED_PERMANENTLY,
    DELIVERY_STATUS.SKIPPED,
    DELIVERY_STATUS.RETRYING,
  ]),
);

export const ENDPOINT_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' });

// Architecture §13 fixes the realtime delivery.failed reason vocabulary. It is the
// classifier's own vocabulary plus the one reason a classification cannot carry:
// the failure was retryable but the ladder ran out.
export const DELIVERY_FAILURE_REASON = Object.freeze({ ...FAILURE, EXHAUSTED: 'EXHAUSTED' });
