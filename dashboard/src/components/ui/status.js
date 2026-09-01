export const STATUS_META = {
  PENDING: {
    label: 'Queued',
    textClass: 'text-pending',
    softClass: 'bg-pending-soft',
    glyph: 'clock',
  },
  IN_FLIGHT: {
    label: 'In flight',
    textClass: 'text-flight',
    softClass: 'bg-flight-soft',
    glyph: 'triangle',
  },
  RETRYING: {
    label: 'Retrying',
    textClass: 'text-retry',
    softClass: 'bg-retry-soft',
    glyph: 'circular-arrow',
  },
  SUCCEEDED: {
    label: 'Delivered',
    textClass: 'text-ok',
    softClass: 'bg-ok-soft',
    glyph: 'check',
  },
  FAILED_PERMANENTLY: {
    label: 'Failed',
    textClass: 'text-fail',
    softClass: 'bg-fail-soft',
    glyph: 'cross',
  },
  SKIPPED: {
    label: 'Skipped',
    textClass: 'text-skip',
    softClass: 'bg-skip-soft',
    glyph: 'slashed-circle',
  },
};

export const DELIVERY_STATUSES = Object.keys(STATUS_META);

export function resolveStatusMeta(status) {
  const known = STATUS_META[status];

  if (known) {
    return known;
  }

  return {
    label: String(status ?? 'Unknown'),
    textClass: 'text-skip',
    softClass: 'bg-skip-soft',
    glyph: 'slashed-circle',
  };
}

export function statusLabel(status) {
  return resolveStatusMeta(status).label;
}
