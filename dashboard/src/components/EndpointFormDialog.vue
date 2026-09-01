<script setup>
import { computed, ref, useId } from 'vue';
import { describeApiError } from '../lib/api-error-message.js';
import ModalShell from './ModalShell.vue';
import FilterChip from './ui/FilterChip.vue';
import UiButton from './ui/UiButton.vue';
import { useEndpointsStore } from '../stores/endpoints.js';

const EVENT_TYPE_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const EVENT_TYPE_WILDCARD_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*\.\*$/;
const EVENT_TYPE_MAX_LENGTH = 64;
const EVENT_TYPE_MAX_ITEMS = 50;
const URL_MAX_LENGTH = 2048;
const DESCRIPTION_MAX_LENGTH = 500;
const RATE_LIMIT_MIN = 1;
const RATE_LIMIT_MAX = 60000;

// The SSRF guard has no machine-readable reason code; the only way to reach the
// reason is to strip this prefix off the 422 detail string.
const SSRF_DETAIL_PREFIX = 'The URL is not an allowed delivery target: ';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
  endpoint: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['close', 'created', 'updated']);

const endpoints = useEndpointsStore();

const urlId = useId();
const descriptionId = useId();
const eventTypesId = useId();
const rateLimitId = useId();

const url = ref(props.endpoint?.url ?? '');
const description = ref(props.endpoint?.description ?? '');
const eventTypes = ref([...(props.endpoint?.eventTypes ?? [])]);
const rateLimit = ref(String(props.endpoint?.rateLimitPerMinute ?? ''));
const draft = ref('');

const fieldErrors = ref({});
const draftError = ref('');
const formError = ref(null);
const submitting = ref(false);

const isEdit = computed(() => Boolean(props.endpoint));

const payload = computed(() => (isEdit.value ? buildPatch() : buildCreateBody()));

const hasChanges = computed(() => !isEdit.value || Object.keys(payload.value).length > 0);

function normalize(candidate) {
  return candidate.trim().toLowerCase();
}

function eventTypeProblem(candidate) {
  if (candidate === '*') {
    return 'A bare * is not accepted — an empty list already means all events.';
  }

  if (candidate.length > EVENT_TYPE_MAX_LENGTH) {
    return `An event type is at most ${EVENT_TYPE_MAX_LENGTH} characters.`;
  }

  if (!EVENT_TYPE_PATTERN.test(candidate) && !EVENT_TYPE_WILDCARD_PATTERN.test(candidate)) {
    return 'Use lowercase letters and digits separated by . _ or -, optionally ending in .* — for example order.created or order.*';
  }

  if (eventTypes.value.includes(candidate)) {
    return `${candidate} is already in the list.`;
  }

  if (eventTypes.value.length >= EVENT_TYPE_MAX_ITEMS) {
    return `An endpoint subscribes to at most ${EVENT_TYPE_MAX_ITEMS} event types.`;
  }

  return '';
}

function addFromDraft() {
  const candidates = draft.value.split(',').map(normalize).filter(Boolean);

  if (candidates.length === 0) {
    draft.value = '';
    draftError.value = '';

    return;
  }

  for (const [index, candidate] of candidates.entries()) {
    const problem = eventTypeProblem(candidate);

    if (problem) {
      draftError.value = problem;
      draft.value = candidates.slice(index).join(', ');

      return;
    }

    eventTypes.value = [...eventTypes.value, candidate];
  }

  draft.value = '';
  draftError.value = '';
}

function removeEventType(index) {
  eventTypes.value = eventTypes.value.filter((_, position) => position !== index);
  draftError.value = '';
}

function onDraftKeydown(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    addFromDraft();

    return;
  }

  if (event.key === 'Backspace' && draft.value === '' && eventTypes.value.length > 0) {
    event.preventDefault();
    removeEventType(eventTypes.value.length - 1);
  }
}

