<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { describeApiError } from '../lib/api-error-message.js';
import ConfirmDialog from './ConfirmDialog.vue';
import SectionFrame from './SectionFrame.vue';
import SettingsTable from './SettingsTable.vue';
import EmptyState from './ui/EmptyState.vue';
import ErrorState from './ui/ErrorState.vue';
import RelativeTime from './ui/RelativeTime.vue';
import SkeletonRows from './ui/SkeletonRows.vue';
import UiButton from './ui/UiButton.vue';

const ADD_ERRORS = {
  403: 'Only an owner can add members.',
  409: 'That person is already a member of this project.',
  422: 'No account with that email exists yet. hook-tracker v1 has no invite flow, so ask them to register first, then add them here.',
};

const REMOVE_ERRORS = {
  403: 'Only an owner can remove members.',
  404: 'That person is no longer a member of this project.',
  409: 'This is the last owner. Promote another member to owner first, then remove this one.',
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

const auth = useAuthStore();
const router = useRouter();

const members = ref([]);
const loading = ref(false);
const loadError = ref(null);

const invite = ref({ email: '', role: 'MEMBER' });
const adding = ref(false);
const addError = ref('');
const addNotice = ref('');

const removeTarget = ref(null);
const removing = ref(false);
const removeError = ref('');

let sequence = 0;

const columns = computed(() => [
  { key: 'name', label: 'Name', width: 'minmax(0,1.1fr)' },
  { key: 'email', label: 'Email', width: 'minmax(0,1.5fr)' },
  { key: 'role', label: 'Role', width: '5.5rem' },
  { key: 'joined', label: 'Joined', width: '7rem' },
  ...(props.isOwner
    ? [{ key: 'actions', label: 'Actions', width: '6rem', align: 'end', hideLabel: true }]
    : []),
]);

const removingSelf = computed(() => removeTarget.value?.userId === auth.user?.id);

async function load() {
  const current = ++sequence;

  loading.value = true;
  loadError.value = null;

  try {
    const body = await api.get(`/projects/${props.projectId}/members`);

    if (current === sequence) {
      members.value = body.members;
    }
  } catch (caught) {
    if (current === sequence) {
      loadError.value = caught;
      members.value = [];
    }
  } finally {
    if (current === sequence) {
      loading.value = false;
    }
  }
}

async function addMember() {
  const email = invite.value.email.trim();

  if (email.length === 0) {
    addError.value = 'Enter the email address of a registered account.';

    return;
  }

  adding.value = true;
  addError.value = '';
  addNotice.value = '';

  try {
    const added = await api.post(`/projects/${props.projectId}/members`, {
      email,
      role: invite.value.role,
    });

    invite.value = { email: '', role: 'MEMBER' };
    addNotice.value = `${added.email} was added as ${added.role.toLowerCase()}.`;
    await load();
  } catch (caught) {
    addError.value = describeApiError(caught, ADD_ERRORS);
  } finally {
    adding.value = false;
  }
}

function askRemove(member) {
  removeTarget.value = member;
  removeError.value = '';
}

function cancelRemove() {
  removeTarget.value = null;
  removeError.value = '';
}

async function confirmRemove() {
  const member = removeTarget.value;

  removing.value = true;
  removeError.value = '';

  try {
    await api.delete(`/projects/${props.projectId}/members/${member.userId}`);

    if (member.userId === auth.user?.id) {
      await auth.loadMe();
      removeTarget.value = null;
      router.push({ name: 'home' });

      return;
    }

    removeTarget.value = null;
    await load();
  } catch (caught) {
    removeError.value = describeApiError(caught, REMOVE_ERRORS);
  } finally {
    removing.value = false;
  }
}

watch(() => props.projectId, load, { immediate: true });
</script>

<template>
  <SectionFrame
    title="Members"
    description="Everyone who can sign in to this project. Owners can rename the project, manage members and manage API keys; members can do everything else."
  >
    <SkeletonRows v-if="loading" :rows="3" :columns="['25%', '35%', '15%', '20%']" />

    <ErrorState
      v-else-if="loadError"
      title="The member list failed to load."
      :detail="describeApiError(loadError)"
      :request-id="loadError.requestId || ''"
      @retry="load"
    />

    <EmptyState
      v-else-if="members.length === 0"
      title="No members."
      description="This project has no members the API will report. Add one by email below."
    />

    <SettingsTable v-else :columns="columns" :rows="members" row-key="userId">
      <template #name="{ row }">
        <span class="flex min-w-0 items-center gap-2 max-md:justify-end">
          <span class="min-w-0 truncate text-sm text-ink">{{ row.name }}</span>
          <span
            v-if="row.userId === auth.user?.id"
            class="shrink-0 rounded-full bg-sunken px-1.5 py-px text-[10px] font-medium text-muted"
          >
            You
          </span>
        </span>
      </template>

      <template #email="{ row }">
        <span class="block min-w-0 truncate font-mono text-xs text-muted">{{ row.email }}</span>
      </template>

      <template #role="{ row }">
        <span class="block font-mono text-[11px] tracking-wider text-muted">{{ row.role }}</span>
      </template>

      <template #joined="{ row }">
        <RelativeTime :value="row.joinedAt" />
      </template>

      <template #actions="{ row }">
        <UiButton variant="quiet" size="sm" @click="askRemove(row)">Remove</UiButton>
      </template>
    </SettingsTable>

    <form
      v-if="isOwner"
      class="flex max-w-2xl flex-wrap items-end gap-3"
      @submit.prevent="addMember"
    >
      <label class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="eyebrow"> Add by email </span>
        <input
          v-model="invite.email"
          type="email"
          autocomplete="off"
          placeholder="teammate@example.com"
          class="w-full min-w-0 rounded-md border border-rule bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-faint"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="eyebrow">Role</span>
        <select
          v-model="invite.role"
          class="rounded-md border border-rule bg-surface px-2.5 py-1.5 text-sm text-ink"
        >
          <option value="MEMBER">Member</option>
          <option value="OWNER">Owner</option>
        </select>
      </label>

      <UiButton type="submit" :loading="adding">Add member</UiButton>
    </form>

    <p
      v-if="addError"
      role="alert"
      class="max-w-prose rounded-md bg-fail-soft px-3 py-2 text-sm text-fail"
    >
      {{ addError }}
    </p>
    <p v-else-if="addNotice" role="status" class="text-sm text-ok">{{ addNotice }}</p>

    <ConfirmDialog
      v-if="removeTarget"
      :title="removingSelf ? 'Remove yourself from this project?' : `Remove ${removeTarget.name}?`"
      confirm-label="Remove"
      :pending="removing"
      :error="removeError"
      @close="cancelRemove"
      @confirm="confirmRemove"
    >
      <p v-if="removingSelf" class="text-sm text-ink">
        You lose access to this project immediately, including its deliveries, endpoints and API
        keys. Another owner has to add you back.
      </p>
      <p v-else class="text-sm text-ink">
        <span class="font-mono break-all">{{ removeTarget.email }}</span>
        loses access to this project immediately. The project's endpoints, API keys and delivery
        history are not affected.
      </p>
    </ConfirmDialog>
  </SectionFrame>
</template>
