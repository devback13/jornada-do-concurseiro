import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        timeout: 15 * 60 * 1000,
        proxyTimeout: 15 * 60 * 1000,
      },
    },
  },
});

