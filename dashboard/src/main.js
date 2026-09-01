import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index.js';
import { initTheme } from './lib/theme.js';
import './style.css';

initTheme();

createApp(App).use(createPinia()).use(router).mount('#app');
