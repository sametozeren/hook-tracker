const DEFAULT_TIMEOUT_MS = 15_000;

const DEFAULT_INTERVAL_MS = 30;

export function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Polling rather than a fixed sleep: the test states the condition it is
// waiting for, so it finishes as soon as that condition holds and fails with a
// timeout rather than with a race.
export async function waitFor(
  probe,
  { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS } = {},
) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await probe();

    if (result) {
      return result;
    }

    if (Date.now() > deadline) {
      throw new Error('condition was not met before the timeout');
    }

    await wait(intervalMs);
  }
}
