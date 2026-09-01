<script setup>
defineProps({
  size: { type: Number, default: 22 },
  title: { type: String, default: 'hook-tracker' },
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    role="img"
    :aria-label="title"
    class="shrink-0"
  >
    <rect
      x="2.9"
      y="15.4"
      width="5.7"
      height="5.7"
      rx="1.2"
      stroke="currentColor"
      stroke-width="1.9"
    />
    <rect
      x="9.15"
      y="9.15"
      width="5.7"
      height="5.7"
      rx="1.2"
      stroke="currentColor"
      stroke-width="1.9"
    />
    <rect x="15.4" y="2.9" width="5.7" height="5.7" rx="1.2" fill="currentColor" />
  </svg>
</template>
