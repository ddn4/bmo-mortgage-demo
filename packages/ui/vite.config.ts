import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API runs on :8080 (see packages/api). Proxy /api so the browser only
// ever talks to the Vite origin during local dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
});
