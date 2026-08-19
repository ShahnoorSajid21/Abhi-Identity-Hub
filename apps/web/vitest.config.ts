import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Frontend test configuration.
 *
 * Separate from vite.config.ts so the dev/build path stays exactly as it was.
 * `apps/**` is deliberately outside the root `npm run verify` gate (the root
 * tsconfig uses an explicit include allowlist), so this runner is invoked by
 * `npm run test --workspace @abhi/web` and by the root `test:web` script.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Each file gets a clean localStorage; the attempt-cap counter persists
    // there and a leaked count would make an unrelated test lock out.
    isolate: true,
  },
});