function urlProblem(value) {
  if (!value) {
    return 'Enter the URL deliveries should be sent to.';
  }

  if (value.length > URL_MAX_LENGTH) {
    return `The URL is at most ${URL_MAX_LENGTH} characters.`;
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    return 'That is not a URL. Include the scheme, for example https://api.example.com/hooks.';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Only http and https are allowed, not ${parsed.protocol.replace(':', '')}.`;
  }

  return '';
}

function rateLimitProblem(value) {
  if (!value) {
    return '';
  }

  if (!/^\d+$/.test(value)) {
    return 'Enter a whole number of deliveries per minute.';
  }

  const parsed = Number(value);

  if (parsed < RATE_LIMIT_MIN || parsed > RATE_LIMIT_MAX) {
    return `The rate limit is between ${RATE_LIMIT_MIN} and ${RATE_LIMIT_MAX} per minute.`;
  }

  return '';
}

function validate() {
  const errors = {};
  const urlIssue = urlProblem(url.value.trim());
  const rateIssue = rateLimitProblem(rateLimit.value.trim());

  if (urlIssue) {
    errors.url = urlIssue;
  }

  if (description.value.trim().length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `The description is at most ${DESCRIPTION_MAX_LENGTH} characters.`;
  }

  if (eventTypes.value.length > EVENT_TYPE_MAX_ITEMS) {
    errors.eventTypes = `An endpoint subscribes to at most ${EVENT_TYPE_MAX_ITEMS} event types.`;
  }

  if (rateIssue) {
    errors.rateLimitPerMinute = rateIssue;
  }

  return errors;
}

function buildCreateBody() {
  const body = { url: url.value.trim(), eventTypes: [...eventTypes.value] };
  const trimmedDescription = description.value.trim();
  const trimmedRate = rateLimit.value.trim();

  if (trimmedDescription) {
    body.description = trimmedDescription;
  }

  if (trimmedRate) {
    body.rateLimitPerMinute = Number(trimmedRate);
  }

  return body;
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildPatch() {
  const patch = {};
  const trimmedUrl = url.value.trim();
  const trimmedDescription = description.value.trim();
  const trimmedRate = rateLimit.value.trim();

  if (trimmedUrl !== props.endpoint.url) {
    patch.url = trimmedUrl;
  }

  if (trimmedDescription !== (props.endpoint.description ?? '')) {
    patch.description = trimmedDescription;
  }

  if (!sameList(eventTypes.value, props.endpoint.eventTypes ?? [])) {
    patch.eventTypes = [...eventTypes.value];
  }

  // A blank box cannot mean "no limit": the API has no way to unset
  // rateLimitPerMinute, so an emptied field leaves the stored value alone.
  if (trimmedRate && Number(trimmedRate) !== props.endpoint.rateLimitPerMinute) {
    patch.rateLimitPerMinute = Number(trimmedRate);
  }

  return patch;
}

function mapServerFieldErrors(raw) {
  const mapped = {};

  for (const [key, message] of Object.entries(raw)) {
    if (key === 'url' || key === 'description' || key === 'rateLimitPerMinute') {
      mapped[key] = message;
    }

    if (key === 'eventTypes') {
      mapped.eventTypes = message;
    } else if (key.startsWith('eventTypes.')) {
      const index = Number(key.slice('eventTypes.'.length));
      const item = eventTypes.value[index];

      mapped.eventTypes = item ? `${item}: ${message}` : message;
    }
  }

  return mapped;
}

function applyServerError(caught) {
  const detail = caught?.detail ?? '';

  if (caught?.status === 422 && detail.startsWith(SSRF_DETAIL_PREFIX)) {
    fieldErrors.value = { url: detail.slice(SSRF_DETAIL_PREFIX.length) };

    return;
  }

  if (caught?.kind === 'validation-failed') {
    const mapped = mapServerFieldErrors(caught.fieldErrors());

    if (Object.keys(mapped).length > 0) {
      fieldErrors.value = mapped;

      return;
    }
  }

  formError.value = {
    detail: describeApiError(caught) || 'The endpoint could not be saved.',
    requestId: caught?.requestId ?? '',
  };
}

async function submit() {
  addFromDraft();

  if (draftError.value) {
    return;
  }

  formError.value = null;

  const errors = validate();

  fieldErrors.value = errors;

  if (Object.keys(errors).length > 0) {
    return;
  }

  submitting.value = true;

  try {
    if (isEdit.value) {
      const updated = await endpoints.update(props.endpoint.id, payload.value);

      emit('updated', updated);

      return;
    }

    const created = await endpoints.create(props.projectId, payload.value);

    emit('created', created);
  } catch (caught) {
    applyServerError(caught);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ModalShell
    :eyebrow="isEdit ? 'Edit endpoint' : 'New endpoint'"
    :title="isEdit ? 'Change how this endpoint receives events' : 'Add a delivery endpoint'"
    size="lg"
    :dismissible="!submitting"
    @close="emit('close')"
  >
    <form id="endpoint-form" novalidate class="space-y-5" @submit.prevent="submit">
      <div>
        <label :for="urlId" class="block text-sm font-medium text-ink">Delivery URL</label>
        <input
          :id="urlId"
          v-model="url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://api.example.com/hooks/hook-tracker"
          class="mt-1 w-full rounded-md border bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-faint"
          :class="fieldErrors.url ? 'border-fail' : 'border-rule'"
          :aria-invalid="fieldErrors.url ? 'true' : undefined"
          :aria-describedby="`${urlId}-help`"
        />
        <p
          v-if="fieldErrors.url"
          :id="`${urlId}-help`"
          class="mt-1 max-w-prose text-xs text-fail"
          role="alert"
        >
          {{ fieldErrors.url }}
        </p>
        <p v-else :id="`${urlId}-help`" class="mt-1 max-w-prose text-xs text-muted">
          Saving resolves this host and refuses private, loopback and blocked-port targets.
        </p>
      </div>

      <div>
        <label :for="descriptionId" class="block text-sm font-medium text-ink">
          Description
          <span class="font-normal text-faint">optional</span>
        </label>
        <input
          :id="descriptionId"
          v-model="description"
          type="text"
          :maxlength="DESCRIPTION_MAX_LENGTH"
          placeholder="Billing service, owned by the payments team"
          class="mt-1 w-full rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-faint"
          :class="fieldErrors.description ? 'border-fail' : 'border-rule'"
          :aria-invalid="fieldErrors.description ? 'true' : undefined"
        />
        <p v-if="fieldErrors.description" class="mt-1 text-xs text-fail" role="alert">
          {{ fieldErrors.description }}
        </p>
      </div>

      <div>
        <label :for="eventTypesId" class="block text-sm font-medium text-ink">Event types</label>
        <div
          class="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5"
          :class="fieldErrors.eventTypes || draftError ? 'border-fail' : 'border-rule'"
        >
          <FilterChip
            v-for="(type, index) in eventTypes"
            :key="type"
            variant="token"
            :value="type"
            :remove-label="`Remove ${type}`"
            @remove="removeEventType(index)"
          />

          <input
            :id="eventTypesId"
            v-model="draft"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="eventTypes.length === 0 ? 'order.created, order.*' : 'Add another'"
            class="min-w-[9rem] flex-1 bg-transparent py-0.5 font-mono text-sm text-ink placeholder:text-faint"
            :aria-describedby="`${eventTypesId}-help`"
            @keydown="onDraftKeydown"
            @blur="addFromDraft"
          />
        </div>

        <p v-if="draftError" class="mt-1 max-w-prose text-xs text-fail" role="alert">
          {{ draftError }}
        </p>
        <p v-if="fieldErrors.eventTypes" class="mt-1 max-w-prose text-xs text-fail" role="alert">
          {{ fieldErrors.eventTypes }}
        </p>
        <p :id="`${eventTypesId}-help`" class="mt-1 max-w-prose text-xs text-muted">
          Press Enter or comma to add one, Backspace to drop the last.
          <template v-if="eventTypes.length === 0">
            The list is empty, so this endpoint receives <strong class="text-ink">every</strong>
            event type the project ingests.
          </template>
          <template v-else>
            Only these {{ eventTypes.length }} of {{ EVENT_TYPE_MAX_ITEMS }} are delivered; clear
            the list to receive every event type instead.
          </template>
        </p>
      </div>

      <div>
        <label :for="rateLimitId" class="block text-sm font-medium text-ink">
          Rate limit
          <span class="font-normal text-faint">optional</span>
        </label>
        <div class="mt-1 flex items-center gap-2">
          <input
            :id="rateLimitId"
            v-model="rateLimit"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="600"
            class="tnum w-28 rounded-md border bg-surface px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-faint"
            :class="fieldErrors.rateLimitPerMinute ? 'border-fail' : 'border-rule'"
            :aria-invalid="fieldErrors.rateLimitPerMinute ? 'true' : undefined"
            :aria-describedby="`${rateLimitId}-help`"
          />
          <span class="text-sm text-muted">deliveries per minute</span>
        </div>
        <p
          v-if="fieldErrors.rateLimitPerMinute"
          :id="`${rateLimitId}-help`"
          class="mt-1 max-w-prose text-xs text-fail"
          role="alert"
        >
          {{ fieldErrors.rateLimitPerMinute }}
        </p>
        <p v-else :id="`${rateLimitId}-help`" class="mt-1 max-w-prose text-xs text-muted">
          {{ RATE_LIMIT_MIN }}–{{ RATE_LIMIT_MAX }}.
          <template v-if="isEdit">
            Leaving the box empty keeps the current limit — the API has no way to remove one.
          </template>
          <template v-else>Leave it empty to take the project default.</template>
        </p>
      </div>

      <div
        v-if="formError"
        class="rounded-md border border-rule bg-fail-soft px-3 py-3"
        role="alert"
      >
        <p class="max-w-prose text-sm text-ink">{{ formError.detail }}</p>
        <p v-if="formError.requestId" class="mt-1 text-xs text-faint">
          Request id
          <span class="font-mono break-all text-muted">{{ formError.requestId }}</span>
        </p>
      </div>
    </form>

    <template #footer>
      <p v-if="isEdit && !hasChanges" class="mr-auto text-xs text-muted">
        Nothing has changed yet. Only the fields you edit are sent.
      </p>

      <UiButton variant="quiet" :disabled="submitting" @click="emit('close')">Cancel</UiButton>
      <UiButton
        form="endpoint-form"
        type="submit"
        variant="primary"
        :loading="submitting"
        :disabled="!hasChanges"
      >
        {{ isEdit ? 'Save changes' : 'Create endpoint' }}
      </UiButton>
    </template>
  </ModalShell>
</template>
