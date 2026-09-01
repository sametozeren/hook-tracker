// Timers, not cron: both schedules are "every N", nothing here needs a wall
// clock date, and a dependency-free interval is one less thing to reason about
// when the process restarts at an arbitrary moment.
export function createScheduleRunner({
  logger,
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  const handles = [];
  const active = new Set();

  function every({ name, intervalMs, run, runOnStart = true }) {
    let inProgress = null;

    async function invoke() {
      try {
        await run();
      } catch (error) {
        logger?.error({ job: name, reason: error.message }, 'scheduled job failed');
      }
    }

    // A pass that outlives its interval must not be started twice: both jobs
    // walk the same rows, and a second overlapping pass would only contend
    // with the first one.
    function tick() {
      if (inProgress) {
        logger?.warn({ job: name, intervalMs }, 'previous run still in progress, skipping');

        return inProgress;
      }

      inProgress = invoke().finally(() => {
        active.delete(inProgress);
        inProgress = null;
      });

      active.add(inProgress);

      return inProgress;
    }

    handles.push(setTimer(tick, intervalMs));

    if (runOnStart) {
      tick();
    }

    return tick;
  }

  async function stop() {
    for (const handle of handles) {
      clearTimer(handle);
    }

    handles.length = 0;

    await Promise.allSettled([...active]);
  }

  return { every, stop };
}
