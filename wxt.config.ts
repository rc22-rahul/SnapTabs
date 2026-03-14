import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'TabVault',
    description: 'Snapshot and restore your browser tabs instantly. Works in incognito.',
    permissions: ['tabs', 'sessions', 'tabGroups', 'storage'],
    incognito: 'spanning',
  },
});
