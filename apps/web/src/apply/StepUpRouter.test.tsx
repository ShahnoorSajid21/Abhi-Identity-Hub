import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepUpRouter } from './StepUpRouter.tsx';
import {
  ALLOW,
  DENY_CNIC_EXPIRED,
  DENY_SUSPENDED,
  FULL_KYC,
  STEP_UP_BIOMETRIC,
  STEP_UP_LIVENESS,
  stepUpWith,
} from '../test/fixtures.ts';

/**
 * PHASE-4 · dynamic step-up routing.
 *
 * Each test mounts the router with one of the four VerifyKYC outcomes and
 * asserts the screen. The negative assertions carry as much weight as the
 * positive ones: proving the liveness screen renders is only half the claim,
 * and the half that saves no money. The other half is that the fingerprint
 * scanner is NOT in the tree — not hidden, not disabled, absent.
 */

function mount(result: Parameters<typeof StepUpRouter>[0]['result'], productId = 'SBL') {
  return render(<StepUpRouter result={result} productId={productId} />);
}

// ===========================================================================
describe('PHASE-4 · ALLOW', () => {
  test('goes straight to the product review screen', () => {
    mount(ALLOW, 'EWA');

    expect(screen.getByTestId('review-details')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /review your earned wage access details/i })).toBeInTheDocument();
  });

  test('renders no capture screen at all', () => {
    mount(ALLOW, 'EWA');

    for (const id of ['nadra-check', 'document-capture', 'fingerprint-capture', 'liveness-capture']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId('full-onboarding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hard-stop')).not.toBeInTheDocument();
  });

  test('states that the credit check still ran', () => {
    mount(ALLOW, 'EWA');
    expect(screen.getByText(/credit record was still checked with e-CIB/i)).toBeInTheDocument();
  });
});

// ===========================================================================
describe('PHASE-4 · STEP_UP renders ONLY the missing check', () => {
  test('A2 -> A3 for SBL jumps straight to live-selfie face verification', () => {
    mount(STEP_UP_LIVENESS, 'SBL');

    expect(screen.getByTestId('step-up-router')).toHaveAttribute('data-screen', 'liveness-capture');
    expect(screen.getByTestId('liveness-capture')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /live selfie verification/i })).toBeInTheDocument();
  });

  test('the fingerprint scanner is bypassed, not merely hidden', () => {
    mount(STEP_UP_LIVENESS, 'SBL');

    // The A2 record already holds BIOMETRIC_1TO1. Mounting that screen — even
    // disabled — would put a customer back through a check the ledger proves
    // they passed, which is precisely the cost this system exists to remove.
    expect(screen.queryByTestId('fingerprint-capture')).not.toBeInTheDocument();
    expect(screen.queryByText(/place your thumb on the scanner/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('document-capture')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nadra-check')).not.toBeInTheDocument();
    expect(screen.queryByTestId('full-onboarding')).not.toBeInTheDocument();
  });

  test('tells the customer which checks were skipped', () => {
    mount(STEP_UP_LIVENESS, 'SBL');

    const notice = screen.getByTestId('skipped-notice');
    expect(notice).toHaveTextContent(/nadra record match/i);
    expect(notice).toHaveTextContent(/fingerprint match/i);
    expect(notice).toHaveTextContent(/will not ask again/i);
  });

  test('A1 -> A2 for EWA routes to the fingerprint screen, not the selfie', () => {
    mount(STEP_UP_BIOMETRIC, 'EWA');

    expect(screen.getByTestId('step-up-router')).toHaveAttribute('data-screen', 'fingerprint-capture');
    expect(screen.getByTestId('fingerprint-capture')).toBeInTheDocument();
    expect(screen.queryByTestId('liveness-capture')).not.toBeInTheDocument();
  });

  test('a multi-method step-up advances one screen at a time, in order', async () => {
    const user = userEvent.setup();
    // An A0 employer-asserted record stepping up to A2.
    mount(stepUpWith(['VERISYS', 'DOC_AUTH', 'BIOMETRIC_1TO1'], 'A2'), 'EWA');

    expect(screen.getByTestId('nadra-check')).toBeInTheDocument();
    expect(screen.queryByTestId('document-capture')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /run the nadra check/i }));
    expect(screen.getByTestId('document-capture')).toBeInTheDocument();
    expect(screen.queryByTestId('nadra-check')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /capture cnic/i }));
    expect(screen.getByTestId('fingerprint-capture')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /scan fingerprint/i }));
    expect(screen.getByTestId('review-details')).toBeInTheDocument();
  });

  test('clearing the last check lands on the review screen', async () => {
    const user = userEvent.setup();
    mount(STEP_UP_LIVENESS, 'SBL');

    await user.click(screen.getByRole('button', { name: /start face verification/i }));
    expect(screen.getByTestId('review-details')).toBeInTheDocument();
    expect(screen.queryByTestId('liveness-capture')).not.toBeInTheDocument();
  });
});

// ===========================================================================
describe('PHASE-4 · FULL_KYC', () => {
  test('launches the complete Asaan Digital Account wizard', () => {
    mount(FULL_KYC, 'EWA');

    expect(screen.getByTestId('step-up-router')).toHaveAttribute('data-screen', 'full-onboarding');
    expect(screen.getByTestId('full-onboarding')).toBeInTheDocument();
    expect(screen.getByText(/open an asaan digital account/i)).toBeInTheDocument();
  });

  test('shows every stage of the journey, not just the next one', () => {
    mount(FULL_KYC, 'EWA');

    const stages = screen.getByTestId('onboarding-stages');
    expect(stages).toHaveTextContent(/your details/i);
    expect(stages).toHaveTextContent(/nadra/i);
    expect(stages).toHaveTextContent(/cnic/i);
    expect(stages).toHaveTextContent(/fingerprint/i);
  });

  test('shows no skipped-checks notice — nothing was skipped', () => {
    mount(FULL_KYC, 'EWA');
    expect(screen.queryByTestId('skipped-notice')).not.toBeInTheDocument();
  });

  test('walks through every stage in order', async () => {
    const user = userEvent.setup();
    mount(FULL_KYC, 'EWA');

    expect(screen.getByRole('heading', { name: /your details/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('heading', { name: /nadra/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('heading', { name: /photograph your cnic/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('heading', { name: /fingerprint verification/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish and open my account/i })).toBeInTheDocument();
  });
});

// ===========================================================================
describe('PHASE-4 · DENY', () => {
  test('renders a hard-stop screen naming the expired CNIC', () => {
    mount(DENY_CNIC_EXPIRED, 'SBL');

    expect(screen.getByTestId('step-up-router')).toHaveAttribute('data-screen', 'hard-stop');
    expect(screen.getByTestId('hard-stop')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /your cnic has expired/i })).toBeInTheDocument();
    expect(screen.getByText(/renew your cnic at any nadra centre/i)).toBeInTheDocument();
  });

  test('offers no retry — nothing the customer does here can clear it', () => {
    mount(DENY_CNIC_EXPIRED, 'SBL');

    expect(screen.queryByTestId('liveness-capture')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fingerprint-capture')).not.toBeInTheDocument();
    expect(screen.queryByTestId('full-onboarding')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('a compliance freeze gets its own explanation, not the CNIC copy', () => {
    mount(DENY_SUSPENDED, 'EWA');

    expect(screen.getByRole('heading', { name: /this application is on hold/i })).toBeInTheDocument();
    expect(screen.queryByText(/cnic has expired/i)).not.toBeInTheDocument();
  });

  test('the stop is announced to assistive technology', () => {
    mount(DENY_CNIC_EXPIRED, 'SBL');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });
});
