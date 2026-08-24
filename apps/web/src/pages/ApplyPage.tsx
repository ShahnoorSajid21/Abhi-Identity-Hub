import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { api, directory, ApiError, type VerificationMethod } from '../lib/api.ts';
import { verifyKyc, type VerifyResult } from '../lib/verify.ts';
import { recordCheckComplete } from '../lib/applications.ts';
import { isAssuranceLevel, stepUpAttributes } from '../lib/readiness.ts';
import { LEVELS, METHODS, PRODUCTS } from '../copy/strings.ts';
import { StepUpRouter } from '../apply/StepUpRouter.tsx';
import { ErrorState } from '../components/ErrorState.tsx';

/**
 * A product request flow: /apply/:productId?subjectId=…
 *
 * One call to VerifyKYC, then the answer decides the screen. There is no
 * client-side branching on assurance level anywhere in this file — the
 * gateway owns that judgement, and duplicating it here would create a second
 * policy engine that drifts from the one Compliance signed off.
 *
 * The customer is addressed by subject id. A CNIC in a URL ends up in browser
 * history, in every referrer header the page emits, and in the access log of
 * anything between here and the gateway.
 *
 * WHERE THE LEDGER WRITE HAPPENS. When the customer clears the last check they
 * owed, this page commits the step-up — POST /kyc/update, appending a new
 * version to their identity record. That belongs here rather than on the
 * operator's profile because the customer is the one who performed the checks;
 * an internal user pressing a button to record work they did not do is exactly
 * the confusion this rebuild removed. The profile watches the result arrive.
 */

interface Committed {
  assuranceLevel: string;
  methodsRun: VerificationMethod[];
}

export function ApplyPage() {
  const { productId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const subjectId = params.get('subjectId') ?? '';

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await verifyKyc({ subjectId, productId }));
    } catch (e) {
      if (e instanceof ApiError) setError(e);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, [subjectId, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Commit the finished step-up to the ledger.
   *
   * The gateway decides for itself which rails to run — it recomputes the
   * missing methods from the record it holds and ignores any claim made here —
   * so this call supplies the attribute set and the target level, not a list
   * of checks to trust. `methodsRun` in the response is what actually ran.
   *
   * The CNIC expiry is read off the customer's own record and passed back
   * unchanged. It is written verbatim onto the new version, so inventing a
   * date here would quietly overwrite a real regulatory field with a guess; if
   * the record has none, this refuses rather than fabricating one.
   */
  const commitStepUp = useCallback(
    async (completed: VerificationMethod[]) => {
      if (subjectId === '' || result === null) return;

      // Step-ups only. A full onboarding has no record to append to, and the
      // call that would create one — POST /kyc/register — needs the CNIC,
      // which this journey deliberately does not hold. Firing update() here
      // would earn an ERR_SUBJECT_NOT_FOUND and tell a customer their checks
      // failed to save when the truth is that this screen was never the place
      // their record gets created.
      if (result.decision.outcome !== 'STEP_UP') return;

      setCommitting(true);
      setCommitError(null);
      try {
        const required = result.decision.requiredAssurance;
        if (!isAssuranceLevel(required)) {
          throw new Error(`The gateway asked for an unknown level (${required}).`);
        }

        const detail = await directory.customer(subjectId);
        const record = detail?.record;
        if (record === undefined || record.cnicExpiryAt === null) {
          throw new Error('This record has no CNIC expiry date on file, so it cannot be updated.');
        }

        const r = await api.update({
          subjectId,
          productId,
          attributes: stepUpAttributes(record, required),
          cnicExpiryAt: record.cnicExpiryAt,
          reason: `Customer completed ${completed.map((m) => METHODS[m] ?? m).join(' and ')} for ${productId}`,
        });

        setCommitted({ assuranceLevel: r.assuranceLevel, methodsRun: r.methodsRun });

        // Refresh the level the review screen shows. It came from the verify
        // call made before these checks ran, so leaving it alone would print
        // the old level directly beneath a banner announcing the new one. This
        // is not a re-verify: re-asking the gateway could re-route the customer
        // out of a journey they have just completed. It adopts the level the
        // write itself returned, which is the ledger's own answer.
        setResult((prev) =>
          prev === null
            ? prev
            : { ...prev, decision: { ...prev.decision, currentAssurance: r.assuranceLevel } },
        );
      } catch (e) {
        // The gateway's own message beats anything invented here —
        // ERR_ATTEMPT_CAP_EXCEEDED and ERR_SUBJECT_NOT_FOUND each say exactly
        // what went wrong and who enforced it.
        setCommitError(e instanceof ApiError ? (e.detail ?? e.code) : String(e));
      } finally {
        setCommitting(false);
      }
    },
    [subjectId, productId, result],
  );

  const product = PRODUCTS[productId] ?? productId;

  return (
    <>
      <p className="label-caption-dark">Apply for</p>
      <h1 className="mt-1 text-title font-semibold text-white">{product}</h1>

      <div className="mt-6">
        {loading && (
          <div className="card p-6 text-cell text-ink-500" data-testid="apply-loading">
            Checking what we already have on file…
          </div>
        )}

        {!loading && error !== null && <ErrorState error={error} onRetry={() => void load()} />}

        {/* The ledger write, reported as it happens. The review screen below
            still shows the level the customer arrived with — re-verifying to
            refresh it could re-route them out of a journey they have just
            finished, so the new level is stated here instead. */}
        {committing && (
          <p
            className="mb-4 flex items-center gap-2 rounded-control border border-ink-200 bg-ink-50 px-4 py-3 text-cell text-ink-700"
            data-testid="commit-pending"
          >
            <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" />
            Recording your completed checks on your identity record…
          </p>
        )}

        {committed !== null && (
          <p
            className="mb-4 flex items-start gap-2 rounded-control border border-ok-line bg-ok-bg px-4 py-3 text-cell leading-6 text-ok-fg"
            data-testid="commit-done"
          >
            <CheckCircle2 size={16} className="mt-1 shrink-0" aria-hidden="true" />
            <span>
              {committed.methodsRun.length === 0
                ? 'Your identity record was re-confirmed.'
                : `${committed.methodsRun.map((m) => METHODS[m] ?? m).join(' and ')} recorded on your identity record.`}{' '}
              {isAssuranceLevel(committed.assuranceLevel) &&
                `You are now ${LEVELS[committed.assuranceLevel].label.toLowerCase()}.`}{' '}
              Nobody will ask you for these checks again.
            </span>
          </p>
        )}

        {commitError !== null && (
          <div
            className="mb-4 rounded-control border border-stop-line bg-stop-bg px-4 py-3"
            data-testid="commit-failed"
          >
            <p className="flex items-start gap-2 text-cell leading-6 text-stop-fg">
              <AlertTriangle size={16} className="mt-1 shrink-0" aria-hidden="true" />
              <span>
                Your checks passed, but they could not be saved to your identity record —{' '}
                {commitError}
              </span>
            </p>
          </div>
        )}

        {!loading && error === null && result !== null && (
          <StepUpRouter
            result={result}
            productId={productId}
            {...(subjectId
              ? { onCheckComplete: (m) => recordCheckComplete(subjectId, productId, m) }
              : {})}
            onFinished={(completed) => void commitStepUp(completed)}
            onBack={() => navigate(-1)}
            {...(subjectId ? { onExit: () => navigate(`/customers/${subjectId}`) } : {})}
          />
        )}
      </div>
    </>
  );
}
