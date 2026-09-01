<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { DETAIL_OVERLAY } from '../components/DetailOverlay.vue';
import { useSequencedRequest } from '../composables/use-sequenced-request.js';
import { useDeliveriesStore } from '../stores/deliveries.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { describeApiError } from '../lib/api-error-message.js';
import { buildCurl } from '../lib/curl.js';
import { formatAbsoluteUtc, toTimestamp } from '../components/ui/time.js';
import AttemptLadder from '../components/ui/AttemptLadder.vue';
import CopyButton from '../components/ui/CopyButton.vue';
import ErrorState from '../components/ui/ErrorState.vue';
import JsonBlock from '../components/ui/JsonBlock.vue';
import ResponseCode from '../components/ui/ResponseCode.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import StatusPill from '../components/ui/StatusPill.vue';
import UiButton from '../components/ui/UiButton.vue';

const IN_PROGRESS = new Set(['PENDING', 'IN_FLIGHT']);

const REPLAY_BLOCKED_TITLE =
  'This delivery is still queued or in flight. Replaying it now would send the same event twice, because the server does not refuse a replay of a delivery that has not settled.';

const SIGNATURE_PLACEHOLDER = 'v1=<regenerate with the endpoint secret>';

const TIMESTAMP_PLACEHOLDER = '<unix seconds at the time you sign>';

const OUTCOME_TONE = {
  ok: 'border-ok',
  warning: 'border-retry',
  error: 'border-fail',
};

const SHELL_CLASS = {
  overlay: 'min-h-full',
  column: 'rounded-lg border border-rule lg:sticky lg:top-20',
};

const HEADER_CLASS = {
  overlay: 'sticky top-0 z-10 bg-surface',
  column: '',
};

const route = useRoute();
const router = useRouter();
const deliveries = useDeliveriesStore();
const endpoints = useEndpointsStore();

const overlayFlag = inject(DETAIL_OVERLAY, null);

const detailRequest = useSequencedRequest();

const delivery = ref(null);
const loading = detailRequest.loading;
const error = detailRequest.error;
const replaying = ref(false);
const replayError = ref(null);
const replayed = ref(null);
const tick = ref(Date.now());

let countdownTimer = null;

const overlay = computed(() => overlayFlag?.value === true);

const deliveryId = computed(() => route.params.deliveryId);

const projectId = computed(() => route.params.projectId);

const listRoute = computed(() => ({
  name: 'deliveries',
  params: { projectId: projectId.value },
  query: route.query,
}));

const notFound = computed(() => error.value?.status === 404);

const attempts = computed(() => delivery.value?.attempts ?? []);

const newestAttempt = computed(() => attempts.value[attempts.value.length - 1] ?? null);

const responseHeaders = computed(() => Object.entries(newestAttempt.value?.responseHeaders ?? {}));

const endpointName = computed(() =>
  delivery.value ? endpoints.displayName(delivery.value.endpointId) : '',
);

const endpointUrl = computed(() =>
  delivery.value ? (endpoints.byId[delivery.value.endpointId]?.url ?? null) : null,
);

const replayBlocked = computed(() => IN_PROGRESS.has(delivery.value?.status));

const payloadBytes = computed(() => {
  if (!delivery.value) {
    return null;
  }

  return new TextEncoder().encode(JSON.stringify(delivery.value.payload)).length;
});

function outcomeFor(attempt) {
  const status = attempt.responseStatus;

  if (status !== null && status !== undefined && status >= 200 && status < 300) {
    return 'ok';
  }

  if (status === 429) {
    return 'warning';
  }

  return 'error';
}

const outcomes = computed(() => {
  const list = [];

  for (const attempt of attempts.value) {
    list[attempt.attemptNumber - 1] = outcomeFor(attempt);
  }

  return Array.from(list, (outcome) => outcome ?? 'error');
});

const countdown = computed(() => {
  const target = toTimestamp(delivery.value?.nextAttemptAt);

  if (target === null) {
    return '';
  }

  const remaining = target - tick.value;

  if (remaining <= 0) {
    return 'due now';
  }

  const seconds = Math.floor(remaining / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `in ${hours} h ${minutes} min`;
  }

  if (minutes > 0) {
    return `in ${minutes} min ${seconds % 60} s`;
  }

  return `in ${seconds} s`;
});

