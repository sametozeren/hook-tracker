<script setup>
import { computed } from 'vue';

const OUTCOME_FILL = {
  ok: 'bg-ok',
  error: 'bg-fail',
  warning: 'bg-retry',
  skipped: 'bg-skip',
};

const OUTCOME_WORD = {
  ok: 'succeeded',
  error: 'failed',
  warning: 'warned',
  skipped: 'skipped',
};

const props = defineProps({
  attemptCount: {
    type: Number,
    required: true,
  },
  maxAttempts: {
    type: Number,
    default: 6,
  },
  status: {
    type: String,
    required: true,
  },
  outcomes: {
    type: Array,
    default: () => [],
  },
});

const totalCells = computed(() => Math.max(props.maxAttempts, props.attemptCount, 1));

const inFlightIndex = computed(() =>
  Math.min(Math.max(props.attemptCount - 1, 0), totalCells.value - 1),
);

function statusOutcome(index) {
  if (props.status === 'SUCCEEDED') {
    return index === props.attemptCount - 1 ? 'ok' : 'error';
  }

  if (props.status === 'SKIPPED') {
    return 'skipped';
  }

  return 'error';
}

function outcomeAt(index) {
  const given = props.outcomes[index];

  if (given === 'ok' || given === 'error' || given === 'warning') {
    return given;
  }

  return statusOutcome(index);
}

function cellClasses(index) {
  if (props.status === 'IN_FLIGHT' && index === inFlightIndex.value) {
    return 'bg-flight pulse-soft';
  }

  if (index < props.attemptCount) {
    return OUTCOME_FILL[outcomeAt(index)];
  }

  if (props.status === 'RETRYING' && index === props.attemptCount) {
    return 'border border-dashed border-retry';
  }

  return 'border border-rule';
}

const cells = computed(() =>
  Array.from({ length: totalCells.value }, (_unused, index) => ({
    index,
    classes: cellClasses(index),
  })),
);

function countedOutcomes() {
  const counted = [];

  for (let index = 0; index < props.attemptCount; index += 1) {
    const isInFlight = props.status === 'IN_FLIGHT' && index === inFlightIndex.value;

    if (!isInFlight) {
      counted.push(outcomeAt(index));
    }
  }

  return counted;
}

function summariseOutcomes(counted) {
  const tally = counted.reduce((acc, outcome) => {
    acc[outcome] = (acc[outcome] ?? 0) + 1;

    return acc;
  }, {});

  const kinds = Object.keys(tally);

  if (counted.length === 1) {
    return OUTCOME_WORD[counted[0]];
  }

  if (kinds.length === 1) {
    return `all ${OUTCOME_WORD[kinds[0]]}`;
  }

  return kinds.map((kind) => `${tally[kind]} ${OUTCOME_WORD[kind]}`).join(', ');
}

const ariaLabel = computed(() => {
  const parts = [];

  if (props.attemptCount === 0) {
    parts.push(`No attempts yet, ${totalCells.value} allowed`);
  } else {
    parts.push(`Attempt ${props.attemptCount} of ${totalCells.value}`);
  }

  const counted = countedOutcomes();

  if (counted.length > 0) {
    parts.push(summariseOutcomes(counted));
  }

  if (props.status === 'RETRYING') {
    parts.push(`attempt ${props.attemptCount + 1} scheduled`);
  }

  if (props.status === 'IN_FLIGHT') {
    parts.push(`attempt ${inFlightIndex.value + 1} in flight`);
  }

  if (props.status === 'PENDING') {
    parts.push('queued');
  }

  if (props.status === 'SKIPPED' && counted.length === 0) {
    parts.push('skipped');
  }

  return `${parts.join(', ')}.`;
});
</script>

<template>
  <div class="inline-flex items-center gap-2" role="img" :aria-label="ariaLabel">
    <span class="flex items-center gap-[3px]">
      <span
        v-for="cell in cells"
        :key="cell.index"
        class="h-2 w-2 shrink-0 rounded-[2px]"
        :class="cell.classes"
      />
    </span>
    <span class="tnum font-mono text-xs text-faint">{{ attemptCount }}/{{ totalCells }}</span>
  </div>
</template>
