<script setup>
import { computed } from 'vue';
import CopyButton from './CopyButton.vue';

const TOKEN_PATTERN =
  /"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],]/g;

const PUNCTUATION = '{}[],';

const props = defineProps({
  value: {
    type: [Object, Array, String],
    required: true,
  },
  label: {
    type: String,
    default: 'Payload',
  },
  open: {
    type: Boolean,
    default: true,
  },
  bytes: {
    type: Number,
    default: null,
  },
});

function stringify(value) {
  if (typeof value !== 'string') {
    return JSON.stringify(value, null, 2);
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function pushKeyToken(tokens, text) {
  const quoted = text.slice(0, text.lastIndexOf('"') + 1);

  tokens.push({ text: quoted, class: 'text-pending' });
  tokens.push({ text: text.slice(quoted.length), class: 'text-faint' });
}

function pushMatch(tokens, text) {
  if (text.startsWith('"')) {
    if (text.endsWith(':')) {
      pushKeyToken(tokens, text);

      return;
    }

    tokens.push({ text, class: 'text-ok' });

    return;
  }

  if (text.length === 1 && PUNCTUATION.includes(text)) {
    tokens.push({ text, class: 'text-faint' });

    return;
  }

  tokens.push({ text, class: 'text-retry' });
}

function tokenize(source) {
  const tokens = [];
  let cursor = 0;

  TOKEN_PATTERN.lastIndex = 0;

  let match = TOKEN_PATTERN.exec(source);

  while (match !== null) {
    if (match.index > cursor) {
      tokens.push({ text: source.slice(cursor, match.index), class: 'text-ink' });
    }

    pushMatch(tokens, match[0]);
    cursor = match.index + match[0].length;
    match = TOKEN_PATTERN.exec(source);
  }

  if (cursor < source.length) {
    tokens.push({ text: source.slice(cursor), class: 'text-ink' });
  }

  return tokens;
}

const formatted = computed(() => stringify(props.value));

const tokens = computed(() => tokenize(formatted.value));

const sizeLabel = computed(() => {
  if (props.bytes === null || props.bytes === undefined) {
    return '';
  }

  if (props.bytes < 1024) {
    return `${props.bytes} B`;
  }

  return `${(props.bytes / 1024).toFixed(1)} kB`;
});
</script>

<template>
  <details class="group overflow-hidden rounded-md border border-rule bg-surface" :open="open">
    <summary
      class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden"
    >
      <svg
        class="h-3 w-3 shrink-0 text-faint transition-transform group-open:rotate-90"
        viewBox="0 0 12 12"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <polygon points="4,2.5 9,6 4,9.5" />
      </svg>
      <span class="truncate text-xs font-medium text-ink">{{ label }}</span>
      <span v-if="sizeLabel" class="tnum shrink-0 font-mono text-[11px] text-faint">
        {{ sizeLabel }}
      </span>
      <span class="ml-auto shrink-0">
        <CopyButton :text="formatted" @click.stop />
      </span>
    </summary>
    <div class="border-t border-rule-soft bg-sunken">
      <pre
        class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed"
      ><code><span v-for="(token, index) in tokens" :key="index" :class="token.class">{{ token.text }}</span></code></pre>
    </div>
  </details>
</template>
