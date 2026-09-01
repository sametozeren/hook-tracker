<script setup>
import { computed } from 'vue';
import IconClose from './IconClose.vue';

const VARIANTS = {
  filter: {
    shell: 'gap-1.5 rounded-full border-rule bg-surface pl-2 text-xs',
    padding: { removable: 'pr-1', plain: 'pr-2' },
    value: 'truncate font-mono text-ink',
    button: 'h-4 w-4 hover:bg-sunken',
    icon: 'h-2.5 w-2.5',
  },
  token: {
    shell: 'gap-1 rounded-md border-rule-soft bg-sunken pl-1.5 font-mono text-[11px] text-ink',
    padding: { removable: 'pr-1', plain: 'pr-1.5' },
    value: 'truncate',
    button: 'size-4 hover:bg-page',
    icon: 'size-2.5',
  },
};

const props = defineProps({
  label: {
    type: String,
    default: '',
  },
  value: {
    type: String,
    required: true,
  },
  removable: {
    type: Boolean,
    default: true,
  },
  removeLabel: {
    type: String,
    default: '',
  },
  variant: {
    type: String,
    default: 'filter',
    validator: (value) => ['filter', 'token'].includes(value),
  },
});

const emit = defineEmits(['remove']);

const skin = computed(() => VARIANTS[props.variant] ?? VARIANTS.filter);

const removeAriaLabel = computed(() => {
  if (props.removeLabel) {
    return props.removeLabel;
  }

  return props.label ? `Clear ${props.label} filter` : `Remove ${props.value}`;
});
</script>

<template>
  <span
    class="inline-flex max-w-full items-center border py-0.5"
    :class="[skin.shell, removable ? skin.padding.removable : skin.padding.plain]"
  >
    <span v-if="label" class="shrink-0 text-muted">{{ label }}</span>
    <span :class="skin.value">{{ value }}</span>
    <button
      v-if="removable"
      type="button"
      class="inline-flex shrink-0 items-center justify-center rounded-full text-faint hover:text-ink"
      :class="skin.button"
      :aria-label="removeAriaLabel"
      @click="emit('remove')"
    >
      <IconClose :class="skin.icon" />
    </button>
  </span>
</template>
