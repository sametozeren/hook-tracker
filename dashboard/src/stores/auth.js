import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, configureApi, request } from '../lib/api.js';

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref(null);
  const user = ref(null);
  const memberships = ref([]);
  const ready = ref(false);

  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value));

  const projects = computed(() =>
    memberships.value.map((membership) => ({ ...membership.project, role: membership.role })),
  );

  function roleIn(projectId) {
    return (
      memberships.value.find((membership) => membership.project.id === projectId)?.role ?? null
    );
  }

  function clear() {
    accessToken.value = null;
    user.value = null;
    memberships.value = [];
  }

  function adopt(session) {
    accessToken.value = session.accessToken;

    if (session.user) {
      user.value = session.user;
    }
  }

  async function loadMe() {
    const me = await api.get('/auth/me');

    user.value = { id: me.id, email: me.email, name: me.name };
    memberships.value = me.memberships;

    return me;
  }

  // The refresh cookie is httpOnly, so the only way to learn whether a session
  // survives a page reload is to try rotating it once.
  async function refresh() {
    try {
      const body = await request('/auth/refresh', {
        method: 'POST',
        auth: false,
        retryOnUnauthorized: false,
      });

      accessToken.value = body.accessToken;

      return true;
    } catch {
      clear();

      return false;
    }
  }

  async function login(credentials) {
    const session = await request('/auth/login', {
      method: 'POST',
      body: credentials,
      auth: false,
      retryOnUnauthorized: false,
    });

    adopt(session);
    await loadMe();

    return session;
  }

  async function register(payload) {
    const session = await request('/auth/register', {
      method: 'POST',
      body: payload,
      auth: false,
      retryOnUnauthorized: false,
    });

    adopt(session);
    await loadMe();

    return session;
  }

  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST', auth: false, retryOnUnauthorized: false });
    } finally {
      clear();
    }
  }

  async function bootstrap() {
    if (ready.value) {
      return isAuthenticated.value;
    }

    const refreshed = await refresh();

    if (refreshed) {
      try {
        await loadMe();
      } catch {
        clear();
      }
    }

    ready.value = true;

    return isAuthenticated.value;
  }

  // `router/index.js` imports this store, so the router is pulled in only when a
  // session is actually lost; a static import would close that cycle at module
  // evaluation time.
  async function redirectToLogin() {
    const { router } = await import('../router/index.js');
    const current = router.currentRoute.value;

    if (current.meta.guest) {
      return;
    }

    const redirect = current.fullPath;

    await router.replace({ name: 'login', query: redirect === '/' ? {} : { redirect } });
  }

  function handleSessionLost() {
    clear();
    redirectToLogin().catch(() => undefined);
  }

  configureApi({
    getAccessToken: () => accessToken.value,
    refreshSession: refresh,
    onSessionLost: handleSessionLost,
  });

  return {
    accessToken,
    user,
    memberships,
    ready,
    isAuthenticated,
    projects,
    roleIn,
    loadMe,
    refresh,
    login,
    register,
    logout,
    bootstrap,
    clear,
  };
});
