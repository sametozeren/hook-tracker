export const REALTIME_CHANNEL_PREFIX = 'realtime';

export function realtimeChannel(projectId) {
  return `${REALTIME_CHANNEL_PREFIX}:${projectId}`;
}

// Workers hold no sockets. They publish here and the API instances fan out
// through the Socket.io Redis adapter, which is what makes several API replicas
// correct. Payloads carry ids only, never the webhook body or a secret.
export function createRealtimePublisher({ redis, logger }) {
  return {
    async emit({ projectId, event, payload }) {
      try {
        await redis.publish(realtimeChannel(projectId), JSON.stringify({ event, payload }));
      } catch (error) {
        logger?.warn({ event, reason: error.message }, 'realtime publish failed');
      }
    },
  };
}
