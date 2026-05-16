import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api and /files to the Express server. The long timeouts are
// REQUIRED: AI calls (vision extraction) routinely take 20-40 seconds, and
// multipart PDF uploads need the proxy to NOT buffer-then-drop the body.
// Without these, the proxy returns ECONNRESET on /api/ai/onboard/analyze.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        // 5 minutes — covers slow Anthropic vision calls plus large PDFs.
        timeout: 5 * 60 * 1000,
        proxyTimeout: 5 * 60 * 1000,
      },
      '/files': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
