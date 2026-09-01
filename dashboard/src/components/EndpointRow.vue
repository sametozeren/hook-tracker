<script setup>
import { computed } from 'vue';
import { splitUrl } from '../lib/endpoint-url.js';
import UiButton from './ui/UiButton.vue';

// Mirrors the worker's ENDPOINT_AUTO_DISABLE_THRESHOLD default. The API returns
// no disabled-at timestamp and no disable reason, so the failure count is the
// only evidence the dashboard has for why an endpoint went down — and the server
// threshold can differ from this one, which is why both readings are hedged.
const AUTO_DISABLE_THRESHOLD = 20;

const props = defineProps({
  endpoint: {
    type: Object,
    required: true,
  },
  isOwner: {
    type: Boolean,
    default: false,
  },
  busyAction: {
    type: String,
    default: '',
  },
});

defineEmits(['edit', 'test', 'rotate', 'disable', 'enable', 'delete']);

const url = computed(() => splitUrl(props.endpoint.url));

const disabledReason = computed(() =>
  props.endpoint.consecutiveFailures >= AUTO_DISABLE_THRESHOLD
    ? `Its ${props.endpoint.consecutiveFailures} consecutive failures reach the automatic disable threshold, so it was most likely disabled automatically.`
    : 'Its failure count is below the automatic disable threshold, so it was most likely disabled by hand.',
);
</script>

<template>
  <li class="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-6">
    <div class="min-w-0 space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em]"
          :class="endpoint.status === 'ACTIVE' ? 'bg-ok-soft text-ok' : 'bg-skip-soft text-skip'"
        >
          <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
          {{ endpoint.status }}
        </span>
        <span v-if="endpoint.description" class="truncate text-sm text-muted">
          {{ endpoint.description }}
        </span>
      </div>

      <p class="truncate font-mono text-sm" :title="endpoint.url">
        <span class="font-semibold text-ink">{{ url.host }}</span>
        <span class="text-muted">{{ url.path }}</span>
      </p>

      <div class="flex flex-wrap items-center gap-1.5">
        <span class="eyebrow">Events</span>
        <span v-if="endpoint.eventTypes.length === 0" class="text-xs text-muted">
          All event types
        </span>
        <template v-else>
          <span
            v-for="type in endpoint.eventTypes"
            :key="type"
            class="max-w-full truncate rounded-md border border-rule-soft bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink"
          >
            {{ type }}
          </span>
        </template>
      </div>

      <div
        v-if="endpoint.status === 'DISABLED'"
        class="rounded-md border border-rule-soft bg-skip-soft px-3 py-2.5"
      >
        <p class="text-sm text-ink">{{ disabledReason }}</p>
        <p class="mt-1 max-w-prose text-xs text-muted">
          Nothing is delivered while it is disabled. The API does not record when it was disabled,
          so this page cannot show a time. Enabling it resumes delivery and resets the consecutive
          failure count to 0.
        </p>
        <div class="mt-2">
          <UiButton size="sm" :loading="busyAction === 'enable'" @click="$emit('enable')">
            Enable
          </UiButton>
        </div>
      </div>
    </div>

    <div class="space-y-3 md:text-right">
      <div class="flex flex-wrap gap-x-6 gap-y-2 md:justify-end">
        <div>
          <p class="eyebrow">Rate limit</p>
          <p class="tnum font-mono text-sm text-ink">
            {{ endpoint.rateLimitPerMinute }}
            <span class="font-sans text-xs text-muted">/ min</span>
          </p>
        </div>
        <div>
          <p class="eyebrow">Failures in a row</p>
          <p
            class="tnum font-mono text-sm"
            :class="endpoint.consecutiveFailures > 0 ? 'text-fail' : 'text-ink'"
          >
            {{ endpoint.consecutiveFailures }}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap gap-1.5 md:justify-end">
        <UiButton size="sm" variant="quiet" @click="$emit('edit')">Edit</UiButton>
        <UiButton size="sm" variant="quiet" :loading="busyAction === 'test'" @click="$emit('test')">
          Send test event
        </UiButton>
        <UiButton
          v-if="isOwner"
          size="sm"
          variant="quiet"
          :loading="busyAction === 'rotate'"
          @click="$emit('rotate')"
        >
          Rotate secret
        </UiButton>
        <UiButton
          v-if="endpoint.status === 'ACTIVE'"
          size="sm"
          variant="quiet"
          :loading="busyAction === 'disable'"
          @click="$emit('disable')"
        >
          Disable
        </UiButton>
        <UiButton
          v-else
          size="sm"
          variant="quiet"
          :loading="busyAction === 'enable'"
          @click="$emit('enable')"
        >
          Enable
        </UiButton>
        <UiButton v-if="isOwner" size="sm" variant="quiet" @click="$emit('delete')">
          Delete
        </UiButton>
      </div>
    </div>
  </li>
</template>
