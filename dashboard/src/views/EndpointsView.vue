<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { describeApiError } from '../lib/api-error-message.js';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SectionFrame from '../components/SectionFrame.vue';
import EndpointFormDialog from '../components/EndpointFormDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import ErrorState from '../components/ui/ErrorState.vue';
import IconClose from '../components/ui/IconClose.vue';
import SecretRevealDialog from '../components/SecretRevealDialog.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import UiButton from '../components/ui/UiButton.vue';
import { useAuthStore } from '../stores/auth.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { useRealtimeStore } from '../stores/realtime.js';

// Mirrors the worker's ENDPOINT_AUTO_DISABLE_THRESHOLD default. The API returns
// no disabled-at timestamp and no disable reason, so the failure count is the
// only evidence the dashboard has for why an endpoint went down — and the server
// threshold can differ from this one, which is why both readings are hedged.
const AUTO_DISABLE_THRESHOLD = 20;

const NOTICE_TONES = {
  ok: { frame: 'border-rule bg-ok-soft', title: 'text-ok' },
  skip: { frame: 'border-rule bg-skip-soft', title: 'text-skip' },
  fail: { frame: 'border-rule bg-fail-soft', title: 'text-fail' },
};

const route = useRoute();
const auth = useAuthStore();
const endpoints = useEndpointsStore();
const realtime = useRealtimeStore();

const notice = ref(null);
const busy = ref({ id: '', action: '' });
const formTarget = ref(null);
const formOpen = ref(false);
const secretReveal = ref(null);
const deleteTarget = ref(null);
const deleting = ref(false);

const projectId = computed(() => String(route.params.projectId ?? ''));

const isOwner = computed(() => auth.roleIn(projectId.value) === 'OWNER');

const rows = computed(() => endpoints.items);

const showSkeleton = computed(() => endpoints.loading && rows.value.length === 0);

const showError = computed(
  () => Boolean(endpoints.error) && !endpoints.loading && rows.value.length === 0,
);

const showEmpty = computed(() => !endpoints.loading && !endpoints.error && rows.value.length === 0);

const noticeTone = computed(() => NOTICE_TONES[notice.value?.tone] ?? NOTICE_TONES.ok);

const urlPartsById = computed(() =>
  Object.fromEntries(endpoints.items.map((item) => [item.id, urlParts(item.url)])),
);

function labelFor(endpoint) {
  return endpoints.displayName(endpoint.id);
}

function urlParts(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;

    return { host: parsed.host, path: `${path}${parsed.search}` };
  } catch {
    return { host: rawUrl, path: '' };
  }
}

function disabledReason(endpoint) {
  return endpoint.consecutiveFailures >= AUTO_DISABLE_THRESHOLD
    ? `Its ${endpoint.consecutiveFailures} consecutive failures reach the automatic disable threshold, so it was most likely disabled automatically.`
    : 'Its failure count is below the automatic disable threshold, so it was most likely disabled by hand.';
}

function isBusy(endpoint, action) {
  return busy.value.id === endpoint.id && busy.value.action === action;
}

function errorNotice(caught, title) {
  return {
    tone: 'fail',
    title,
    body: describeApiError(caught) || 'The request failed.',
    requestId: caught?.requestId ?? '',
  };
}

async function loadEndpoints(force = false) {
  try {
    await endpoints.load(projectId.value, { force });
  } catch {
    // The store keeps the failure; the view renders it as the error state.
  }
}

async function withBusy(endpoint, action, run) {
  busy.value = { id: endpoint.id, action };

  try {
    await run();
  } finally {
    busy.value = { id: '', action: '' };
  }
}

async function enableEndpoint(endpoint) {
  await withBusy(endpoint, 'enable', async () => {
    try {
      await endpoints.enable(endpoint.id);
      notice.value = {
        tone: 'ok',
        title: 'Endpoint enabled.',
        body: `${labelFor(endpoint)} receives deliveries again and its consecutive failure count is back to 0.`,
      };
    } catch (caught) {
      notice.value = errorNotice(caught, 'The endpoint could not be enabled.');
    }
  });
}

