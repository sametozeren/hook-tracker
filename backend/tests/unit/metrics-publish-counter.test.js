import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createPublishCounter,
  publishRequestMetrics,
} from '../../src/api/metrics/publish-counter.js';

function finish(middleware, statusCode) {
  const res = new EventEmitter();

  res.statusCode = statusCode;

  middleware({}, res, () => {});
  res.emit('finish');
}

describe('createPublishCounter', () => {
  it('starts every series at zero so a scrape before the first publish still shows them', () => {
    expect(createPublishCounter().snapshot()).toEqual({ accepted: 0, rejected: 0, error: 0 });
  });
});

describe('publishRequestMetrics', () => {
  it('counts a request once its response is finished, by result', () => {
    const counter = createPublishCounter();
    const middleware = publishRequestMetrics(counter);

    finish(middleware, 202);
    finish(middleware, 202);
    finish(middleware, 429);
    finish(middleware, 500);

    expect(counter.snapshot()).toEqual({ accepted: 2, rejected: 1, error: 1 });
  });

  it('passes the request on rather than answering it', () => {
    const counter = createPublishCounter();
    const res = new EventEmitter();

    let passedOn = false;

    publishRequestMetrics(counter)({}, res, () => {
      passedOn = true;
    });

    expect(passedOn).toBe(true);
  });
});
