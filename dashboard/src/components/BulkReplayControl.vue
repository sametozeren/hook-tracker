<script setup>
import { computed, ref, watch } from 'vue';
import { useDeliveriesStore } from '../stores/deliveries.js';
import { describeApiError } from '../lib/api-error-message.js';
import ConfirmDialog from './ConfirmDialog.vue';
import UiButton from './ui/UiButton.vue';

// Mirrors the server's BULK_REPLAY_LIMIT default. The client cannot ask for it,
// and the operator needs the cap before the run, not only in the result.
const BULK_REPLAY_CAP = 500;

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
  filters: {
    type: Object,
    required: true,
  },
  filterKey: {
    type: String,
    required: true,
  },
  filterSummary: {
    type: String,
    required: true,
  },
});

const deliveries = useDeliveriesStore();

const confirmOpen = ref(false);
const bulkRunning = ref(false);
const bulkResult = ref(null);
const bulkError = ref(null);

// The list only holds the pages that were loaded, so the exact size of the
// match set is known only once the cursor is exhausted. Claiming a number
// before that would be a guess the server would not honour.
const bulkLabel = computed(() =>
  deliveries.hasMore ? 'Replay all matching' : `Replay all ${deliveries.items.length}`,
);

const bulkMessage = computed(() => {
  const result = bulkResult.value;

  if (!result) {
    return '';
  }

  if (result.matched > result.cappedAt) {
    const left = result.matched - result.cappedAt;

    return `${result.replayed} of ${result.matched} matching deliveries were replayed. Bulk replay is capped at ${result.cappedAt} per run, so ${left} were not replayed. Run it again to take the next batch.`;
  }

  if (result.replayed < result.matched) {
    return `${result.replayed} of ${result.matched} matching deliveries were replayed. Deliveries that are still queued or in flight are left alone.`;
  }

  return `Replayed ${result.replayed} of ${result.matched} matching deliveries.`;
});

const bulkErrorMessage = computed(() =>
  bulkError.value ? `Bulk replay failed: ${describeApiError(bulkError.value)}` : '',
);

// The refresh is awaited inside the run, so the button keeps its loading state
// until the reloaded list is on screen, while the dialog has already closed.
// Handing the refresh to the parent through an event would break that order.
async function runBulkReplay() {
  bulkRunning.value = true;
  bulkError.value = null;

  try {
    bulkResult.value = await deliveries.bulkReplay(props.projectId, props.filters);
    confirmOpen.value = false;

    await deliveries.refresh();
  } catch (caught) {
    bulkError.value = caught;
  } finally {
    bulkRunning.value = false;
  }
}

watch(
  () => [props.projectId, props.filterKey],
  () => {
    bulkResult.value = null;
    bulkError.value = null;
  },
);
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <UiButton
      :disabled="deliveries.items.length === 0"
      :loading="bulkRunning"
      @click="confirmOpen = true"
    >
      {{ bulkLabel }}
    </UiButton>

    <p role="status" :class="bulkMessage ? 'text-sm text-muted' : 'sr-only'">
      {{ bulkMessage }}
    </p>

    <p v-if="bulkErrorMessage && !confirmOpen" role="alert" class="text-sm text-fail">
      {{ bulkErrorMessage }}
    </p>
  </div>

  <ConfirmDialog
    v-if="confirmOpen"
    eyebrow="Bulk replay"
    title="Replay every delivery matching this view?"
    confirm-label="Replay them"
    variant="primary"
    size="lg"
    :pending="bulkRunning"
    :error="bulkErrorMessage"
    @close="confirmOpen = false"
    @confirm="runBulkReplay"
  >
    <p class="max-w-prose text-sm text-muted">
      This replays the deliveries matching {{ filterSummary }}. Each replay creates a new delivery
      against the same event; the original attempt history is left as it happened.
    </p>
    <p class="mt-1 max-w-prose text-sm text-muted">
      The server replays at most
      <span class="tnum font-mono text-ink">{{ BULK_REPLAY_CAP }}</span>
      deliveries per run and reports how many it took. Run it again to take the next batch.
    </p>
    <p v-if="deliveries.hasMore" class="mt-1 max-w-prose text-sm text-muted">
      More rows match than are loaded, so the server decides the final count and reports it back.
    </p>
  </ConfirmDialog>
</template>
