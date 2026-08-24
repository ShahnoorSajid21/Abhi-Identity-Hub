import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewDetails } from './ReviewDetails.tsx';
import { clearApplication, getApplication, openApplication } from '../../lib/applications.ts';
import { ALLOW } from '../../test/fixtures.ts';

/**
 * The application-details screen's two controls.
 *
 * The screen used to say "Confirm the details below to continue" and then
 * offer nothing to confirm with. These tests pin both halves of the fix: that
 * Confirm actually updates the stored confirmation status, and — the one worth
 * having a test for — that Back does not.
 */

beforeEach(() => {
  clearApplication(ALLOW.subjectId);
  localStorage.clear();
});

describe('confirming an application', () => {
  test('shows a Confirm and a Back control', () => {
    render(<ReviewDetails result={ALLOW} productId="EWA" onBack={() => {}} />);

    expect(screen.getByTestId('confirm-application')).toBeInTheDocument();
    expect(screen.getByTestId('back-to-previous')).toBeInTheDocument();
  });

  test('Confirm updates the stored confirmation status', async () => {
    const user = userEvent.setup();
    openApplication(ALLOW.subjectId, 'EWA', []);
    render(<ReviewDetails result={ALLOW} productId="EWA" />);

    expect(getApplication(ALLOW.subjectId)?.confirmedAt).toBeNull();
    await user.click(screen.getByTestId('confirm-application'));

    expect(getApplication(ALLOW.subjectId)?.confirmedAt).not.toBeNull();
  });

  test('the screen reflects the new status immediately, without a reload', async () => {
    const user = userEvent.setup();
    render(<ReviewDetails result={ALLOW} productId="EWA" />);

    await user.click(screen.getByTestId('confirm-application'));

    expect(screen.getByTestId('application-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('confirm-application')).not.toBeInTheDocument();
  });

  test('Back returns without confirming anything', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    openApplication(ALLOW.subjectId, 'EWA', []);
    render(<ReviewDetails result={ALLOW} productId="EWA" onBack={onBack} />);

    await user.click(screen.getByTestId('back-to-previous'));

    expect(onBack).toHaveBeenCalledTimes(1);
    // The whole point of the assertion: leaving must not commit.
    expect(getApplication(ALLOW.subjectId)?.confirmedAt).toBeNull();
    expect(screen.queryByTestId('application-confirmed')).not.toBeInTheDocument();
  });
});

describe('cost is not shown to the customer', () => {
  test('the screen carries no money figure', () => {
    render(<ReviewDetails result={ALLOW} productId="EWA" />);

    expect(screen.queryByText(/cost avoided/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PKR/)).not.toBeInTheDocument();
  });
});
