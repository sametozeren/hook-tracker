<script setup>
import { onBeforeUnmount, ref } from 'vue';
import UiButton from './UiButton.vue';

const COPIED_RESET_MS = 2000;

const props = defineProps({
  text: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: 'Copy',
  },
});

const copied = ref(false);
let resetTimer = null;

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text);
    copied.value = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied.value = false;
    }, COPIED_RESET_MS);
  } catch {
    copied.value = false;
  }
}

onBeforeUnmount(() => {
  clearTimeout(resetTimer);
});
</script>

<template>
  <UiButton variant="quiet" size="sm" @click="copy">
    <span aria-live="polite">{{ copied ? 'Copied' : label }}</span>
  </UiButton>
</template>
