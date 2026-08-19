import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Test setup.
 *
 * Two things are reset between every test and both matter:
 *
 *  - localStorage, because the attempt-cap counter lives there. A count that
 *    leaked between tests would lock out a later one for reasons invisible in
 *    its own source.
 *  - fetch, because every test that renders a journey stubs it. A leaked stub
 *    is worse than no stub: the test passes against the previous test's data.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
