<script setup>
import { computed, ref, useId, watch } from 'vue';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { describeApiError } from '../lib/api-error-message.js';
import SectionFrame from './SectionFrame.vue';
import UiButton from './ui/UiButton.vue';

const URL_MAX = 2048;

// The SSRF guard has no machine-readable reason code; the only way to reach the
// reason is to strip this prefix off the 422 detail string.
const SSRF_DETAIL_PREFIX = 'The URL is not an allowed alert target: ';

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

const urlId = useId();

const url = ref('');
const saving = ref(false);
const fieldError = ref('');
const errorMessage = ref('');
const saved = ref(false);

const project = computed(() => auth.projects.find((item) => item.id === props.projectId) ?? null);

const current = computed(() => project.value?.alertWebhookUrl ?? '');

const trimmed = computed(() => url.value.trim());

const changed = computed(() => trimmed.value !== current.value);

function urlProblem(value) {
  if (!value) {
    return '';
  }

  if (value.length > URL_MAX) {
    return `The URL is at most ${URL_MAX} characters.`;
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return 'That is not a URL. Include the scheme, for example https://ops.example.com/alerts.';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Only http and https are allowed, not ${parsed.protocol.replace(':', '')}.`;
  }

  return '';
}

function applyServerError(caught) {
  const detail = caught?.detail ?? '';

  if (caught?.status === 422 && detail.startsWith(SSRF_DETAIL_PREFIX)) {
    fieldError.value = detail.slice(SSRF_DETAIL_PREFIX.length);

    return;
  }

  if (caught?.kind === 'validation-failed') {
    const reported = caught.fieldErrors().alertWebhookUrl;

    if (reported) {
      fieldError.value = reported;

      return;
    }
  }

  errorMessage.value = describeApiError(caught, {
    403: 'Only an owner can change the alert address.',
    404: 'This project is no longer available to you.',
  });
}

async function save() {
  const problem = urlProblem(trimmed.value);

  fieldError.value = problem;
  errorMessage.value = '';
  saved.value = false;

  if (problem) {
    return;
  }

  saving.value = true;

  try {
    const updated = await api.patch(`/projects/${props.projectId}`, {
      alertWebhookUrl: trimmed.value || null,
    });

    auth.mergeProject(updated);
    saved.value = true;
  } catch (caught) {
    applyServerError(caught);
  } finally {
    saving.value = false;
  }
}

// Watching `project` would retrigger on this component's own successful write:
// save() merges the response into the membership list, which rebuilds the
// computed and would clear the confirmation it had just set.
watch(
  () => props.projectId,
  () => {
    url.value = current.value;
    saved.value = false;
    fieldError.value = '';
    errorMessage.value = '';
  },
  { immediate: true },
);
</script>

<template>
  <SectionFrame
    title="Alert address"
    description="Where this project is told about its own trouble. A POST lands here when an endpoint is disabled automatically after consecutive failures, when the dead letter queue crosses its threshold, and when a dependency becomes unreachable. The request is not signed and it is not retried."
  >
    <div v-if="!isOwner" class="space-y-1">
      <p class="font-mono text-sm break-all text-ink">{{ current || 'Not set' }}</p>
      <p class="text-xs text-faint">Only an owner can change the alert address.</p>
    </div>

    <form v-else class="flex max-w-xl flex-wrap items-end gap-3" @submit.prevent="save">
      <label class="flex min-w-0 flex-1 flex-col gap-1" :for="urlId">
        <span class="eyebrow">Webhook URL</span>
        <input
          :id="urlId"
          v-model="url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          :maxlength="URL_MAX"
          placeholder="https://ops.example.com/alerts"
          class="w-full min-w-0 rounded-md border bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-faint"
          :class="fieldError ? 'border-fail' : 'border-rule'"
          :aria-invalid="fieldError ? 'true' : undefined"
          :aria-describedby="`${urlId}-help`"
        />
      </label>

      <UiButton type="submit" :loading="saving" :disabled="!changed">Save address</UiButton>

      <p
        v-if="fieldError"
        :id="`${urlId}-help`"
        class="w-full max-w-prose text-xs text-fail"
        role="alert"
      >
        {{ fieldError }}
      </p>
      <p v-else :id="`${urlId}-help`" class="w-full max-w-prose text-xs text-muted">
        Leave it empty to send no alerts at all. Saving resolves this host and refuses private,
        loopback and blocked-port targets.
      </p>
    </form>

    <p v-if="errorMessage" role="alert" class="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
      {{ errorMessage }}
    </p>
    <p v-else-if="saved" role="status" class="text-sm text-ok">
      {{ current ? 'Alert address updated.' : 'Alert address cleared.' }}
    </p>
  </SectionFrame>
</template>
