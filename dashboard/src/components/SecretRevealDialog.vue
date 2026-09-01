<script setup>
import { computed, ref } from 'vue';
import { apiOrigin, buildCurl } from '../lib/curl.js';
import CopyButton from './ui/CopyButton.vue';
import ModalShell from './ModalShell.vue';
import UiButton from './ui/UiButton.vue';
import { formatAbsoluteUtc, toTimestamp } from './ui/time.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const props = defineProps({
  kind: {
    type: String,
    default: 'endpoint-secret',
    validator: (value) => ['endpoint-secret', 'api-key'].includes(value),
  },
  mode: {
    type: String,
    default: 'created',
    validator: (value) => ['created', 'rotated'].includes(value),
  },
  secret: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  previousSecretExpiresAt: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['acknowledge']);

const openedAt = ref(Date.now());

const isApiKey = computed(() => props.kind === 'api-key');

const isRotation = computed(() => props.mode === 'rotated');

const eyebrow = computed(() => (isApiKey.value ? 'API key' : 'Signing secret'));

const title = computed(() => {
  if (isApiKey.value) {
    return 'Copy this key now';
  }

  return isRotation.value ? 'The signing secret has been rotated' : 'Copy the signing secret now';
});

const copyLabel = computed(() => (isApiKey.value ? 'Copy key' : 'Copy secret'));

const curlCommand = computed(() =>
  buildCurl(
    `${apiOrigin()}/v1/publish`,
    [
      ['Authorization', `Bearer ${props.secret}`],
      ['Content-Type', 'application/json'],
    ],
    '{"eventType":"order.created","payload":{"orderId":"1001"}}',
  ),
);

const graceAbsolute = computed(() => formatAbsoluteUtc(props.previousSecretExpiresAt));

const graceRelative = computed(() => {
  const timestamp = toTimestamp(props.previousSecretExpiresAt);

  if (timestamp === null) {
    return '';
  }

  const remaining = timestamp - openedAt.value;

  if (remaining <= 0) {
    return 'already past';
  }

  if (remaining >= HOUR_MS) {
    const hours = Math.floor(remaining / HOUR_MS);

    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const minutes = Math.max(1, Math.round(remaining / MINUTE_MS));

  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
});
</script>

<template>
  <ModalShell
    :eyebrow="eyebrow"
    :title="title"
    :dismissible="false"
    size="lg"
    @close="emit('acknowledge')"
  >
    <div class="space-y-4 text-sm">
      <p v-if="isApiKey" class="max-w-prose text-muted">
        This is the only time hook-tracker will show the full value of
        <span class="font-mono break-all text-ink">{{ label }}</span
        >.
      </p>
      <p v-else class="max-w-prose text-muted">
        For
        <span class="font-mono break-all text-ink">{{ label }}</span
        >. Store it in the receiving service now — it verifies the signature on every delivery.
      </p>

      <div class="rounded-md border border-rule bg-sunken p-3">
        <div class="overflow-x-auto">
          <code class="tnum font-mono text-sm break-all whitespace-pre-wrap text-ink">{{
            secret
          }}</code>
        </div>
        <div class="mt-2 flex justify-end">
          <CopyButton :text="secret" :label="copyLabel" />
        </div>
      </div>

      <p v-if="isApiKey" class="max-w-prose text-muted">
        This value is shown once and is never shown again. It is stored hashed, so nothing in the
        dashboard or the API can retrieve it later — if it is lost, revoke this key and create a new
        one.
      </p>
      <p v-else class="max-w-prose text-muted">
        This value is shown once and is never shown again. Nothing in the dashboard or the API can
        retrieve it later — if it is lost, the only way forward is to rotate the secret, which
        generates a different value and starts a new grace window.
      </p>

      <div v-if="isRotation" class="rounded-md border border-rule bg-retry-soft px-3 py-3">
        <p class="eyebrow">Grace window</p>
        <p class="mt-1 max-w-prose text-ink">
          Until
          <span class="tnum font-mono">{{ graceAbsolute }}</span>
          (<span class="tnum font-mono">{{ graceRelative }}</span
          >) every delivery carries both signatures: the previous secret and this new one.
        </p>
        <p class="mt-2 max-w-prose text-muted">
          That timestamp is the deadline. The receiver must accept this new secret before it passes;
          afterwards the previous secret stops validating and any receiver still checking against it
          rejects every delivery.
        </p>
      </div>

      <div v-else-if="isApiKey">
        <p class="eyebrow">Publish your first event</p>
        <div class="mt-1 flex flex-wrap items-start gap-2">
          <pre
            class="min-w-0 flex-1 overflow-x-auto rounded-md border border-rule bg-sunken px-3 py-2 font-mono text-xs text-ink"
          ><code>{{ curlCommand }}</code></pre>
          <CopyButton :text="curlCommand" label="Copy curl" />
        </div>
      </div>

      <p v-else class="max-w-prose text-muted">
        Deliveries to this endpoint are signed with this secret from the first event onwards.
      </p>
    </div>

    <template #footer>
      <UiButton variant="primary" @click="emit('acknowledge')">I have copied it</UiButton>
    </template>
  </ModalShell>
</template>
