<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useRealtimeStore } from '../stores/realtime.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { useDeliveriesStore } from '../stores/deliveries.js';
import { cycleThemeMode, themeMode } from '../lib/theme.js';
import BrandMark from './ui/BrandMark.vue';
import ModalShell from './ModalShell.vue';
import ProjectCreateForm from './ProjectCreateForm.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const realtime = useRealtimeStore();
const endpoints = useEndpointsStore();
const deliveries = useDeliveriesStore();

const projectMenuOpen = ref(false);
const userMenuOpen = ref(false);
const navMenuOpen = ref(false);
const projectDialogOpen = ref(false);
const projectMenuRoot = ref(null);
const userMenuRoot = ref(null);
const navMenuRoot = ref(null);
const navMenuButton = ref(null);

const projectId = computed(() => route.params.projectId);
const project = computed(() => auth.projects.find((item) => item.id === projectId.value) ?? null);
const isOwner = computed(() => auth.roleIn(projectId.value) === 'OWNER');

const navItems = [
  { name: 'deliveries', label: 'Deliveries' },
  { name: 'endpoints', label: 'Endpoints' },
  { name: 'events', label: 'Events' },
  { name: 'settings', label: 'Settings' },
];

// Measured at 360px: beside the wordmark, theme button, avatar and disclosure
// button the bar has room for 'Live' and 'Offline' but not for the two longer
// labels, so those keep the dot alone below sm rather than overflowing the row.
const connection = computed(() => {
  const map = {
    live: { label: 'Live', tone: 'bg-ok', labelFitsNarrow: true },
    connecting: { label: 'Connecting', tone: 'bg-retry', labelFitsNarrow: false },
    reconnecting: { label: 'Reconnecting', tone: 'bg-retry', labelFitsNarrow: false },
    offline: { label: 'Offline', tone: 'bg-fail', labelFitsNarrow: true },
  };

  return map[realtime.status] ?? map.offline;
});

const themeLabel = computed(() => {
  const map = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

  return map[themeMode.value];
});

const themeAction = computed(() => `Change theme, currently ${themeMode.value}`);

const accountName = computed(() => auth.user?.name ?? auth.user?.email ?? 'your account');

const accountAction = computed(() => `Account menu for ${accountName.value}`);

const navMenuAction = computed(() =>
  navMenuOpen.value ? 'Close navigation and project menu' : 'Open navigation and project menu',
);

const navMenuIcon = computed(() =>
  navMenuOpen.value ? 'M3.5 3.5l9 9M12.5 3.5l-9 9' : 'M2 4h12M2 8h12M2 12h12',
);

const initials = computed(() => {
  const name = auth.user?.name ?? auth.user?.email ?? '';

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
});

function closeMenus() {
  projectMenuOpen.value = false;
  userMenuOpen.value = false;
  navMenuOpen.value = false;
}

function toggleProjectMenu() {
  const next = !projectMenuOpen.value;

  closeMenus();
  projectMenuOpen.value = next;
}

function toggleUserMenu() {
  const next = !userMenuOpen.value;

  closeMenus();
  userMenuOpen.value = next;
}

function toggleNavMenu() {
  const next = !navMenuOpen.value;

  closeMenus();
  navMenuOpen.value = next;
}

function switchProject(id) {
  closeMenus();
  router.push({ name: 'deliveries', params: { projectId: id } });
}

async function signOut() {
  closeMenus();
  realtime.disconnect();
  await auth.logout();
  router.push({ name: 'login' });
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    closeMenus();
  }
}

function onPointerDown(event) {
  if (projectMenuOpen.value && !projectMenuRoot.value?.contains(event.target)) {
    projectMenuOpen.value = false;
  }

  if (userMenuOpen.value && !userMenuRoot.value?.contains(event.target)) {
    userMenuOpen.value = false;
  }

  if (navMenuOpen.value && !navMenuRoot.value?.contains(event.target)) {
    navMenuOpen.value = false;
  }
}

