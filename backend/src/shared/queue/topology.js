import { RETRY_SCHEDULE, THROTTLE_DELAY_MS } from '../retry.js';

export const DEFAULT_NAMESPACE = 'webhook';

export const DELIVERY_ROUTING_KEY = 'delivery';

export const DLQ_ROUTING_KEY = 'dlq';

export const THROTTLE_LEVEL = '10s';

export function createTopology({
  namespace = DEFAULT_NAMESPACE,
  schedule = RETRY_SCHEDULE,
  throttleDelayMs = THROTTLE_DELAY_MS,
} = {}) {
  const exchanges = {
    main: `${namespace}.exchange`,
    retry: `${namespace}.retry`,
    dlx: `${namespace}.dlx`,
  };

  const retryQueues = schedule.map((level) => ({
    level: level.level,
    delayMs: level.delayMs,
    queue: `${namespace}.retry.${level.level}`,
    routingKey: `retry.${level.level}`,
  }));

  return Object.freeze({
    namespace,
    exchanges: Object.freeze(exchanges),
    deliveryQueue: `${namespace}.delivery`,
    deliveryRoutingKey: DELIVERY_ROUTING_KEY,
    retryQueues: Object.freeze(retryQueues),
    throttleQueue: Object.freeze({
      level: THROTTLE_LEVEL,
      delayMs: throttleDelayMs,
      queue: `${namespace}.throttle.${THROTTLE_LEVEL}`,
      routingKey: `throttle.${THROTTLE_LEVEL}`,
    }),
    deadLetterQueue: `${namespace}.dlq`,
    deadLetterRoutingKey: DLQ_ROUTING_KEY,
  });
}

function delayQueueArguments(topology, delayMs) {
  return {
    'x-message-ttl': delayMs,
    'x-dead-letter-exchange': topology.exchanges.main,
    'x-dead-letter-routing-key': topology.deliveryRoutingKey,
  };
}

export async function assertTopology(channel, topology = createTopology()) {
  await channel.assertExchange(topology.exchanges.main, 'direct', { durable: true });
  await channel.assertExchange(topology.exchanges.retry, 'direct', { durable: true });
  await channel.assertExchange(topology.exchanges.dlx, 'direct', { durable: true });

  await channel.assertQueue(topology.deliveryQueue, { durable: true });
  await channel.bindQueue(
    topology.deliveryQueue,
    topology.exchanges.main,
    topology.deliveryRoutingKey,
  );

  for (const level of [...topology.retryQueues, topology.throttleQueue]) {
    await channel.assertQueue(level.queue, {
      durable: true,
      arguments: delayQueueArguments(topology, level.delayMs),
    });

    await channel.bindQueue(level.queue, topology.exchanges.retry, level.routingKey);
  }

  await channel.assertQueue(topology.deadLetterQueue, { durable: true });
  await channel.bindQueue(
    topology.deadLetterQueue,
    topology.exchanges.dlx,
    topology.deadLetterRoutingKey,
  );

  return topology;
}

export function allQueueNames(topology = createTopology()) {
  return [
    topology.deliveryQueue,
    ...topology.retryQueues.map((level) => level.queue),
    topology.throttleQueue.queue,
    topology.deadLetterQueue,
  ];
}
