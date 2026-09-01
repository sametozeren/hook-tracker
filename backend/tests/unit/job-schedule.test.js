import { describe, expect, it, vi } from 'vitest';
import { createScheduleRunner } from '../../src/jobs/schedule.js';

function fakeTimers() {
  const registered = [];
  const cleared = [];

  return {
    registered,
    cleared,
    setTimer(callback, intervalMs) {
      registered.push({ callback, intervalMs });

      return registered.length;
    },
    clearTimer(handle) {
      cleared.push(handle);
    },
  };
}

function deferred() {
  let settle;

  const promise = new Promise((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

describe('createScheduleRunner', () => {
  it('registers the interval and runs the job once at startup', async () => {
    const timers = fakeTimers();
    const run = vi.fn(async () => {});

    const schedules = createScheduleRunner(timers);

    schedules.every({ name: 'retention', intervalMs: 1000, run });

    expect(timers.registered).toEqual([{ callback: expect.any(Function), intervalMs: 1000 }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not run at startup when the schedule asks not to', () => {
    const timers = fakeTimers();
    const run = vi.fn(async () => {});

    createScheduleRunner(timers).every({ name: 'sweep', intervalMs: 50, run, runOnStart: false });

    expect(run).not.toHaveBeenCalled();
  });

  it('skips a tick while the previous run is still in progress', async () => {
    const timers = fakeTimers();
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

    const schedules = createScheduleRunner({ ...timers, logger });

    schedules.every({ name: 'sweep', intervalMs: 10, run });
    timers.registered[0].callback();
    timers.registered[0].callback();

    expect(run).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);

    gate.settle();

    await schedules.stop();

    timers.registered[0].callback();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('logs a failing run and keeps the schedule alive', async () => {
    const timers = fakeTimers();
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

    const run = vi.fn(async () => {
      throw new Error('database unreachable');
    });

    const schedules = createScheduleRunner({ ...timers, logger });

    schedules.every({ name: 'retention', intervalMs: 10, run });

    await schedules.stop();

    expect(logger.error).toHaveBeenCalledWith(
      { job: 'retention', reason: 'database unreachable' },
      'scheduled job failed',
    );
  });

  it('clears every timer and waits for the run in flight', async () => {
    const timers = fakeTimers();
    const gate = deferred();

    let finished = false;

    const run = vi.fn(async () => {
      await gate.promise;

      finished = true;
    });

    const schedules = createScheduleRunner(timers);

    schedules.every({ name: 'retention', intervalMs: 10, run });
    schedules.every({ name: 'sweep', intervalMs: 20, run });

    gate.settle();

    await schedules.stop();

    expect(timers.cleared).toEqual([1, 2]);
    expect(finished).toBe(true);
  });
});
