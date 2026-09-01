import { describe, expect, it } from 'vitest';
import { summariseObservations } from '../../src/api/metrics/histogram.js';

const bounds = [1, 2, 3];

describe('summariseObservations', () => {
  it('makes each bucket count everything at or below its bound', () => {
    const summary = summariseObservations(bounds, [
      { value: 1, count: 5 },
      { value: 2, count: 3 },
      { value: 3, count: 2 },
    ]);

    expect(summary.cumulative).toEqual([5, 8, 10]);
  });

  it('sums the observations rather than the distinct values', () => {
    const summary = summariseObservations(bounds, [
      { value: 1, count: 5 },
      { value: 3, count: 2 },
    ]);

    expect(summary.sum).toBe(11);
    expect(summary.count).toBe(7);
  });

  it('leaves an observation above the last bound out of every bucket', () => {
    const summary = summariseObservations(bounds, [{ value: 9, count: 4 }]);

    expect(summary.cumulative).toEqual([0, 0, 0]);
    expect(summary.count).toBe(4);
  });

  it('reports zeroes for an empty table', () => {
    expect(summariseObservations(bounds, [])).toEqual({
      bounds,
      cumulative: [0, 0, 0],
      sum: 0,
      count: 0,
    });
  });
});
