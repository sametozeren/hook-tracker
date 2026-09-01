<script setup>
import ModalShell from './ModalShell.vue';
import UiButton from './ui/UiButton.vue';

defineProps({
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
  confirmLabel: {
    type: String,
    default: 'Confirm',
  },
  cancelLabel: {
    type: String,
    default: 'Cancel',
  },
  variant: {
    type: String,
    default: 'danger',
    validator: (value) => ['default', 'primary', 'danger'].includes(value),
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['md', 'lg'].includes(value),
  },
  pending: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['confirm', 'close']);
</script>

<template>
  <ModalShell
    :eyebrow="eyebrow"
    :title="title"
    :description="description"
    :size="size"
    :dismissible="!pending"
    @close="emit('close')"
  >
    <slot />

    <p v-if="error" role="alert" class="mt-3 rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">
      {{ error }}
    </p>

    <template #footer>
      <UiButton variant="quiet" :disabled="pending" @click="emit('close')">
        {{ cancelLabel }}
      </UiButton>
      <UiButton :variant="variant" :loading="pending" @click="emit('confirm')">
        {{ confirmLabel }}
      </UiButton>
    </template>
  </ModalShell>
</template>
