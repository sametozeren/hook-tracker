<script setup>
import { nextTick, onMounted, ref } from 'vue';
import { api } from '../lib/api.js';
import { describeApiError } from '../lib/api-error-message.js';
import UiButton from './ui/UiButton.vue';

const MAX_NAME_LENGTH = 120;

const props = defineProps({
  submitLabel: {
    type: String,
    default: 'Create project',
  },
  autofocus: {
    type: Boolean,
    default: true,
  },
  showCancel: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['created', 'cancel']);

const name = ref('');
const pending = ref(false);
const errorMessage = ref('');
const fieldError = ref('');
const input = ref(null);

function validate() {
  const trimmed = name.value.trim();

  if (trimmed.length === 0) {
    fieldError.value = 'Give the project a name.';

    return null;
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    fieldError.value = `Use at most ${MAX_NAME_LENGTH} characters.`;

    return null;
  }

  fieldError.value = '';

  return trimmed;
}

async function submit() {
  const trimmed = validate();

  if (trimmed === null || pending.value) {
    return;
  }

  pending.value = true;
  errorMessage.value = '';

  try {
    const project = await api.post('/projects', { name: trimmed });

    emit('created', project);
  } catch (caught) {
    const fields = caught.fieldErrors?.() ?? {};

    fieldError.value = fields.name ?? '';
    errorMessage.value = fields.name ? '' : describeApiError(caught);

    await nextTick();
    input.value?.focus();
  } finally {
    pending.value = false;
  }
}

onMounted(() => {
  if (props.autofocus) {
    input.value?.focus();
  }
});
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <div class="flex flex-col gap-1.5">
      <label for="project-name" class="text-sm font-medium text-ink">Project name</label>
      <input
        id="project-name"
        ref="input"
        v-model="name"
        type="text"
        :maxlength="MAX_NAME_LENGTH"
        autocomplete="organization"
        :aria-invalid="fieldError ? 'true' : undefined"
        :aria-describedby="fieldError ? 'project-name-error' : 'project-name-hint'"
        class="rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
        placeholder="Acme Production"
      />
      <p v-if="fieldError" id="project-name-error" class="text-xs text-fail">{{ fieldError }}</p>
      <p v-else id="project-name-hint" class="text-xs text-muted">
        Names do not have to be unique; you can rename it later.
      </p>
    </div>

    <p v-if="errorMessage" role="alert" class="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
      {{ errorMessage }}
    </p>

    <div class="flex flex-wrap gap-2">
      <UiButton type="submit" variant="primary" :loading="pending">{{ submitLabel }}</UiButton>
      <UiButton v-if="showCancel" variant="quiet" @click="emit('cancel')">Cancel</UiButton>
    </div>
  </form>
</template>
