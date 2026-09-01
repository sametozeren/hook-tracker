<script setup>
import { computed, useSlots } from 'vue';

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  modelValue: {
    type: String,
    default: '',
  },
  label: {
    type: String,
    default: 'Password',
  },
  autocomplete: {
    type: String,
    default: 'current-password',
  },
  error: {
    type: String,
    default: '',
  },
  minlength: {
    type: Number,
    default: null,
  },
  maxlength: {
    type: Number,
    default: null,
  },
  visible: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'update:visible']);

const slots = useSlots();

const errorId = computed(() => `${props.id}-error`);

const hintId = computed(() => `${props.id}-hint`);

const toggleLabel = computed(() => (props.visible ? 'Hide password' : 'Show password'));

const describedBy = computed(() => {
  const ids = [props.error ? errorId.value : '', slots.hint ? hintId.value : ''].filter(Boolean);

  return ids.length > 0 ? ids.join(' ') : undefined;
});
</script>

<template>
  <div>
    <div class="flex items-baseline justify-between gap-3">
      <label :for="id" class="block text-sm font-medium text-ink">{{ label }}</label>
      <button
        type="button"
        class="rounded-md text-xs text-muted hover:text-ink"
        :aria-label="toggleLabel"
        @click="emit('update:visible', !visible)"
      >
        {{ visible ? 'Hide' : 'Show' }}
      </button>
    </div>
    <input
      :id="id"
      :value="modelValue"
      :type="visible ? 'text' : 'password'"
      name="password"
      :autocomplete="autocomplete"
      spellcheck="false"
      required
      :minlength="minlength ?? undefined"
      :maxlength="maxlength ?? undefined"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="mt-1.5 w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint"
      :class="error ? 'border-fail' : 'border-rule'"
      @input="emit('update:modelValue', $event.target.value)"
    />
    <p v-if="error" :id="errorId" class="mt-1.5 text-xs text-fail">{{ error }}</p>
    <p v-if="slots.hint" :id="hintId" class="mt-1.5 text-xs text-muted">
      <slot name="hint" />
    </p>
  </div>
</template>
