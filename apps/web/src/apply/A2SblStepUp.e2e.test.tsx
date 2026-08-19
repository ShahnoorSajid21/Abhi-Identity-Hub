import { describe, test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApplyPage } from '../pages/ApplyPage.tsx';
import { SUBJECT_A2 } from '../test/fixtures.ts';

/**
 * PHASE-5 · An A2 customer applies for a Salary-Backed Loan — frontend half.
 *
 * The backend half lives in tests/e2e/a2-sbl-stepup.test.ts and asserts, over
 * real HTTP, that this exact request produces this exact response. The body
 * stubbed below is that response, copied deliberately rather than imported:
 * if the gateway's shape ever changes, the backend test goes red and points
 * at the drift instead of the two silently agreeing on a stale contract.
 *
 * What this half proves is the part no backend test can: that the customer
 * lands on face verification, and that the fingerprint scanner they already
 * passed is never put in front of them again.
 *
 * The journey runs through ApplyPage — the real route component, real fetch
 * client, real routing rule. Only the network is stubbed.
 */

/** Exactly what POST /kyc/verify returns for this subject and product. */
const GATEWAY_RESPONSE = {
  subjectId: SUBJECT_A2,
  decision: {
    outcome: 'STEP_UP',
    reason: 'ASSURANCE_LOW',
    missingMethods: ['LIVENESS'],
    disclosableAttributes: [],
    ageDays: 34,
    currentAssurance: 'A2',
    requiredAssurance: 'A3',
    policyId: 'SBL@v1',
  },
  proof: null,
  railCallsAvoided: 0,
  costAvoidedPkr: 0,
  eCibCalled: true,
};

function renderJourney() {
  const fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(GATEWAY_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);

  render(
    <MemoryRouter initialEntries={[`/apply/SBL?subjectId=${SUBJECT_A2}`]}>
      <Routes>
        <Route path="/apply/:productId" element={<ApplyPage />} />
      </Routes>
    </MemoryRouter>,
  );

  return fetchSpy;
}

// ===========================================================================
describe('PHASE-5 · A2 customer applying for SBL — the journey', () => {
  test('asks the gateway once, by subject id, sending no CNIC', async () => {
    const fetchSpy = renderJourney();
    await waitFor(() => expect(screen.getByTestId('step-up-router')).toBeInTheDocument());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/kyc/verify');
    expect(init.method).toBe('POST');

    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ subjectId: SUBJECT_A2, productId: 'SBL' });
    expect(init.body).not.toContain('cnic');
  });

  test('the state transitions directly to face verification', async () => {
    renderJourney();

    await waitFor(() =>
      expect(screen.getByTestId('step-up-router')).toHaveAttribute('data-screen', 'liveness-capture'),
    );
    expect(screen.getByTestId('liveness-capture')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /live selfie verification/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start face verification/i })).toBeInTheDocument();
  });

  test('the fingerprint scanner is bypassed entirely', async () => {
    renderJourney();
    await waitFor(() => expect(screen.getByTestId('liveness-capture')).toBeInTheDocument());

    // Absent from the tree, not merely hidden or disabled. This customer's
    // fingerprint is on the ledger; asking for it again is the exact cost the
    // programme exists to remove.
    expect(screen.queryByTestId('fingerprint-capture')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /fingerprint verification/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /scan fingerprint/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/place your thumb on the scanner/i)).not.toBeInTheDocument();
  });

  test('no other stage of onboarding is rendered either', async () => {
    renderJourney();
    await waitFor(() => expect(screen.getByTestId('liveness-capture')).toBeInTheDocument());

    expect(screen.queryByTestId('nadra-check')).not.toBeInTheDocument();
    expect(screen.queryByTestId('document-capture')).not.toBeInTheDocument();
    expect(screen.queryByTestId('full-onboarding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hard-stop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-details')).not.toBeInTheDocument();
  });

  test('the customer is told what was reused, so the skip is visible not silent', async () => {
    renderJourney();
    await waitFor(() => expect(screen.getByTestId('skipped-notice')).toBeInTheDocument());

    const notice = screen.getByTestId('skipped-notice');
    expect(notice).toHaveTextContent(/nadra record match/i);
    expect(notice).toHaveTextContent(/cnic document check/i);
    expect(notice).toHaveTextContent(/fingerprint match/i);
    expect(notice).toHaveTextContent(/just one more step for salary-backed lending/i);
  });

  test('the selfie is capped at three attempts, and the third exhausts it', async () => {
    const user = userEvent.setup();
    renderJourney();
    await waitFor(() => expect(screen.getByTestId('liveness-capture')).toBeInTheDocument());

    expect(screen.getByTestId('attempts-remaining')).toHaveTextContent('3 of 3');
    await user.click(screen.getByRole('button', { name: /simulate a failed attempt/i }));
    await user.click(screen.getByRole('button', { name: /simulate a failed attempt/i }));
    expect(screen.getByTestId('attempts-remaining')).toHaveTextContent(/last attempt/i);

    await user.click(screen.getByRole('button', { name: /simulate a failed attempt/i }));
    expect(screen.getByTestId('attempt-cap-reached')).toBeInTheDocument();
  });

  test('completing the selfie advances to the SBL review screen', async () => {
    const user = userEvent.setup();
    renderJourney();
    await waitFor(() => expect(screen.getByTestId('liveness-capture')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /start face verification/i }));

    expect(screen.getByTestId('review-details')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /review your salary-backed lending details/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('liveness-capture')).not.toBeInTheDocument();
  });

  test('the product name is on screen throughout — the customer knows what they applied for', async () => {
    renderJourney();
    await waitFor(() => expect(screen.getByTestId('liveness-capture')).toBeInTheDocument());

    expect(
      screen.getByRole('heading', { level: 1, name: /salary-backed lending/i }),
    ).toBeInTheDocument();
  });
});
