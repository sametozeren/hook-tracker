<script setup>
import { computed } from 'vue';

const props = defineProps({
  rows: {
    type: Number,
    default: 5,
  },
  columns: {
    type: Array,
    default: () => ['30%', '20%', '25%', '15%', '10%'],
  },
});

const gridStyle = computed(() => ({
  gridTemplateColumns: props.columns.map((width) => `minmax(0, ${width})`).join(' '),
}));
</script>

<template>
  <div aria-hidden="true" class="space-y-2">
    <div v-for="row in rows" :key="row" class="grid gap-3" :style="gridStyle">
      <span
        v-for="(width, column) in columns"
        :key="column"
        class="pulse-soft h-3 rounded-[2px] bg-sunken"
        :style="{ animationDelay: `${(row + column) * 80}ms` }"
      />
    </div>
  </div>
</template>