async function disableEndpoint(endpoint) {
  await withBusy(endpoint, 'disable', async () => {
    try {
      await endpoints.disable(endpoint.id);
      notice.value = {
        tone: 'skip',
        title: 'Endpoint disabled.',
        body: `${labelFor(endpoint)} stops receiving deliveries until you enable it. Its delivery history stays readable.`,
      };
    } catch (caught) {
      notice.value = errorNotice(caught, 'The endpoint could not be disabled.');
    }
  });
}

async function sendTest(endpoint) {
  await withBusy(endpoint, 'test', async () => {
    try {
      const result = await endpoints.sendTest(endpoint.id);
      const delivery =
        result.deliveries?.find((item) => item.endpointId === endpoint.id) ??
        result.deliveries?.[0] ??
        null;

      if (!delivery || delivery.status === 'SKIPPED') {
        notice.value = {
          tone: 'skip',
          title: 'The test event was skipped.',
          body: `${labelFor(endpoint)} was not sent the synthetic ping, so there is no attempt to open. An endpoint is skipped when it is disabled, or when its event types do not include ping.`,
        };

        return;
      }

      notice.value = {
        tone: 'ok',
        title: 'Test event queued.',
        body: `A synthetic ping is on its way to ${labelFor(endpoint)}.`,
        link: {
          label: 'Open the delivery',
          to: { name: 'delivery', params: { projectId: projectId.value, deliveryId: delivery.id } },
        },
      };
    } catch (caught) {
      notice.value = errorNotice(caught, 'The test event could not be sent.');
    }
  });
}

async function rotateSecret(endpoint) {
  await withBusy(endpoint, 'rotate', async () => {
    try {
      const rotated = await endpoints.rotateSecret(endpoint.id);

      secretReveal.value = {
        mode: 'rotated',
        secret: rotated.secret,
        previousSecretExpiresAt: rotated.previousSecretExpiresAt,
        endpointLabel: labelFor(endpoint),
      };
    } catch (caught) {
      notice.value = errorNotice(caught, 'The secret could not be rotated.');
    }
  });
}

async function confirmDelete() {
  const endpoint = deleteTarget.value;
  // Resolved before the call: a successful delete drops the row from the store,
  // and displayName would then fall back to the raw id.
  const label = labelFor(endpoint);

  deleting.value = true;

  try {
    await endpoints.remove(endpoint.id);
    deleteTarget.value = null;
    notice.value = {
      tone: 'ok',
      title: 'Endpoint deleted.',
      body: `${label} is gone. Nothing will be delivered to it again.`,
    };
  } catch (caught) {
    deleteTarget.value = null;

    if (caught?.status === 409) {
      notice.value = {
        tone: 'fail',
        title: 'This endpoint cannot be deleted.',
        body: `${label} has delivery history, and deleting it would take that audit trail with it. Disable it instead: it stops receiving deliveries and every past delivery stays readable.`,
        disable: endpoint.status === 'ACTIVE' ? endpoint : null,
      };

      return;
    }

    notice.value = errorNotice(caught, 'The endpoint could not be deleted.');
  } finally {
    deleting.value = false;
  }
}

function openCreate() {
  formTarget.value = null;
  formOpen.value = true;
}

function openEdit(endpoint) {
  formTarget.value = endpoint;
  formOpen.value = true;
}

function closeForm() {
  formOpen.value = false;
  formTarget.value = null;
}

function onCreated(created) {
  closeForm();
  secretReveal.value = {
    mode: 'created',
    secret: created.secret,
    previousSecretExpiresAt: null,
    endpointLabel: labelFor(created),
  };
}

function onUpdated(updated) {
  closeForm();
  notice.value = {
    tone: 'ok',
    title: 'Endpoint saved.',
    body: `${labelFor(updated)} is updated.`,
  };
}

let stopRealtime = null;

onMounted(() => {
  loadEndpoints();
  stopRealtime = realtime.on('endpoint.disabled', (payload) => {
    endpoints.markDisabled(payload.endpointId, payload.consecutiveFailures);
  });
});

