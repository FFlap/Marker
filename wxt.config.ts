import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  vite: () => ({
    plugins: [react()],
  }),
  manifest: {
    name: 'Marker',
    description: 'Automatically remember the latest episode opened on Crunchyroll and Netflix.',
    permissions: ['storage', 'tabs'],
    host_permissions: [
      'https://www.crunchyroll.com/*',
      'https://www.netflix.com/*',
    ],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
  },
});
