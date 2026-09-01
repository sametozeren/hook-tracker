import { describe, expect, it } from 'vitest';
import { formatLabels, formatValue, renderMetrics } from '../../src/api/metrics/exposition.js';

describe('formatValue', () => {
  it('writes the infinities the way the exposition format spells them', () => {
    expect(formatValue(Number.POSITIVE_INFINITY)).toBe('+Inf');
    expect(formatValue(Number.NEGATIVE_INFINITY)).toBe('-Inf');
    expect(formatValue(Number.NaN)).toBe('NaN');
    expect(formatValue(1.5)).toBe('1.5');
  });
});

describe('formatLabels', () => {
  it('renders nothing when there are no labels', () => {
    expect(formatLabels()).toBe('');
    expect(formatLabels({})).toBe('');
  });

  it('drops a label whose value was not collected', () => {
    expect(formatLabels({ queue: 'webhook.delivery', level: undefined })).toBe(
      '{queue="webhook.delivery"}',
    );
  });

  it('escapes a quote, a backslash and a newline in a label value', () => {
    expect(formatLabels({ queue: 'a"b\\c\nd' })).toBe('{queue="a\\"b\\\\c\\nd"}');
  });
});

describe('renderMetrics', () => {
  it('writes a HELP and a TYPE line before the samples of a family', () => {
    const text = renderMetrics([
      {
        name: 'hooktracker_dlq_size',
        help: 'Messages waiting on the dead-letter queue.',
        type: 'gauge',
        samples: [{ value: 3 }],
      },
    ]);

    expect(text).toBe(
      [
        '# HELP hooktracker_dlq_size Messages waiting on the dead-letter queue.',
        '# TYPE hooktracker_dlq_size gauge',
        'hooktracker_dlq_size 3',
        '',
      ].join('\n'),
    );
  });

  it('closes a histogram with a +Inf bucket, a sum and a count', () => {
    const text = renderMetrics([
      {
        name: 'hooktracker_delivery_duration_seconds',
        help: 'Durations.',
        type: 'histogram',
        bounds: [0.1, 1],
        cumulative: [2, 5],
        sum: 4.5,
        count: 6,
      },
    ]);

    expect(text.split('\n').slice(2, -1)).toEqual([
      'hooktracker_delivery_duration_seconds_bucket{le="0.1"} 2',
      'hooktracker_delivery_duration_seconds_bucket{le="1"} 5',
      'hooktracker_delivery_duration_seconds_bucket{le="+Inf"} 6',
      'hooktracker_delivery_duration_seconds_sum 4.5',
      'hooktracker_delivery_duration_seconds_count 6',
    ]);
  });

  it('omits a family the collector could not read', () => {
    const text = renderMetrics([
      null,
      { name: 'hooktracker_dlq_size', help: 'h', type: 'gauge', samples: [{ value: 0 }] },
    ]);

    expect(text).not.toContain('null');
    expect(text.startsWith('# HELP hooktracker_dlq_size')).toBe(true);
  });
});
