const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function toTimestamp(value) {
  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? null : parsed;
}

export function formatRelativeTime(value, now = Date.now()) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    return '—';
  }

  const elapsed = Math.abs(now - timestamp);

  if (elapsed < 5 * SECOND) {
    return 'now';
  }

  if (elapsed < MINUTE) {
    return `${Math.floor(elapsed / SECOND)}s`;
  }

  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m`;
  }

  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h`;
  }

  return `${Math.floor(elapsed / DAY)}d`;
}

export function toDateTimeInput(value) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    return '';
  }

  const local = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * MINUTE);

  return local.toISOString().slice(0, 16);
}

// The API takes `from`/`to` as z.iso.datetime({ offset: true }) and answers 400
// to anything without one, which a bare datetime-local value has no way to
// carry; toISOString supplies the explicit Z.
export function fromDateTimeInput(value) {
  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

export function formatAbsoluteUtc(value) {
  const timestamp = toTimestamp(value);

  if (timestamp === null) {
    return '';
  }

  const iso = new Date(timestamp).toISOString();

  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}
