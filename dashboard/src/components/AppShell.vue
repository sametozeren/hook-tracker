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
const projectDialogOpen = ref(false);
const projectMenuRoot = ref(null);
const userMenuRoot = ref(null);

const projectId = computed(() => route.params.projectId);
const project = computed(() => auth.projects.find((item) => item.id === projectId.value) ?? null);
const isOwner = computed(() => auth.roleIn(projectId.value) === 'OWNER');

const navItems = [
  { name: 'deliveries', label: 'Deliveries' },
  { name: 'endpoints', label: 'Endpoints' },
  { name: 'events', label: 'Events' },
  { name: 'settings', label: 'Settings' },
];

const connection = computed(() => {
  const map = {
    live: { label: 'Live', tone: 'bg-ok' },
    connecting: { label: 'Connecting', tone: 'bg-retry' },
    reconnecting: { label: 'Reconnecting', tone: 'bg-retry' },
    offline: { label: 'Offline', tone: 'bg-fail' },
  };

  return map[realtime.status] ?? map.offline;
});

const themeLabel = computed(() => {
  const map = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

  return map[themeMode.value];
});

const themeAction = computed(() => `Change theme, currently ${themeMode.value}`);

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
}

// The menu that holds this trigger unmounts in the same patch that mounts the
// dialog, so the dialog would capture document.body as the element to restore
// focus to. Moving focus to the switcher first gives it something that outlives
// the transition.
function openProjectDialog() {
  projectMenuRoot.value?.querySelector('button')?.focus();
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
          class="shrink-0 text-ink"
          aria-label="hook-tracker, go to deliveries"
        >
          <BrandMark :size="22" />
        </RouterLink>

        <div ref="projectMenuRoot" class="relative shrink-0">
          <button
            type="button"
            class="flex items-center gap-2 rounded-lg border border-rule px-2.5 py-1.5 text-sm font-medium hover:border-focus"
            :aria-expanded="projectMenuOpen"
            aria-haspopup="menu"
            @click="projectMenuOpen = !projectMenuOpen"
          >
            <span class="max-w-[9rem] truncate sm:max-w-[14rem]">{{
              project?.name ?? 'Select a project'
            }}</span>
            <svg class="size-2.5 text-faint" viewBox="0 0 10 10" aria-hidden="true">
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
            class="absolute left-0 z-40 mt-1 min-w-56 rounded-lg border border-rule bg-surface p-1 shadow-lg"
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
              <svg class="size-3.5" viewBox="0 0 14 14" aria-hidden="true">
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

        <nav
          class="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Primary"
        >
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

        <div class="flex shrink-0 items-center gap-2 sm:gap-3">
          <span
            class="flex items-center gap-2 text-xs text-muted"
            :title="realtime.lastError || `Realtime socket: ${realtime.status}`"
          >
            <span class="size-2 rounded-full" :class="connection.tone" aria-hidden="true"></span>
            <span class="max-sm:sr-only">{{ connection.label }}</span>
          </span>

          <button
            type="button"
            class="rounded-md border border-rule px-2 py-1.5 text-xs text-muted hover:border-focus hover:text-ink"
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

          <div ref="userMenuRoot" class="relative">
            <button
              type="button"
              class="flex items-center gap-2 rounded-md p-1 text-sm text-muted hover:text-ink"
              :aria-expanded="userMenuOpen"
              aria-haspopup="menu"
              @click="userMenuOpen = !userMenuOpen"
            >
              <span
                class="grid size-7 place-items-center rounded-full border border-rule bg-sunken text-[11px] font-medium"
                aria-hidden="true"
                >{{ initials }}</span
              >
              <span class="hidden max-w-[10rem] truncate lg:inline">{{ auth.user?.name }}</span>
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