onBeforeUnmount(() => {
  stopRealtime?.();
});

watch(projectId, () => {
  notice.value = null;
  loadEndpoints();
});
</script>

<template>
  <div class="space-y-5">
    <SectionFrame
      title="Endpoints"
      heading="Where this project delivers events"
      description="Each endpoint is one HTTP target, its own signing secret, its own rate limit and its own failure count."
    >
      <template #actions>
        <UiButton v-if="isOwner" variant="primary" @click="openCreate">New endpoint</UiButton>
      </template>
    </SectionFrame>

    <div
      role="status"
      :class="notice ? ['rounded-md border px-3 py-3', noticeTone.frame] : 'sr-only'"
    >
      <div v-if="notice" class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium" :class="noticeTone.title">{{ notice.title }}</p>
          <p class="mt-1 max-w-prose text-sm break-words text-ink">{{ notice.body }}</p>
          <p v-if="notice.requestId" class="mt-1 text-xs text-faint">
            Request id
            <span class="font-mono break-all text-muted">{{ notice.requestId }}</span>
          </p>

          <div v-if="notice.link || notice.disable" class="mt-3 flex flex-wrap gap-2">
            <RouterLink
              v-if="notice.link"
              :to="notice.link.to"
              class="inline-flex h-7 items-center rounded-md border border-rule bg-surface px-2.5 text-xs font-medium text-ink hover:bg-sunken"
            >
              {{ notice.link.label }}
            </RouterLink>
            <UiButton
              v-if="notice.disable"
              size="sm"
              :loading="isBusy(notice.disable, 'disable')"
              @click="disableEndpoint(notice.disable)"
            >
              Disable {{ labelFor(notice.disable) }}
            </UiButton>
          </div>
        </div>

        <button
          type="button"
          class="-mt-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-surface hover:text-ink"
          aria-label="Dismiss this message"
          @click="notice = null"
        >
          <IconClose class="size-3" />
        </button>
      </div>
    </div>

    <div v-if="showSkeleton" class="rounded-lg border border-rule bg-surface px-4 py-4">
      <SkeletonRows :rows="4" :columns="['38%', '14%', '26%', '12%', '10%']" />
    </div>

    <ErrorState
      v-else-if="showError"
      title="The endpoints could not be loaded."
      :detail="describeApiError(endpoints.error)"
      :request-id="endpoints.error?.requestId || ''"
      @retry="loadEndpoints(true)"
    />

    <EmptyState
      v-else-if="showEmpty"
      title="No endpoints yet"
      description="An endpoint is one HTTP URL this project posts every matching event to, signed with its own secret and retried on its own schedule until it succeeds."
    >
      <p v-if="!isOwner">Ask a project owner to add the first one.</p>
      <template #actions>
        <UiButton v-if="isOwner" variant="primary" @click="openCreate">
          Create the first endpoint
        </UiButton>
      </template>
    </EmptyState>

    <ul v-else class="divide-y divide-rule-soft rounded-lg border border-rule bg-surface">
      <li
        v-for="endpoint in rows"
        :key="endpoint.id"
        class="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6"
      >
        <div class="min-w-0 space-y-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em]"
              :class="
                endpoint.status === 'ACTIVE' ? 'bg-ok-soft text-ok' : 'bg-skip-soft text-skip'
              "
            >
              <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
              {{ endpoint.status }}
            </span>
            <span v-if="endpoint.description" class="truncate text-sm text-muted">
              {{ endpoint.description }}
            </span>
          </div>

          <p class="truncate font-mono text-sm" :title="endpoint.url">
            <span class="font-semibold text-ink">{{ urlPartsById[endpoint.id].host }}</span>
            <span class="text-muted">{{ urlPartsById[endpoint.id].path }}</span>
          </p>

          <div class="flex flex-wrap items-center gap-1.5">
            <span class="eyebrow">Events</span>
            <span v-if="endpoint.eventTypes.length === 0" class="text-xs text-muted">
              All event types
            </span>
            <template v-else>
              <span
                v-for="type in endpoint.eventTypes"
                :key="type"
                class="max-w-full truncate rounded-md border border-rule-soft bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink"
              >
                {{ type }}
              </span>
            </template>
          </div>

          <div
            v-if="endpoint.status === 'DISABLED'"
            class="rounded-md border border-rule-soft bg-skip-soft px-3 py-2.5"
          >
            <p class="text-sm text-ink">{{ disabledReason(endpoint) }}</p>
            <p class="mt-1 max-w-prose text-xs text-muted">
              Nothing is delivered while it is disabled. The API does not record when it was
              disabled, so this page cannot show a time. Enabling it resumes delivery and resets the
              consecutive failure count to 0.
            </p>
            <div class="mt-2">
              <UiButton
                size="sm"
                :loading="isBusy(endpoint, 'enable')"
                @click="enableEndpoint(endpoint)"
              >
                Enable
              </UiButton>
            </div>
          </div>
        </div>

        <div class="space-y-3 md:text-right">
          <div class="flex flex-wrap gap-x-6 gap-y-2 md:justify-end">
            <div>
              <p class="eyebrow">Rate limit</p>
              <p class="tnum font-mono text-sm text-ink">
                {{ endpoint.rateLimitPerMinute }}
                <span class="font-sans text-xs text-muted">/ min</span>
              </p>
            </div>
            <div>
              <p class="eyebrow">Failures in a row</p>
              <p
                class="tnum font-mono text-sm"
                :class="endpoint.consecutiveFailures > 0 ? 'text-fail' : 'text-ink'"
              >
                {{ endpoint.consecutiveFailures }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap gap-1.5 md:justify-end">
            <UiButton size="sm" variant="quiet" @click="openEdit(endpoint)">Edit</UiButton>
            <UiButton
              size="sm"
              variant="quiet"
              :loading="isBusy(endpoint, 'test')"
              @click="sendTest(endpoint)"
            >
              Send test event
            </UiButton>
            <UiButton
              v-if="isOwner"
              size="sm"
              variant="quiet"
              :loading="isBusy(endpoint, 'rotate')"
              @click="rotateSecret(endpoint)"
            >
              Rotate secret
            </UiButton>
            <UiButton
              v-if="endpoint.status === 'ACTIVE'"
              size="sm"
              variant="quiet"
              :loading="isBusy(endpoint, 'disable')"
              @click="disableEndpoint(endpoint)"
            >
              Disable
            </UiButton>
            <UiButton
              v-else
              size="sm"
              variant="quiet"
              :loading="isBusy(endpoint, 'enable')"
              @click="enableEndpoint(endpoint)"
            >
              Enable
            </UiButton>
            <UiButton v-if="isOwner" size="sm" variant="quiet" @click="deleteTarget = endpoint">
              Delete
            </UiButton>
          </div>
        </div>
      </li>
    </ul>

    <EndpointFormDialog
      v-if="formOpen"
      :project-id="projectId"
      :endpoint="formTarget"
      @close="closeForm"
      @created="onCreated"
      @updated="onUpdated"
    />

    <SecretRevealDialog
      v-if="secretReveal"
      kind="endpoint-secret"
      :mode="secretReveal.mode"
      :secret="secretReveal.secret"
      :previous-secret-expires-at="secretReveal.previousSecretExpiresAt"
      :label="secretReveal.endpointLabel"
      @acknowledge="secretReveal = null"
    />

    <ConfirmDialog
      v-if="deleteTarget"
      eyebrow="Delete endpoint"
      :title="`Delete ${labelFor(deleteTarget)}?`"
      confirm-label="Delete endpoint"
      cancel-label="Keep it"
      variant="danger"
      :pending="deleting"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    >
      <p class="max-w-prose text-sm text-ink">
        <span class="font-mono break-all">{{ deleteTarget.url }}</span>
        is removed from this project and stops receiving events. Its signing secret is destroyed
        with it.
      </p>
      <p class="mt-2 max-w-prose text-sm text-muted">
        An endpoint that has ever been delivered to cannot be deleted — the API refuses it to keep
        the audit trail. Disable it instead when that happens.
      </p>
    </ConfirmDialog>
  </div>
</template>
