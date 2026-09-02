<script setup>
import { computed, inject, onMounted, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { DETAIL_OVERLAY } from '../components/DetailOverlay.vue';
import { useEventsStore } from '../stores/events.js';
import { useEndpointsStore } from '../stores/endpoints.js';
import { describeApiError } from '../lib/api-error-message.js';
import { formatAbsoluteUtc } from '../components/ui/time.js';
import ErrorState from '../components/ui/ErrorState.vue';
import JsonBlock from '../components/ui/JsonBlock.vue';
import SkeletonRows from '../components/ui/SkeletonRows.vue';
import StatusPill from '../components/ui/StatusPill.vue';
import UiButton from '../components/ui/UiButton.vue';

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
const events = useEventsStore();
const endpoints = useEndpointsStore();

const overlayFlag = inject(DETAIL_OVERLAY, null);

const overlay = computed(() => overlayFlag?.value === true);

const eventId = computed(() => route.params.eventId);

const projectId = computed(() => route.params.projectId);

const listRoute = computed(() => ({
  name: 'events',
  params: { projectId: projectId.value },
  query: route.query,
}));

const event = computed(() => events.detail);

const notFound = computed(() => events.detailError?.status === 404);

const deliveries = computed(() => event.value?.deliveries ?? []);

const payloadBytes = computed(() => {
  if (!event.value) {
    return null;
  }

  return new TextEncoder().encode(JSON.stringify(event.value.payload)).length;
});

function endpointName(endpointId) {
  return endpoints.displayName(endpointId);
}

function load() {
  events.loadDetail(eventId.value);
}

function close() {
  router.push(listRoute.value);
}

watch(
  eventId,
  (id) => {
    if (id) {
      load();
    }
  },
  { immediate: true },
);

onMounted(() => {
  endpoints.load(projectId.value).catch(() => undefined);
});
</script>

<template>
  <section
    class="bg-surface"
    :class="overlay ? SHELL_CLASS.overlay : SHELL_CLASS.column"
    aria-label="Event detail"
  >
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-3"
      :class="overlay ? HEADER_CLASS.overlay : HEADER_CLASS.column"
    >
      <span class="font-mono text-xs break-all text-ink">{{ eventId }}</span>
      <span v-if="event" class="min-w-0 truncate text-xs text-muted">
        {{ event.eventType }} · {{ formatAbsoluteUtc(event.receivedAt) }}
      </span>
      <span class="ml-auto">
        <UiButton variant="quiet" size="sm" title="Close the event detail" @click="close">
          Close
        </UiButton>
      </span>
    </div>

    <div v-if="events.detailLoading" class="px-4 py-4">
      <SkeletonRows :rows="6" :columns="['30%', '55%']" />
    </div>

    <div v-else-if="notFound" class="px-4 py-4">
      <ErrorState
        title="This event is not visible to this session."
        detail="It either does not exist or belongs to a project you are not a member of."
        @retry="load"
      />
      <RouterLink :to="listRoute" class="mt-3 inline-block text-sm underline underline-offset-2">
        Back to the events list
      </RouterLink>
    </div>

    <div v-else-if="events.detailError" class="px-4 py-4">
      <ErrorState
        title="The event could not be loaded."
        :detail="describeApiError(events.detailError)"
        :request-id="events.detailError.requestId || ''"
        @retry="load"
      />
    </div>

    <div v-else-if="event" class="space-y-5 px-4 py-4">
      <div>
        <p class="eyebrow">Deliveries</p>

        <ul v-if="deliveries.length > 0" class="mt-2 divide-y divide-rule-soft">
          <li
            v-for="delivery in deliveries"
            :key="delivery.id"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
          >
            <StatusPill :status="delivery.status" size="sm" />
            <span class="min-w-0 flex-1 truncate text-xs text-ink">
              {{ endpointName(delivery.endpointId) }}
            </span>
            <span class="tnum font-mono text-[11px] text-faint">
              {{ delivery.attemptCount }}
              {{ delivery.attemptCount === 1 ? 'attempt' : 'attempts' }}
            </span>
            <RouterLink
              :to="{ name: 'delivery', params: { projectId, deliveryId: delivery.id } }"
              class="text-xs text-muted underline underline-offset-2 hover:text-ink"
            >
              Open delivery
            </RouterLink>
            <p class="tnum w-full font-mono text-[11px] text-faint">
              created {{ formatAbsoluteUtc(delivery.createdAt) }}
              <span v-if="delivery.completedAt">
                · completed {{ formatAbsoluteUtc(delivery.completedAt) }}
              </span>
            </p>
          </li>
        </ul>

        <p v-else class="mt-2 max-w-prose text-xs text-muted">
          This event produced no delivery: no endpoint was subscribed to it when it arrived.
        </p>
      </div>

      <div>
        <p class="eyebrow">Payload</p>
        <div class="mt-2">
          <JsonBlock
            :value="event.payload"
            :label="`${event.id} · ${event.eventType}`"
            :bytes="payloadBytes"
          />
        </div>
      </div>
    </div>
  </section>
</template>
