import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { guest: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('../views/RegisterView.vue'),
    meta: { guest: true },
  },
  {
    path: '/projects/:projectId',
    component: () => import('../components/AppShell.vue'),
    children: [
      { path: '', redirect: (to) => ({ name: 'deliveries', params: to.params }) },
      {
        path: 'deliveries',
        name: 'deliveries',
        component: () => import('../views/DeliveriesView.vue'),
        children: [
          {
            path: ':deliveryId',
            name: 'delivery',
            component: () => import('../views/DeliveryDetailPanel.vue'),
          },
        ],
      },
      {
        path: 'endpoints',
        name: 'endpoints',
        component: () => import('../views/EndpointsView.vue'),
      },
      { path: 'events', name: 'events', component: () => import('../views/EventsView.vue') },
      { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    ],
  },
  { path: '/', name: 'home', redirect: { name: 'login' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', redirect: { name: 'home' } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

function firstProjectRoute(auth) {
  const project = auth.projects[0];

  return project ? { name: 'deliveries', params: { projectId: project.id } } : null;
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  await auth.bootstrap();

  // A signed-in session with no membership has nowhere to be sent, so it stays
  // on the login screen, which states that and offers a way forward. Sending it
  // to a project route would redirect straight back here.
  if (to.meta.guest) {
    return (auth.isAuthenticated && firstProjectRoute(auth)) || true;
  }

  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }

  if (to.name === 'home') {
    return firstProjectRoute(auth) ?? { name: 'login' };
  }

  // A project id in the URL that the session has no membership for is answered
  // the way the API answers it: nothing is disclosed, the user goes to a
  // project that is theirs.
  if (to.params.projectId && !auth.roleIn(to.params.projectId)) {
    return firstProjectRoute(auth) ?? { name: 'login' };
  }

  return true;
});
