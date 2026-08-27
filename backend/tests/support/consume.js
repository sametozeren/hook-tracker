function bodyOf(message) {
  return JSON.parse(message.content.toString('utf8'));
}

// Collects everything a queue receives for the lifetime of the file. Assertions
// then filter by delivery id, which is what lets several tests share one queue.
export async function recordInto(channel, queue, sink) {
  const { consumerTag } = await channel.consume(queue, (message) => {
    if (!message) {
      return;
    }

    channel.ack(message);
    sink.push(bodyOf(message));
  });

  return consumerTag;
}

// One message, then the consumer is cancelled. Leaving it attached would let
// this waiter win the round-robin for a later test's message.
export async function waitForMessage(channel, queue) {
  let resolveMessage;

  const received = new Promise((resolve) => {
    resolveMessage = resolve;
  });

  const { consumerTag } = await channel.consume(queue, (message) => {
    if (!message) {
      return;
    }

    channel.ack(message);
    resolveMessage({ body: bodyOf(message), at: Date.now() });
  });

  return {
    async received() {
      const result = await received;

      await channel.cancel(consumerTag);

      return result;
    },
  };
}
