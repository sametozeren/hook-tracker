import { PUBLISH_RESULTS, publishResult } from './labels.js';

// The only counter that is not read back from Postgres or the broker: a
// rejected publish leaves no row anywhere, so nothing outside this process
// remembers it. Prometheus scrapes each API replica as its own target, which is
// what makes a per-process counter the correct shape here.
export function createPublishCounter() {
  const counts = new Map(PUBLISH_RESULTS.map((result) => [result, 0]));

  return {
    record(result) {
      counts.set(result, (counts.get(result) ?? 0) + 1);
    },

    snapshot() {
      return Object.fromEntries(counts);
    },
  };
}

// Mounted before the body parser so a payload rejected by the size limit — the
// one publish failure answered before the router is reached — is still counted.
export function publishRequestMetrics(counter) {
  return function countPublishRequest(req, res, next) {
    res.on('finish', () => {
      counter.record(publishResult(res.statusCode));
    });

    next();
  };
}
