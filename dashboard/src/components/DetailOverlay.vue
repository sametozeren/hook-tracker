<script>
export const DETAIL_OVERLAY = Symbol('detail-overlay');
</script>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, provide, ref } from 'vue';

const WIDE_QUERY = '(min-width: 1024px)';

// The header stays visible above the panel, so this is a full-screen layer, not
// a modal: navigation remains reachable, and the panel claims neither
// aria-modal nor a focus trap it would have to break to let the header through.
const OVERLAY_CLASS =
  'fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto overscroll-contain bg-page';

const INLINE_CLASS = 'mt-5 min-w-0 lg:mt-0';

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['close']);

const panel = ref(null);
const overlay = ref(false);

let media = null;
let previouslyFocused = null;
let savedScrollY = 0;

provide(DETAIL_OVERLAY, overlay);

// Escape closes the panel only while it is the full-screen layer. On lg and up
// the panel is a side column next to a list that stays interactive, so Escape
// belongs to whatever holds focus there — clearing a filter input, closing a
// menu — and must not navigate out of the delivery.
function onKeydown(event) {
  if (overlay.value && event.key === 'Escape') {
    emit('close');
  }
}

function activate() {
  previouslyFocused = document.activeElement;
  savedScrollY = window.scrollY;
  document.body.style.overflow = 'hidden';

  nextTick(() => panel.value?.focus());
}

function restoreScroll() {
  const top = savedScrollY;

  window.scrollTo({ top });

  // The router scrolls every navigation to the top, one tick after the panel is
  // torn down, so the list position has to be re-applied after that runs.
  requestAnimationFrame(() => window.scrollTo({ top }));
}

function deactivate() {
  document.body.style.overflow = '';

  const target = previouslyFocused;

  previouslyFocused = null;
  target?.focus?.({ preventScroll: true });
  restoreScroll();
}

function setOverlay(next) {
  if (next === overlay.value) {
    return;
  }

  overlay.value = next;

  if (next) {
    activate();
  } else {
    deactivate();
  }
}

function onMediaChange(event) {
  setOverlay(!event.matches);
}

onMounted(() => {
  media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onMediaChange);
  document.addEventListener('keydown', onKeydown);
  setOverlay(!media.matches);
});

onBeforeUnmount(() => {
  media?.removeEventListener('change', onMediaChange);
  document.removeEventListener('keydown', onKeydown);

  if (overlay.value) {
    deactivate();
  }
});
</script>

<template>
  <Teleport to="body" :disabled="!overlay">
    <div
      ref="panel"
      tabindex="-1"
      :role="overlay ? 'region' : undefined"
      :aria-label="overlay ? props.label : undefined"
      :class="overlay ? OVERLAY_CLASS : INLINE_CLASS"
    >
      <slot />
    </div>
  </Teleport>
</template>
