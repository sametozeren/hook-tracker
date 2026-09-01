<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { describeApiError } from '../lib/api-error-message.js';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EndpointRow from '../components/EndpointRow.vue';
import NoticeBanner from '../components/NoticeBanner.vue';
import SectionFrame from '../components/SectionFrame.vue';
import EndpointFormDialog from '../components/EndpointFormDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import ErrorState from '../components/ui/ErrorState.vue';
import SecretRevealDialog from '../components/SecretRevealDialog.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import UiButton from '../components/ui/UiButton.vue';
import { useAuthStore } from '../stores/auth.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { useRealtimeStore } from '../stores/realtime.js';

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

const noticeAction = computed(() => {
  const endpoint = notice.value?.disable;

  if (!endpoint) {
    return null;
  }

  return {
    label: `Disable ${labelFor(endpoint)}`,
    loading: busyActionFor(endpoint) === 'disable',
  };
});

function labelFor(endpoint) {
  return endpoints.displayName(endpoint.id);
}

function busyActionFor(endpoint) {
  return busy.value.id === endpoint.id ? busy.value.action : '';
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

    <NoticeBanner
      :notice="notice"
      :action="noticeAction"
      @dismiss="notice = null"
      @action="disableEndpoint(notice.disable)"
    />

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
      <EndpointRow
        v-for="endpoint in rows"
        :key="endpoint.id"
        :endpoint="endpoint"
        :is-owner="isOwner"
        :busy-action="busyActionFor(endpoint)"
        @edit="openEdit(endpoint)"
        @test="sendTest(endpoint)"
        @rotate="rotateSecret(endpoint)"
        @disable="disableEndpoint(endpoint)"
        @enable="enableEndpoint(endpoint)"
        @delete="deleteTarget = endpoint"
      />
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
