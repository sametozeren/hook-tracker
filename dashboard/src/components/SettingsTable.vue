<script setup>
import { computed } from 'vue';

const props = defineProps({
  columns: {
    type: Array,
    required: true,
  },
  rows: {
    type: Array,
    required: true,
  },
  rowKey: {
    type: String,
    default: 'id',
  },
});

// The track list is a runtime value, so it reaches the grid through a custom
// property: a `md:grid-cols-[...]` class built at runtime would never be seen
// by the Tailwind scanner.
const trackStyle = computed(() => ({
  '--settings-cols': props.columns.map((column) => column.width).join(' '),
}));
</script>

<template>
  <div>
    <div
      class="eyebrow hidden md:grid md:grid-cols-[var(--settings-cols)] md:items-center md:gap-3 md:px-3 md:pb-1.5"
      :style="trackStyle"
    >
      <span
        v-for="column in columns"
        :key="column.key"
        :class="column.align === 'end' ? 'md:text-right' : ''"
      >
        {{ column.label }}
      </span>
    </div>

    <ul
      class="max-md:space-y-2 md:divide-y md:divide-rule-soft md:rounded-lg md:border md:border-rule"
    >
      <li
        v-for="row in rows"
        :key="row[rowKey]"
        class="max-md:space-y-1 max-md:rounded-lg max-md:border max-md:border-rule max-md:p-3 md:grid md:grid-cols-[var(--settings-cols)] md:items-center md:gap-3 md:px-3 md:py-2.5"
        :style="trackStyle"
      >
        <div
          v-for="column in columns"
          :key="column.key"
          class="min-w-0 max-md:flex max-md:items-baseline max-md:gap-3"
          :class="column.align === 'end' ? 'md:text-right' : ''"
        >
          <span v-if="!column.hideLabel" class="eyebrow shrink-0 md:hidden">
            {{ column.label }}
          </span>
          <span class="block min-w-0 flex-1 max-md:text-right">
            <slot :name="column.key" :row="row" />
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>
