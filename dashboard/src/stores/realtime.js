import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { io } from 'socket.io-client';
import { useAuthStore } from './auth.js';

const NAMESPACE = '/realtime';

export const useRealtimeStore = defineStore('realtime', () => {
  const auth = useAuthStore();
  const status = ref('offline');
  const lastError = ref('');
  const handlers = new Map();

  let socket = null;
  let socketToken = null;
  let expected = false;
  let tokenExpired = false;

  function emitLocal(event, payload) {
    for (const handler of handlers.get(event) ?? []) {
      handler(payload);
    }
  }

  function on(event, handler) {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }

    handlers.get(event).add(handler);

    return () => handlers.get(event)?.delete(handler);
  }

  function bind(instance) {
    instance.on('connect', () => {
      status.value = 'live';
      lastError.value = '';
    });

    instance.on('disconnect', () => {
      status.value = tokenExpired ? 'reconnecting' : 'offline';
    });

    instance.io.on('reconnect_attempt', () => {
      status.value = 'reconnecting';
    });

    instance.on('connect_error', (error) => {
      status.value = 'offline';
      lastError.value = error.message;
    });

    // The server disconnects a socket the moment its access token expires. The
    // token in the handshake is fixed for the life of the connection, so the
    // only way back is a fresh token, which the watcher below turns into a new
    // socket.
    instance.on('token_expired', async () => {
      tokenExpired = true;
      status.value = 'reconnecting';

      const refreshed = await auth.refresh();

      tokenExpired = false;

      if (!refreshed) {
        disconnect();
      }
    });

    for (const event of [
      'delivery.created',
      'delivery.attempted',
      'delivery.succeeded',
      'delivery.failed',
      'endpoint.disabled',
    ]) {
      instance.on(event, (payload) => emitLocal(event, payload));
    }
  }

  function teardown() {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    socketToken = null;
  }

  function connect() {
    if (!auth.accessToken) {
      return;
    }

    // A socket whose handshake carries a stale token is not reusable: the server
    // has already stopped delivering to it, so reusing it would render "Live"
    // over a dead connection.
    if (socket && socketToken === auth.accessToken) {
      return;
    }

    teardown();
    expected = true;
    status.value = 'connecting';
    socketToken = auth.accessToken;
    socket = io(NAMESPACE, { path: '/socket.io', auth: { token: socketToken } });
    bind(socket);
  }

  function disconnect() {
    teardown();
    expected = false;
    status.value = 'offline';
  }

  function reconnect() {
    teardown();
    connect();
  }

  // A namespace rejection is terminal for socket.io — the client never retries
  // it — and a REST-driven refresh leaves the socket holding a token the server
  // no longer honours. Either way the indicator would read "Offline" for the
  // rest of the session, so every fresh token rebuilds a socket that is meant
  // to be up.
  watch(
    () => auth.accessToken,
    (token) => {
      if (token && expected) {
        reconnect();
      }
    },
  );

  return { status, lastError, on, connect, disconnect, reconnect };
});
