// Key order decides the hash, so the same payload written twice must serialise
// identically no matter how the caller's object was built.
export function canonicalJson(value) {
  if (value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}