// The menu that holds this trigger unmounts in the same patch that mounts the
// dialog, so the dialog would capture document.body as the element to restore
// focus to. Moving focus to a trigger that outlives the transition gives it
// something to return to: the disclosure button below md, the switcher above.
function openProjectDialog() {
  const anchor = navMenuOpen.value
    ? navMenuButton.value
    : projectMenuRoot.value?.querySelector('button');

  anchor?.focus();
  closeMenus();
  projectDialogOpen.value = true;
}

async function onProjectCreated(project) {
  projectDialogOpen.value = false;
  await auth.loadMe();
  router.push({ name: 'deliveries', params: { projectId: project.id } });
}

watch(projectId, () => {
  endpoints.reset();
  deliveries.reset();
  closeMenus();
});

watch(() => route.fullPath, closeMenus);

onMounted(() => {
  realtime.connect();
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('pointerdown', onPointerDown);
  realtime.disconnect();
});
</script>

<template>
  <div class="flex min-h-full flex-col bg-page text-ink">
    <header class="sticky top-0 z-30 border-b border-rule bg-surface">
      <div class="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:gap-5">
        <RouterLink
          :to="{ name: 'deliveries', params: { projectId } }"
          class="flex shrink-0 items-center gap-2 text-ink"
          aria-label="HookTracker, go to deliveries"
        >
          <BrandMark :size="22" decorative />
          <span class="text-[15px] leading-none font-medium tracking-[-0.015em]">HookTracker</span>
        </RouterLink>

        <nav class="hidden min-w-0 gap-0.5 md:flex" aria-label="Primary">
          <RouterLink
            v-for="item in navItems"
            :key="item.name"
            :to="{ name: item.name, params: { projectId } }"
            class="rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:bg-sunken hover:text-ink"
            active-class="bg-sunken font-medium text-ink"
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <div ref="projectMenuRoot" class="relative hidden min-w-0 md:block">
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg border border-rule px-2.5 py-1.5 text-sm font-medium hover:border-focus"
              :aria-expanded="projectMenuOpen"
              aria-haspopup="menu"
              @click="toggleProjectMenu"
            >
              <span class="max-w-[9rem] truncate lg:max-w-[14rem]">{{
                project?.name ?? 'Select a project'
              }}</span>
              <svg class="size-2.5 shrink-0 text-faint" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M2 4l3 3 3-3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>

            <div
              v-if="projectMenuOpen"
              class="absolute right-0 z-40 mt-1 min-w-56 rounded-lg border border-rule bg-surface p-1 shadow-lg"
              role="menu"
            >
              <button
                v-for="item in auth.projects"
                :key="item.id"
                type="button"
                class="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-sunken"
                role="menuitem"
                :aria-current="item.id === projectId ? 'true' : undefined"
                @click="switchProject(item.id)"
              >
                <span class="truncate">{{ item.name }}</span>
                <span class="font-mono text-[10px] tracking-wider text-faint">{{ item.role }}</span>
              </button>

              <div class="my-1 border-t border-rule"></div>

              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-muted hover:bg-sunken hover:text-ink"
                role="menuitem"
                @click="openProjectDialog"
              >
                <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
                  <path
                    d="M7 3v8M3 7h8"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  />
                </svg>
                New project
              </button>
            </div>
          </div>

          <span
            class="flex shrink-0 items-center gap-2 text-xs text-muted"
            :title="realtime.lastError || `Realtime socket: ${realtime.status}`"
          >
            <span class="size-2 rounded-full" :class="connection.tone" aria-hidden="true"></span>
            <span :class="{ 'max-sm:sr-only': !connection.labelFitsNarrow }">{{
              connection.label
            }}</span>
          </span>

          <button
            type="button"
            class="block shrink-0 rounded-md border border-rule px-2 py-1.5 text-xs text-muted hover:border-focus hover:text-ink"
            :title="themeLabel"
            :aria-label="themeAction"
            @click="cycleThemeMode()"
          >
            <svg class="size-4" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.3" />
              <path
                d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
              />
            </svg>
          </button>

          <div ref="userMenuRoot" class="relative shrink-0">
            <button
              type="button"
              class="grid size-9 place-items-center rounded-full border-2 border-rule bg-sunken text-[11px] font-semibold text-ink transition-colors hover:border-focus hover:bg-page focus-visible:border-focus"
              :aria-expanded="userMenuOpen"
              aria-haspopup="menu"
              :aria-label="accountAction"
              @click="toggleUserMenu"
            >
              <span aria-hidden="true">{{ initials }}</span>
            </button>

            <div
              v-if="userMenuOpen"
              class="absolute right-0 z-40 mt-1 min-w-56 rounded-lg border border-rule bg-surface p-1 shadow-lg"
              role="menu"
            >
              <p class="px-2.5 py-1.5 text-xs text-faint">
                {{ auth.user?.email }}
                <span v-if="isOwner" class="ml-1 font-mono text-[10px] tracking-wider">OWNER</span>
              </p>
              <RouterLink
                :to="{ name: 'settings', params: { projectId } }"
                class="block rounded-md px-2.5 py-1.5 text-sm hover:bg-sunken"
                role="menuitem"
                @click="closeMenus"
              >
                Project settings
              </RouterLink>
              <button
                type="button"
                class="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-sunken"
                role="menuitem"
                @click="signOut"
              >
                Sign out
              </button>
            </div>
          </div>

          <div ref="navMenuRoot" class="shrink-0 md:hidden">
            <button
              ref="navMenuButton"
              type="button"
              class="grid size-9 place-items-center rounded-md border border-rule text-muted hover:border-focus hover:text-ink"
              :aria-expanded="navMenuOpen"
              :aria-label="navMenuAction"
              aria-controls="app-nav-panel"
              @click="toggleNavMenu"
            >
              <svg class="size-4" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  :d="navMenuIcon"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </button>

            <div
              v-if="navMenuOpen"
              id="app-nav-panel"
              class="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-rule bg-surface px-4 py-3 shadow-lg"
            >
              <nav class="flex flex-col gap-0.5" aria-label="Primary">
                <RouterLink
                  v-for="item in navItems"
                  :key="item.name"
                  :to="{ name: item.name, params: { projectId } }"
                  class="rounded-md px-2.5 py-2 text-sm text-muted hover:bg-sunken hover:text-ink"
                  active-class="bg-sunken font-medium text-ink"
                  @click="closeMenus"
                >
                  {{ item.label }}
                </RouterLink>
              </nav>

              <div class="mt-3 border-t border-rule pt-3">
                <p class="eyebrow px-2.5">Project</p>

                <div class="mt-1 flex flex-col gap-0.5">
                  <button
                    v-for="item in auth.projects"
                    :key="item.id"
                    type="button"
                    class="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-sunken"
                    :aria-current="item.id === projectId ? 'true' : undefined"
                    @click="switchProject(item.id)"
                  >
                    <span class="truncate">{{ item.name }}</span>
                    <span class="shrink-0 font-mono text-[10px] tracking-wider text-faint">{{
                      item.role
                    }}</span>
                  </button>

                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-muted hover:bg-sunken hover:text-ink"
                    @click="openProjectDialog"
                  >
                    <svg class="size-3.5 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
                      <path
                        d="M7 3v8M3 7h8"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                      />
                    </svg>
                    New project
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">
      <RouterView />
    </main>

    <ModalShell
      v-if="projectDialogOpen"
      eyebrow="Projects"
      title="New project"
      description="Endpoints, API keys and deliveries belong to one project. This one starts empty, and you become its owner."
      @close="projectDialogOpen = false"
    >
      <ProjectCreateForm
        :autofocus="false"
        @created="onProjectCreated"
        @cancel="projectDialogOpen = false"
      />
    </ModalShell>
  </div>
</template>
