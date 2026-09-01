// Prometheus buckets are cumulative: the sample for `le` counts every
// observation at or below that bound, not the ones between it and the previous.
export function summariseObservations(bounds, observations) {
  const cumulative = bounds.map((bound) =>
    observations.reduce((total, entry) => (entry.value <= bound ? total + entry.count : total), 0),
  );

  return {
    bounds,
    cumulative,
    sum: observations.reduce((total, entry) => total + entry.value * entry.count, 0),
    count: observations.reduce((total, entry) => total + entry.count, 0),
  };
}
