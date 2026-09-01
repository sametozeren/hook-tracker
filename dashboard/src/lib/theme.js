import { ref } from 'vue';

const STORAGE_KEY = 'ht-theme';
const MODES = ['system', 'light', 'dark'];

function readStored() {
  const value = localStorage.getItem(STORAGE_KEY);

  return MODES.includes(value) ? value : 'system';
}

export const themeMode = ref(readStored());

function apply(mode) {
  if (mode === 'system') {
    document.documentElement.removeAttribute('data-theme');

    return;
  }

  document.documentElement.setAttribute('data-theme', mode);
}

export function setThemeMode(mode) {
  const next = MODES.includes(mode) ? mode : 'system';

  themeMode.value = next;

  if (next === 'system') {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, next);
  }

  apply(next);
}

export function cycleThemeMode() {
  const index = MODES.indexOf(themeMode.value);

  setThemeMode(MODES[(index + 1) % MODES.length]);
}

export function initTheme() {
  apply(themeMode.value);
}
