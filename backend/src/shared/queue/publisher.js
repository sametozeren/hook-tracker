import { applyJitter } from '../retry.js';
import { assertId } from '../ids.js';
import { createTopology } from './topology.js';

function messageFor(deliveryId, attempt) {
  assertId('delivery', deliveryId);

  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new TypeError(`Expected a 1-based attempt number, received ${JSON.stringify(attempt)}`);
  }

  return Buffer.from(JSON.stringify({ deliveryId, attempt }), 'utf8');
}

export function createPublisher({ channel, topology = createTopology(), random = Math.random }) {
  function publish(exchange, routingKey, payload, options = {}) {
    return new Promise((resolve, reject) => {
      channel.publish(
        exchange,
        routingKey,
        payload,
        { persistent: true, contentType: 'application/json', ...options },
        (error) => {
          if (error) {
            reject(error);

            return;
          }

          resolve();
        },
      );
    });
  }

  function delayLevel(level) {
    const found = topology.retryQueues.find((entry) => entry.level === level);

    if (!found) {
      throw new TypeError(`Unknown retry level "${level}"`);
    }

    return found;
  }

  return {
    topology,

    async publishDelivery({ deliveryId, attempt }) {
      return publish(
        topology.exchanges.main,
        topology.deliveryRoutingKey,
        messageFor(deliveryId, attempt),
      );
    },

    async publishRetry({ deliveryId, attempt, level }) {
      const target = delayLevel(level);

      return publish(topology.exchanges.retry, target.routingKey, messageFor(deliveryId, attempt), {
        expiration: String(applyJitter(target.delayMs, random)),
      });
    },

    async publishThrottle({ deliveryId, attempt }) {
      return publish(
        topology.exchanges.retry,
        topology.throttleQueue.routingKey,
        messageFor(deliveryId, attempt),
      );
    },

    async publishDeadLetter({ deliveryId, attempt }) {
      return publish(
        topology.exchanges.dlx,
        topology.deadLetterRoutingKey,
        messageFor(deliveryId, attempt),
      );
    },
  };
}
