import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The gateway runs on PORT (default 8080) and serves its routes at the root:
 * /kyc/verify, /policies, /metrics and so on. The frontend calls them under
 * /api so that one proxy rule covers every endpoint and no CORS handling has
 * to be added to the gateway — which would mean changing a service this
 * rebuild is not supposed to touch.
 *
 * Nothing is fetched from a CDN. The presenting room may have no network.
 */
const GATEWAY = process.env['GATEWAY_URL'] ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: GATEWAY,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
