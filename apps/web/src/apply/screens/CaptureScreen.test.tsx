import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaptureScreen } from './CaptureScreen.tsx';
import { DAILY_ATTEMPT_CAP, recordAttempt } from '../../lib/verify.ts';

/**
 * PHASE-4 · biometric and liveness attempt cap.
 *
 * The gateway is the authority — it returns ERR_ATTEMPT_CAP_EXCEEDED and that
 * is what actually protects NADRA's rate limits. What is tested here is the
 * customer-facing half: warned before the last attempt is burned, and given an
 * explanation rather than a dead button once it is.
 */

const SUBJECT = 'a'.repeat(64);
const TODAY = new Date('2026-08-19T09:00:00');

function mount(method: 'LIVENESS' | 'BIOMETRIC_1TO1' | 'VERISYS' = 'LIVENESS') {
  const onComplete = vi.fn();
  render(
    <CaptureScreen method={method} subjectId={SUBJECT} onComplete={onComplete} now={TODAY} />,
  );
  return onComplete;
}

// ===========================================================================
describe('PHASE-4 · attempt cap', () => {
  test('shows the remaining count on a capped method', () => {
    mount('LIVENESS');
    expect(screen.getByTestId('attempts-remaining')).toHaveTextContent(
      `3 of ${DAILY_ATTEMPT_CAP} attempts remaining today`,
    );
  });

  test('an uncapped method shows no counter', () => {
    mount('VERISYS');
    expect(screen.queryByTestId('attempts-remaining')).not.toBeInTheDocument();
  });

  test('a failed attempt is counted, not just a successful one', async () => {
    const user = userEvent.setup();
    mount('LIVENESS');

    await user.click(screen.getByRole('button', { name: /simulate a failed attempt/i }));
    // Counting only failures would let an attacker probe indefinitely by
    // alternating success and failure.
    expect(screen.getByTestId('attempts-remaining')).toHaveTextContent('2 of 3');
    expect(screen.getByTestId('capture-failed')).toBeInTheDocument();
  });

  test('the last attempt is called out before it is used', async () => {
    const user = userEvent.setup();
    mount('LIVENESS');

    await user.click(screen.getByRole('button', { name: /simulate a failed attempt/i }));
    await user.click(screen.getByRole('button', { name: /simulate a failed attempt/i }));
    expect(screen.getByTestId('attempts-remaining')).toHaveTextContent(/this is your last attempt/i);
  });

  test('the third failure locks the method out and removes every button', async () => {
    const user = userEvent.setup();
    mount('LIVENESS');

    for (let i = 0; i < DAILY_ATTEMPT_CAP; i++) {
      await user.click(screen.getByRole('button', { name: /simulate a failed attempt/i }));
    }

    expect(screen.getByTestId('attempt-cap-reached')).toBeInTheDocument();
    expect(screen.getByText(/used all 3 attempts for today/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start face verification/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('attempts-remaining')).not.toBeInTheDocument();
  });

  test('a customer who arrives already locked out never sees a capture button', () => {
    for (let i = 0; i < DAILY_ATTEMPT_CAP; i++) recordAttempt(SUBJECT, 'LIVENESS', TODAY);
    mount('LIVENESS');

    expect(screen.getByTestId('attempt-cap-reached')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('the lockout names a way forward rather than only refusing', () => {
    for (let i = 0; i < DAILY_ATTEMPT_CAP; i++) recordAttempt(SUBJECT, 'BIOMETRIC_1TO1', TODAY);
    mount('BIOMETRIC_1TO1');

    expect(screen.getByText(/try again tomorrow, or visit any ABHI branch/i)).toBeInTheDocument();
  });

  test('a success reports the attribute it wrote', async () => {
    const user = userEvent.setup();
    const onComplete = mount('LIVENESS');

    await user.click(screen.getByRole('button', { name: /start face verification/i }));
    expect(onComplete).toHaveBeenCalledWith({
      method: 'LIVENESS',
      attribute: 'liveness_pass',
      passed: true,
    });
  });
});
