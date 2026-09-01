<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import IconClose from './ui/IconClose.vue';
import UiButton from './ui/UiButton.vue';

const TONES = {
  ok: { frame: 'border-rule bg-ok-soft', title: 'text-ok' },
  skip: { frame: 'border-rule bg-skip-soft', title: 'text-skip' },
  fail: { frame: 'border-rule bg-fail-soft', title: 'text-fail' },
};

const props = defineProps({
  notice: {
    type: Object,
    default: null,
  },
  action: {
    type: Object,
    default: null,
  },
});

defineEmits(['dismiss', 'action']);

const tone = computed(() => TONES[props.notice?.tone] ?? TONES.ok);
</script>

<template>
  <div role="status" :class="notice ? ['rounded-md border px-3 py-3', tone.frame] : 'sr-only'">
    <div v-if="notice" class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium" :class="tone.title">{{ notice.title }}</p>
        <p class="mt-1 max-w-prose text-sm break-words text-ink">{{ notice.body }}</p>
        <p v-if="notice.requestId" class="mt-1 text-xs text-faint">
          Request id
          <span class="font-mono break-all text-muted">{{ notice.requestId }}</span>
        </p>

        <div v-if="notice.link || action" class="mt-3 flex flex-wrap gap-2">
          <RouterLink
            v-if="notice.link"
            :to="notice.link.to"
            class="inline-flex h-7 items-center rounded-md border border-rule bg-surface px-2.5 text-xs font-medium text-ink hover:bg-sunken"
          >
            {{ notice.link.label }}
          </RouterLink>
          <UiButton v-if="action" size="sm" :loading="action.loading" @click="$emit('action')">
            {{ action.label }}
          </UiButton>
        </div>
      </div>

      <button
        type="button"
        class="-mt-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-surface hover:text-ink"
        aria-label="Dismiss this message"
        @click="$emit('dismiss')"
      >
        <IconClose class="size-3" />
      </button>
    </div>
  </div>
</template>
