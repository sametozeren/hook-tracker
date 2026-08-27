import { init } from '@paralleldrive/cuid2';

const createSuffix = init({ length: 24 });

export const ID_PREFIXES = Object.freeze({
  user: 'usr',
  project: 'prj',
  apiKey: 'key',
  endpoint: 'ep',
  event: 'evt',
  delivery: 'dlv',
  attempt: 'att',
});

const PREFIX_PATTERN = /^([a-z]+)_([0-9a-z]{24})$/;

function prefixFor(kind) {
  const prefix = ID_PREFIXES[kind];

  if (!prefix) {
    throw new TypeError(`Unknown id kind "${kind}"`);
  }

  return prefix;
}

export function newId(kind) {
  return `${prefixFor(kind)}_${createSuffix()}`;
}

export function isId(kind, value) {
  if (typeof value !== 'string') return false;

  const match = PREFIX_PATTERN.exec(value);

  return match !== null && match[1] === prefixFor(kind);
}

export function assertId(kind, value) {
  if (!isId(kind, value)) {
    throw new TypeError(`Expected a ${prefixFor(kind)}_ id, received ${JSON.stringify(value)}`);
  }

  return value;
}
