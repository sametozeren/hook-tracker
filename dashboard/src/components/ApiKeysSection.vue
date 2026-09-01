<script setup>
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';
import { useApiAction, useManagedList } from '../composables/use-managed-list.js';
import { describeApiError } from '../lib/api-error-message.js';
import ConfirmDialog from './ConfirmDialog.vue';
import SecretRevealDialog from './SecretRevealDialog.vue';
import SectionFrame from './SectionFrame.vue';
import SettingsTable from './SettingsTable.vue';
import EmptyState from './ui/EmptyState.vue';
import ErrorState from './ui/ErrorState.vue';
import RelativeTime from './ui/RelativeTime.vue';
import SkeletonRows from './ui/SkeletonRows.vue';
import UiButton from './ui/UiButton.vue';

const NAME_MAX = 120;

const CREATE_ERRORS = {
  403: 'Only an owner can create API keys.',
};

const REVOKE_ERRORS = {
  403: 'Only an owner can revoke API keys.',
  404: 'That key no longer exists.',
};

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
  isOwner: {
    type: Boolean,
    default: false,
  },
});

const {
  rows: apiKeys,
  loading,
  loadError,
  load,
  target: revokeTarget,
  ask: askRevoke,
  cancel: cancelRevoke,
  pending: revoking,
  actionError: revokeError,
  confirm: runRevoke,
} = useManagedList({
  projectId: () => props.projectId,
  resource: 'api-keys',
  collection: 'apiKeys',
  errors: REVOKE_ERRORS,
});

const { pending: creating, error: createError, run: runCreate } = useApiAction(CREATE_ERRORS);

const newKeyName = ref('');
const revealedKey = ref(null);

const columns = computed(() => [
  { key: 'name', label: 'Name', width: 'minmax(0,1.2fr)' },
  { key: 'prefix', label: 'Prefix', width: '9rem' },
  { key: 'created', label: 'Created', width: '7rem' },
  { key: 'lastUsed', label: 'Last used', width: '7rem' },
  ...(props.isOwner
    ? [{ key: 'actions', label: 'Actions', width: '6rem', align: 'end', hideLabel: true }]
    : []),
]);

function createKey() {
  const name = newKeyName.value.trim();

  if (name.length === 0 || name.length > NAME_MAX) {
    createError.value = `A key name is 1 to ${NAME_MAX} characters.`;

    return undefined;
  }

  return runCreate(async () => {
    const created = await api.post(`/projects/${props.projectId}/api-keys`, { name });

    newKeyName.value = '';
    revealedKey.value = created;
    await load();
  });
}

// The plaintext key exists only in this component's state and is dropped the
// moment the operator acknowledges the modal; it is never written to a store.
function dismissRevealedKey() {
  revealedKey.value = null;
}

function confirmRevoke() {
  return runRevoke(async (key) => {
    // This DELETE answers 200 with the revoked key view, unlike the other
    // DELETE routes, so the row is replaced rather than removed.
    const revoked = await api.delete(`/projects/${props.projectId}/api-keys/${key.id}`);

    apiKeys.value = apiKeys.value.map((row) => (row.id === revoked.id ? revoked : row));
  });
}
</script>

<template>
  <SectionFrame
    title="API keys"
    description="Keys authenticate publishers against POST /v1/publish. Only the prefix is stored in readable form, so a key's full value is shown once, when it is created."
  >
    <SkeletonRows v-if="loading" :rows="3" :columns="['25%', '20%', '18%', '18%']" />

    <ErrorState
      v-else-if="loadError"
      title="The API keys failed to load."
      :detail="describeApiError(loadError)"
      :request-id="loadError.requestId || ''"
      @retry="load"
    />

    <EmptyState
      v-else-if="apiKeys.length === 0"
      title="No API keys yet."
      :description="
        isOwner
          ? 'Create a key below, then use it to publish your first event.'
          : 'An owner has to create the first key for this project.'
      "
    />

    <SettingsTable v-else :columns="columns" :rows="apiKeys">
      <template #name="{ row }">
        <span class="flex min-w-0 items-center gap-2 max-md:justify-end">
          <span class="min-w-0 truncate text-sm text-ink">{{ row.name }}</span>
          <span
            v-if="row.revokedAt"
            class="shrink-0 rounded-full bg-skip-soft px-1.5 py-px text-[10px] font-medium text-skip"
          >
            Revoked
          </span>
        </span>
      </template>

      <template #prefix="{ row }">
        <span class="block truncate font-mono text-xs text-muted">{{ row.keyPrefix }}…</span>
      </template>

      <template #created="{ row }">
        <RelativeTime :value="row.createdAt" />
      </template>

      <template #lastUsed="{ row }">
        <RelativeTime v-if="row.lastUsedAt" :value="row.lastUsedAt" />
        <span v-else class="font-mono text-xs text-faint">Never used</span>
      </template>

      <template #actions="{ row }">
        <UiButton v-if="!row.revokedAt" variant="quiet" size="sm" @click="askRevoke(row)">
          Revoke
        </UiButton>
        <span v-else class="font-mono text-[11px] text-faint">
          revoked <RelativeTime :value="row.revokedAt" />
        </span>
      </template>
    </SettingsTable>

    <form
      v-if="isOwner"
      class="flex max-w-2xl flex-wrap items-end gap-3"
      @submit.prevent="createKey"
    >
      <label class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="eyebrow"> New key name </span>
        <input
          v-model="newKeyName"
          type="text"
          :maxlength="NAME_MAX"
          placeholder="checkout-service"
          class="w-full min-w-0 rounded-md border border-rule bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-faint"
        />
      </label>

      <UiButton type="submit" :loading="creating">Create key</UiButton>
    </form>

    <p
      v-if="createError"
      role="alert"
      class="max-w-prose rounded-md bg-fail-soft px-3 py-2 text-sm text-fail"
    >
      {{ createError }}
    </p>

    <SecretRevealDialog
      v-if="revealedKey"
      kind="api-key"
      :secret="revealedKey.key"
      :label="revealedKey.name"
      @acknowledge="dismissRevealedKey"
    />

    <ConfirmDialog
      v-if="revokeTarget"
      :title="`Revoke ${revokeTarget.name}?`"
      confirm-label="Revoke key"
      :pending="revoking"
      :error="revokeError"
      @close="cancelRevoke"
      @confirm="confirmRevoke"
    >
      <p class="text-sm text-ink">
        Any publisher still sending
        <span class="font-mono break-all">{{ revokeTarget.keyPrefix }}…</span>
        starts getting 401 on the next request. This cannot be undone — a replacement has to be
        created and deployed.
      </p>
    </ConfirmDialog>
  </SectionFrame>
</template>
