import { describe, test, expect } from 'vitest';
import {
  nextStepFor,
  sortMethods,
  attemptsRemaining,
  attemptsUsed,
  recordAttempt,
  isLockedOut,
  isCapped,
  DAILY_ATTEMPT_CAP,
  type VerifyDecision,
} from './verify.ts';
import type { VerificationMethod } from './api.ts';

/**
 * The routing rule, tested without a DOM.
 *
 * Rendering is a React concern; deciding which screen a customer sees is a
 * compliance concern. These tests cover the second, exhaustively, so the
 * component tests can concentrate on whether the chosen screen actually
 * appears rather than re-proving the rule through five layers of markup.
 */

function decision(over: Partial<VerifyDecision>): VerifyDecision {
  return {
    outcome: 'ALLOW',
    reason: 'SUFFICIENT',
    missingMethods: [],
    disclosableAttributes: [],
    ageDays: 10,
    currentAssurance: 'A2',
    requiredAssurance: 'A2',
    policyId: 'EWA@v1',
    ...over,
  };
}

const SUBJECT = 'a'.repeat(64);
const TODAY = new Date('2026-08-19T09:00:00');
const TOMORROW = new Date('2026-08-20T09:00:00');

// ===========================================================================
describe('nextStepFor — the four outcomes', () => {
  test('ALLOW -> review, with nothing outstanding', () => {
    const step = nextStepFor(decision({ outcome: 'ALLOW' }));
    expect(step).toEqual({ screen: 'review', method: null, remaining: [], skipped: [] });
  });

  test('DENY -> hard stop, never a capture screen', () => {
    for (const reason of ['SUSPENDED', 'CNIC_EXPIRED'] as const) {
      const step = nextStepFor(decision({ outcome: 'DENY', reason }));
      expect(step.screen).toBe('hard-stop');
      expect(step.method).toBeNull();
    }
  });

  test('DENY ignores any missingMethods the gateway happened to send', () => {
    // Defence in depth: a DENY carrying methods would otherwise route a
    // customer into a capture screen that cannot help them.
    const step = nextStepFor(
      decision({ outcome: 'DENY', reason: 'CNIC_EXPIRED', missingMethods: ['LIVENESS'] }),
    );
    expect(step.screen).toBe('hard-stop');
  });

  test('FULL_KYC -> the complete onboarding wizard', () => {
    const step = nextStepFor(
      decision({
        outcome: 'FULL_KYC',
        reason: 'NO_RECORD',
        missingMethods: ['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1'],
      }),
    );
    expect(step.screen).toBe('full-onboarding');
    expect(step.remaining).toEqual(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1']);
  });

  test('a SHREDDED record routes to full onboarding, not a hard stop', () => {
    const step = nextStepFor(
      decision({ outcome: 'FULL_KYC', reason: 'SHREDDED', missingMethods: ['VERISYS'] }),
    );
    expect(step.screen).toBe('full-onboarding');
  });
});

// ===========================================================================
describe('nextStepFor — STEP_UP picks exactly one screen', () => {
  const CASES: { missing: VerificationMethod[]; screen: string }[] = [
    { missing: ['LIVENESS'], screen: 'liveness-capture' },
    { missing: ['BIOMETRIC_1TO1'], screen: 'fingerprint-capture' },
    { missing: ['DOC_AUTH'], screen: 'document-capture' },
    { missing: ['VERISYS'], screen: 'nadra-check' },
  ];

  for (const c of CASES) {
    test(`${c.missing[0]} -> ${c.screen}`, () => {
      const step = nextStepFor(
        decision({ outcome: 'STEP_UP', reason: 'ASSURANCE_LOW', missingMethods: c.missing }),
      );
      expect(step.screen).toBe(c.screen);
      expect(step.method).toBe(c.missing[0]);
      expect(step.remaining).toEqual([]);
    });
  }

  test('A2 -> A3 reports the fingerprint and NADRA checks as skipped', () => {
    const step = nextStepFor(
      decision({
        outcome: 'STEP_UP',
        reason: 'ASSURANCE_LOW',
        missingMethods: ['LIVENESS'],
        currentAssurance: 'A2',
        requiredAssurance: 'A3',
      }),
    );
    expect(step.method).toBe('LIVENESS');
    expect(step.skipped).toEqual(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1']);
  });

  test('several missing methods route to the weakest first, strongest last', () => {
    const step = nextStepFor(
      decision({
        outcome: 'STEP_UP',
        reason: 'ASSURANCE_LOW',
        // Deliberately out of order — the frontend must not depend on the
        // gateway's array order for a compliance-relevant sequence.
        missingMethods: ['LIVENESS', 'VERISYS', 'BIOMETRIC_1TO1'],
        requiredAssurance: 'A3',
      }),
    );
    expect(step.method).toBe('VERISYS');
    expect(step.remaining).toEqual(['BIOMETRIC_1TO1', 'LIVENESS']);
  });

  test('a STEP_UP naming no method fails safe to full onboarding', () => {
    // A gateway defect. Over-verifying is the only acceptable direction to
    // fail in: the alternative is letting somebody through unchecked.
    const step = nextStepFor(
      decision({ outcome: 'STEP_UP', reason: 'ASSURANCE_LOW', missingMethods: [] }),
    );
    expect(step.screen).toBe('full-onboarding');
  });

  test('a STALE record re-affirms only its strongest method', () => {
    const step = nextStepFor(
      decision({
        outcome: 'STEP_UP',
        reason: 'STALE',
        missingMethods: ['LIVENESS'],
        requiredAssurance: 'A3',
      }),
    );
    expect(step.screen).toBe('liveness-capture');
    expect(step.remaining).toEqual([]);
  });
});

// ===========================================================================
describe('sortMethods', () => {
  test('orders weakest to strongest regardless of input order', () => {
    expect(sortMethods(['LIVENESS', 'VERISYS', 'BIOMETRIC_1TO1', 'DOC_AUTH'])).toEqual([
      'VERISYS',
      'DOC_AUTH',
      'BIOMETRIC_1TO1',
      'LIVENESS',
    ]);
  });

  test('does not mutate its input', () => {
    const input: VerificationMethod[] = ['LIVENESS', 'VERISYS'];
    sortMethods(input);
    expect(input).toEqual(['LIVENESS', 'VERISYS']);
  });
});

// ===========================================================================
describe('attempt cap — 3 per subject per method per day', () => {
  test('only biometric and liveness are capped', () => {
    expect(isCapped('BIOMETRIC_1TO1')).toBe(true);
    expect(isCapped('LIVENESS')).toBe(true);
    // A NADRA record match is a lookup, not a biometric probe. Capping it
    // would block a customer for a reason that protects nothing.
    expect(isCapped('VERISYS')).toBe(false);
    expect(isCapped('DOC_AUTH')).toBe(false);
  });

  test('starts at three and decrements per attempt', () => {
    expect(attemptsRemaining(SUBJECT, 'LIVENESS', TODAY)).toBe(DAILY_ATTEMPT_CAP);

    recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    expect(attemptsRemaining(SUBJECT, 'LIVENESS', TODAY)).toBe(2);
    expect(isLockedOut(SUBJECT, 'LIVENESS', TODAY)).toBe(false);

    recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    expect(attemptsRemaining(SUBJECT, 'LIVENESS', TODAY)).toBe(0);
    expect(isLockedOut(SUBJECT, 'LIVENESS', TODAY)).toBe(true);
  });

  test('a fourth attempt cannot drive the count negative', () => {
    for (let i = 0; i < 6; i++) recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    expect(attemptsRemaining(SUBJECT, 'LIVENESS', TODAY)).toBe(0);
  });

  test('the cap is per method — liveness lockout does not block fingerprint', () => {
    for (let i = 0; i < 3; i++) recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    expect(isLockedOut(SUBJECT, 'LIVENESS', TODAY)).toBe(true);
    expect(isLockedOut(SUBJECT, 'BIOMETRIC_1TO1', TODAY)).toBe(false);
  });

  test('the cap is per subject', () => {
    for (let i = 0; i < 3; i++) recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    expect(isLockedOut('b'.repeat(64), 'LIVENESS', TODAY)).toBe(false);
  });

  test('the cap resets the next day', () => {
    for (let i = 0; i < 3; i++) recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    expect(isLockedOut(SUBJECT, 'LIVENESS', TODAY)).toBe(true);
    expect(attemptsRemaining(SUBJECT, 'LIVENESS', TOMORROW)).toBe(DAILY_ATTEMPT_CAP);
  });

  test('uncapped methods are never locked out', () => {
    for (let i = 0; i < 10; i++) recordAttempt(SUBJECT, 'VERISYS', TODAY);
    expect(isLockedOut(SUBJECT, 'VERISYS', TODAY)).toBe(false);
    expect(attemptsUsed(SUBJECT, 'VERISYS', TODAY)).toBe(0);
  });
});
