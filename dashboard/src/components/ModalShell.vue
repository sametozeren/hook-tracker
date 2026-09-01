<script>
// A create dialog hands straight over to the secret dialog, so two shells can
// be mounted in the same tick; the shared counter stops whichever unmounts
// second from releasing a lock the other still needs.
let lockCount = 0;
</script>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import IconClose from './ui/IconClose.vue';

const WIDTH_CLASSES = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  eyebrow: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  dismissible: {
    type: Boolean,
    default: true,
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['md', 'lg'].includes(value),
  },
});

const emit = defineEmits(['close']);

const titleId = useId();
const panel = ref(null);

let previouslyFocused = null;

const widthClass = computed(() => WIDTH_CLASSES[props.size] ?? WIDTH_CLASSES.md);

function requestClose() {
  if (props.dismissible) {
    emit('close');
  }
}

function trapTab(event) {
  const container = panel.value;

  if (!container) {
    return;
  }

  const items = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));

  if (items.length === 0) {
    event.preventDefault();
    container.focus();

    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const outside = !container.contains(active);

  if (event.shiftKey && (outside || active === first || active === container)) {
    event.preventDefault();
    last.focus();

    return;
  }

  if (!event.shiftKey && (outside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    requestClose();

    return;
  }

  if (event.key === 'Tab') {
    trapTab(event);
  }
}

onMounted(() => {
  previouslyFocused = document.activeElement;
  document.addEventListener('keydown', onKeydown);

  if (lockCount === 0) {
    document.body.style.overflow = 'hidden';
  }

  lockCount += 1;
  panel.value?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  lockCount -= 1;

  if (lockCount === 0) {
    document.body.style.overflow = '';
  }

  previouslyFocused?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-page/80 px-4 py-6 sm:items-center sm:py-10"
      @click.self="requestClose"
    >
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="flex max-h-[calc(100dvh-3rem)] w-full flex-col rounded-lg border border-rule bg-surface shadow-lg"
        :class="widthClass"
      >
        <div class="flex items-start gap-3 border-b border-rule-soft px-4 py-3.5">
          <div class="min-w-0 flex-1">
            <p v-if="eyebrow" class="eyebrow">
              {{ eyebrow }}
            </p>
            <h2 :id="titleId" class="text-sm font-medium text-ink">{{ title }}</h2>
            <p v-if="description" class="mt-1 max-w-prose text-sm text-muted">{{ description }}</p>
          </div>

          <button
            v-if="dismissible"
            type="button"
            class="-mt-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-sunken hover:text-ink"
            aria-label="Close"
            @click="requestClose"
          >
            <IconClose class="size-3" />
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <slot />
        </div>

        <div
          v-if="$slots.footer"
          class="flex flex-wrap items-center justify-end gap-2 border-t border-rule-soft px-4 py-3"
        >
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
