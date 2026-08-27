export const EVENT_TYPE_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

export const MAX_EVENT_TYPE_LENGTH = 64;

export function isValidEventType(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_EVENT_TYPE_LENGTH &&
    EVENT_TYPE_PATTERN.test(value)
  );
}

// A bare "*" is not a pattern: an empty subscription list already means every
// event, and two ways to say one thing invite mistakes.
function patternMatches(pattern, eventType) {
  if (pattern === '*') {
    return false;
  }

  if (!pattern.endsWith('.*')) {
    return pattern === eventType;
  }

  const prefix = pattern.slice(0, -2);

  if (!eventType.startsWith(`${prefix}.`)) {
    return false;
  }

  const remainder = eventType.slice(prefix.length + 1);

  return remainder.length > 0 && !remainder.includes('.');
}

export function subscriptionMatches(patterns, eventType) {
  if (!patterns || patterns.length === 0) {
    return true;
  }

  return patterns.some((pattern) => patternMatches(pattern, eventType));
}
