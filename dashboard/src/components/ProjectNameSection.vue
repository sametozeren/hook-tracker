<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { describeApiError } from '../lib/api-error-message.js';
import SectionFrame from './SectionFrame.vue';
import UiButton from './ui/UiButton.vue';

const NAME_MAX = 120;

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

const name = ref('');
const saving = ref(false);
const errorMessage = ref('');
const saved = ref(false);

const project = computed(() => auth.projects.find((item) => item.id === props.projectId) ?? null);

const trimmed = computed(() => name.value.trim());

const changed = computed(() => trimmed.value !== (project.value?.name ?? ''));

async function save() {
  if (trimmed.value.length === 0 || trimmed.value.length > NAME_MAX) {
    errorMessage.value = `A project name is 1 to ${NAME_MAX} characters.`;

    return;
  }

  saving.value = true;
  errorMessage.value = '';
  saved.value = false;

  try {
    await api.patch(`/projects/${props.projectId}`, { name: trimmed.value });

    // The project switcher in the shell reads from the membership list, so the
    // rename is not visible anywhere else until /auth/me is re-read.
    await auth.loadMe();
    saved.value = true;
  } catch (caught) {
    errorMessage.value = describeApiError(caught, {
      403: 'Only an owner can rename this project.',
      404: 'This project is no longer available to you.',
    });
  } finally {
    saving.value = false;
  }
}

// Watching `project` would retrigger on this component's own successful write:
// save() reloads the membership list, which rebuilds the computed and would
// clear the confirmation it had just set.
watch(
  () => props.projectId,
  () => {
    name.value = project.value?.name ?? '';
    saved.value = false;
    errorMessage.value = '';
  },
  { immediate: true },
);
</script>

<template>
  <SectionFrame
    title="Project"
    description="The name shown in the project switcher and on every screen of this dashboard."
  >
    <div v-if="!isOwner" class="space-y-1">
      <p class="text-sm text-ink">{{ project?.name ?? '—' }}</p>
      <p class="text-xs text-faint">Only an owner can rename this project.</p>
    </div>

    <form v-else class="flex max-w-xl flex-wrap items-end gap-3" @submit.prevent="save">
      <label class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="eyebrow">Name</span>
        <input
          v-model="name"
          type="text"
          :maxlength="NAME_MAX"
          required
          class="w-full min-w-0 rounded-md border border-rule bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-faint"
        />
      </label>

      <UiButton type="submit" :loading="saving" :disabled="!changed">Save name</UiButton>
    </form>

    <p v-if="errorMessage" role="alert" class="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
      {{ errorMessage }}
    </p>
    <p v-else-if="saved" role="status" class="text-sm text-ok">Name updated.</p>
  </SectionFrame>
</template>
