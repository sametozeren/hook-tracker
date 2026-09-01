const BUCKET_SUFFIX = '_bucket';

function escapeHelp(text) {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function escapeLabelValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function formatValue(value) {
  if (Number.isNaN(value)) {
    return 'NaN';
  }

  if (value === Number.POSITIVE_INFINITY) {
    return '+Inf';
  }

  if (value === Number.NEGATIVE_INFINITY) {
    return '-Inf';
  }

  return String(value);
}

export function formatLabels(labels) {
  const pairs = Object.entries(labels ?? {}).filter(([, value]) => value !== undefined);

  if (pairs.length === 0) {
    return '';
  }

  return `{${pairs.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`;
}

function sampleLine(name, labels, value) {
  return `${name}${formatLabels(labels)} ${formatValue(value)}`;
}

function histogramLines(family) {
  const lines = family.bounds.map((bound, index) =>
    sampleLine(
      `${family.name}${BUCKET_SUFFIX}`,
      { le: formatValue(bound) },
      family.cumulative[index],
    ),
  );

  lines.push(sampleLine(`${family.name}${BUCKET_SUFFIX}`, { le: '+Inf' }, family.count));
  lines.push(sampleLine(`${family.name}_sum`, undefined, family.sum));
  lines.push(sampleLine(`${family.name}_count`, undefined, family.count));

  return lines;
}

function familyLines(family) {
  if (family.type === 'histogram') {
    return histogramLines(family);
  }

  return family.samples.map((sample) => sampleLine(family.name, sample.labels, sample.value));
}

// A family whose source was unreachable is dropped by the collector rather than
// rendered as zero: an absent series and a series that really is zero mean
// different things to whoever reads the dashboard.
export function renderMetrics(families) {
  const blocks = families.filter(Boolean).map((family) => {
    const header = [
      `# HELP ${family.name} ${escapeHelp(family.help)}`,
      `# TYPE ${family.name} ${family.type}`,
    ];

    return [...header, ...familyLines(family)].join('\n');
  });

  return `${blocks.join('\n\n')}\n`;
}
