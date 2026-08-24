import { describe, test, expect, beforeEach } from 'vitest';
import {
  clearApplication,
  confirmApplication,
  getApplication,
  openApplication,
  recordCheckComplete,
  statusOf,
} from './applications.ts';

/**
 * The shared application store.
 *
 * This is the state layer the two sides of the POC meet in: the customer app
 * writes each completed check, the internal dashboard reads them. The rules
 * worth pinning are the ones a screen would otherwise get subtly wrong — that
 * a completion is not lost on refresh, that the ledger's own methods count
 * towards "done", and that Back confirms nothing.
 */

const SUBJECT = 'subject-under-test';

beforeEach(() => {
  clearApplication(SUBJECT);
  localStorage.clear();
});

describe('opening an application', () => {
  test('records the outstanding checks against the customer', () => {
    openApplication(SUBJECT, 'SBL', ['LIVENESS']);

    const app = getApplication(SUBJECT);
    expect(app?.productId).toBe('SBL');
    expect(app?.requiredMethods).toEqual(['LIVENESS']);
    expect(app?.completedMethods).toEqual([]);
    expect(app?.confirmedAt).toBeNull();
  });

  test('re-opening the same product keeps progress the customer already made', () => {
    openApplication(SUBJECT, 'SBL', ['BIOMETRIC_1TO1', 'LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'BIOMETRIC_1TO1');
    openApplication(SUBJECT, 'SBL', ['BIOMETRIC_1TO1', 'LIVENESS']);

    expect(getApplication(SUBJECT)?.completedMethods).toEqual(['BIOMETRIC_1TO1']);
  });

  test('switching products starts the checklist over — a different set is outstanding', () => {
    openApplication(SUBJECT, 'SBL', ['LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');
    openApplication(SUBJECT, 'EWA', ['VERISYS']);

    const app = getApplication(SUBJECT);
    expect(app?.productId).toBe('EWA');
    expect(app?.completedMethods).toEqual([]);
    expect(app?.confirmedAt).toBeNull();
  });
});

describe('the customer completing a check', () => {
  test('moves that check from pending to complete, leaving the others alone', () => {
    openApplication(SUBJECT, 'SBL', ['BIOMETRIC_1TO1', 'LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'BIOMETRIC_1TO1');

    const app = getApplication(SUBJECT)!;
    expect(app.completedMethods).toEqual(['BIOMETRIC_1TO1']);
    expect(statusOf(app)).toBe('awaiting_customer');
  });

  test('is idempotent — completing twice does not double-count', () => {
    openApplication(SUBJECT, 'SBL', ['LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');

    expect(getApplication(SUBJECT)?.completedMethods).toEqual(['LIVENESS']);
  });

  test('survives a reload — the state is on disk, not in a component', () => {
    openApplication(SUBJECT, 'SBL', ['LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');

    // What a refresh actually restores from.
    const raw = JSON.parse(localStorage.getItem('abhi.applications') ?? '{}');
    expect(raw[SUBJECT].completedMethods).toEqual(['LIVENESS']);
  });

  test('creates the entry when the customer reached /apply directly', () => {
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');

    const app = getApplication(SUBJECT)!;
    // The checklist must never be shorter than what has actually been done.
    expect(app.requiredMethods).toEqual(['LIVENESS']);
    expect(app.completedMethods).toEqual(['LIVENESS']);
  });
});

describe('status', () => {
  test('is complete once every required check is done', () => {
    openApplication(SUBJECT, 'SBL', ['BIOMETRIC_1TO1', 'LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'BIOMETRIC_1TO1');
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');

    expect(statusOf(getApplication(SUBJECT)!)).toBe('checks_complete');
  });

  /**
   * The bug this pins: the chip read "waiting for the customer" beside a list
   * showing every check complete, because only one of the two counted the
   * ledger's own methods. A check the ledger proves is done, whoever ran it.
   */
  test('counts a check the ledger already holds as done', () => {
    openApplication(SUBJECT, 'SBL', ['BIOMETRIC_1TO1', 'LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');

    const app = getApplication(SUBJECT)!;
    expect(statusOf(app)).toBe('awaiting_customer');
    expect(statusOf(app, ['BIOMETRIC_1TO1'])).toBe('checks_complete');
  });

  test('confirming sets the status and stamps the moment', () => {
    openApplication(SUBJECT, 'SBL', ['LIVENESS']);
    recordCheckComplete(SUBJECT, 'SBL', 'LIVENESS');
    confirmApplication(SUBJECT, 'SBL');

    const app = getApplication(SUBJECT)!;
    expect(app.confirmedAt).not.toBeNull();
    expect(statusOf(app)).toBe('confirmed');
  });

  test('confirmed outranks an incomplete checklist rather than being recomputed away', () => {
    openApplication(SUBJECT, 'SBL', ['BIOMETRIC_1TO1', 'LIVENESS']);
    confirmApplication(SUBJECT, 'SBL');

    expect(statusOf(getApplication(SUBJECT)!)).toBe('confirmed');
  });
});