// The order and the set match what the worker signs and sends; the signature is
// computed over "<timestamp>.<raw body>", so the timestamp header is part of the
// scheme rather than metadata and cannot be left out of either view.
const requestHeaders = computed(() => {
  const current = delivery.value;

  if (!current) {
    return [];
  }

  return [
    ['content-type', 'application/json'],
    ['user-agent', 'HookTracker/1.0'],
    ['x-webhook-id', current.id],
    ['x-webhook-event', current.eventType ?? ''],
    ['x-webhook-attempt', String(current.attemptCount)],
    ['x-webhook-timestamp', TIMESTAMP_PLACEHOLDER],
    ['x-webhook-signature', SIGNATURE_PLACEHOLDER],
  ];
});

const curlCommand = computed(() => {
  const current = delivery.value;

  if (!current) {
    return '';
  }

  const url = endpointUrl.value ?? 'https://the-endpoint.example/webhooks';

  return buildCurl(url, requestHeaders.value, JSON.stringify(current.payload ?? {}));
});

function formatMs(value) {
  return value === null || value === undefined ? '—' : `${value.toLocaleString('en-US')} ms`;
}

function load(id) {
  replayed.value = null;
  replayError.value = null;

  return detailRequest.run(() => deliveries.fetchOne(id), {
    onSuccess(body) {
      delivery.value = body;
    },
    onError() {
      delivery.value = null;
    },
  });
}

function close() {
  router.push(listRoute.value);
}

async function replay() {
  replaying.value = true;
  replayError.value = null;

  try {
    replayed.value = await deliveries.replay(deliveryId.value);
  } catch (caught) {
    replayError.value = caught;
  } finally {
    replaying.value = false;
  }
}

watch(
  deliveryId,
  (id) => {
    if (id) {
      load(id);
    }
  },
  { immediate: true },
);

onMounted(() => {
  endpoints.load(projectId.value).catch(() => undefined);

  countdownTimer = setInterval(() => {
    tick.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => {
  clearInterval(countdownTimer);
});
</script>

<template>
  <section
    class="bg-surface"
    :class="overlay ? SHELL_CLASS.overlay : SHELL_CLASS.column"
    aria-label="Delivery detail"
  >
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-3"
      :class="overlay ? HEADER_CLASS.overlay : HEADER_CLASS.column"
    >
      <span class="font-mono text-xs break-all text-ink">{{ deliveryId }}</span>
      <StatusPill v-if="delivery" :status="delivery.status" size="sm" />
      <span v-if="delivery" class="min-w-0 truncate text-xs text-muted">
        {{ delivery.eventType }} · {{ endpointName }}
      </span>
      <span class="ml-auto flex flex-wrap items-center gap-2">
        <UiButton
          v-if="delivery"
          variant="primary"
          size="sm"
          :disabled="replayBlocked"
          :loading="replaying"
          :title="replayBlocked ? REPLAY_BLOCKED_TITLE : 'Send this event again as a new delivery'"
          @click="replay"
        >
          Replay
        </UiButton>
        <CopyButton v-if="delivery" :text="curlCommand" label="Copy as cURL" />
        <UiButton variant="quiet" size="sm" title="Close the delivery detail" @click="close">
          Close
        </UiButton>
      </span>
    </div>

    <div v-if="loading" class="px-4 py-4">
      <SkeletonRows :rows="6" :columns="['30%', '55%']" />
    </div>

    <div v-else-if="notFound" class="px-4 py-4">
      <ErrorState
        title="This delivery is not visible to this session."
        detail="It either does not exist or belongs to a project you are not a member of."
        @retry="load(deliveryId)"
      />
      <RouterLink :to="listRoute" class="mt-3 inline-block text-sm underline underline-offset-2">
        Back to the deliveries list
      </RouterLink>
    </div>

    <div v-else-if="error" class="px-4 py-4">
      <ErrorState
        title="The delivery could not be loaded."
        :detail="describeApiError(error)"
        :request-id="error.requestId"
        @retry="load(deliveryId)"
      />
    </div>

    <div v-else-if="delivery" class="space-y-5 px-4 py-4">
      <div>
        <p v-if="replayError" role="alert" class="text-sm text-fail">
          Replay failed: {{ describeApiError(replayError) }}
        </p>

        <p role="status" class="text-sm text-muted">
          <template v-if="replayed">
            Replayed as
            <RouterLink
              :to="{
                name: 'delivery',
                params: { projectId, deliveryId: replayed.id },
                query: route.query,
              }"
              class="font-mono text-ink underline underline-offset-2"
            >
              {{ replayed.id }}
            </RouterLink>
            . It starts at attempt 1.
          </template>
        </p>
      </div>

      <div v-if="delivery.nextAttemptAt">
        <p class="eyebrow">Next retry</p>
        <div class="mt-2 rounded-md border border-rule-soft bg-sunken px-3 py-2.5">
          <p class="tnum flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs">
            <span class="text-ink">{{ formatAbsoluteUtc(delivery.nextAttemptAt) }}</span>
            <span class="text-retry">{{ countdown }}</span>
          </p>
          <p class="mt-1.5 max-w-prose text-xs text-muted">
            If the last attempt also fails, the delivery moves to the dead-letter queue and stops on
            its own. Nothing further is sent until someone replays it.
          </p>
        </div>
      </div>

      <div>
        <p class="eyebrow">Attempts</p>
        <div class="mt-2">
          <AttemptLadder
            :attempt-count="delivery.attemptCount"
            :status="delivery.status"
            :outcomes="outcomes"
          />
        </div>

        <ol v-if="attempts.length > 0" class="mt-3 space-y-2.5">
          <li
            v-for="attempt in attempts"
            :key="attempt.id"
            class="grid grid-cols-[26px_minmax(0,1fr)] gap-x-3 border-l-2 pl-3"
            :class="OUTCOME_TONE[outcomeFor(attempt)]"
          >
            <span class="tnum font-mono text-xs text-faint">
              {{ String(attempt.attemptNumber).padStart(2, '0') }}
            </span>
            <div class="min-w-0">
              <p class="tnum flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs">
                <ResponseCode :status="attempt.responseStatus" :error-code="attempt.errorCode" />
                <span class="text-muted">{{ formatAbsoluteUtc(attempt.startedAt) }}</span>
                <span class="text-faint">{{ formatMs(attempt.durationMs) }}</span>
              </p>
              <div
                v-if="attempt.responseBodySnippet || attempt.errorMessage"
                class="mt-1 flex items-start gap-1.5"
              >
                <pre
                  class="min-w-0 flex-1 overflow-x-auto rounded-md bg-sunken px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted"
                ><code>{{ attempt.responseBodySnippet || attempt.errorMessage }}</code></pre>
                <CopyButton
                  :text="attempt.responseBodySnippet || attempt.errorMessage"
                  :title="`Copy what attempt ${attempt.attemptNumber} returned`"
                />
              </div>
            </div>
          </li>
        </ol>

        <p v-else class="mt-2 text-xs text-muted">No attempt has been made yet.</p>
      </div>

      <div v-if="requestHeaders.length > 0">
        <p class="eyebrow">Request headers</p>
        <p class="mt-1.5 max-w-prose text-xs text-muted">
          The set hook-tracker sends with every attempt. The two placeholder values are not stored:
          the signature and the timestamp it covers exist only for the moment of each attempt.
        </p>
        <dl class="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
          <template v-for="[name, value] in requestHeaders" :key="name">
            <dt class="font-mono text-[11px] break-all text-faint">{{ name }}</dt>
            <dd class="font-mono text-[11px] break-all text-muted">{{ value }}</dd>
          </template>
        </dl>
      </div>

      <div v-if="responseHeaders.length > 0">
        <p class="eyebrow">Response headers · attempt {{ newestAttempt.attemptNumber }}</p>
        <dl class="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
          <template v-for="[name, value] in responseHeaders" :key="name">
            <dt class="font-mono text-[11px] break-all text-faint">{{ name }}</dt>
            <dd class="font-mono text-[11px] break-all text-muted">{{ value }}</dd>
          </template>
        </dl>
      </div>

      <div>
        <p class="eyebrow">Payload</p>
        <div class="mt-2">
          <JsonBlock
            :value="delivery.payload"
            :label="`${delivery.eventId} · ${delivery.eventType}`"
            :bytes="payloadBytes"
          />
        </div>
      </div>

      <div>
        <p class="eyebrow">Request as cURL</p>
        <p class="mt-1.5 max-w-prose text-xs text-muted">
          The signature is computed per attempt from the endpoint secret and is never stored, so the
          receiver will reject this request until you regenerate
          <span class="font-mono">x-webhook-timestamp</span> and
          <span class="font-mono">x-webhook-signature</span> together, from the same timestamp: the
          signature covers <span class="font-mono">&lt;timestamp&gt;.&lt;raw body&gt;</span>, and
          the receiver also rejects a timestamp outside its tolerance window.
        </p>
        <div class="mt-2 overflow-hidden rounded-md border border-rule bg-sunken">
          <div class="flex items-center gap-2 border-b border-rule-soft px-3 py-1.5">
            <span class="eyebrow">Runs against the endpoint</span>
            <span class="ml-auto"><CopyButton :text="curlCommand" /></span>
          </div>
          <pre
            class="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-ink"
          ><code>{{ curlCommand }}</code></pre>
        </div>
      </div>
    </div>
  </section>
</template>
