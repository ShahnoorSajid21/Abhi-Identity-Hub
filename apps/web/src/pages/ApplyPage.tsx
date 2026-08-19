import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../lib/api.ts';
import { verifyKyc, type VerifyResult } from '../lib/verify.ts';
import { PRODUCTS } from '../copy/strings.ts';
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
 */
export function ApplyPage() {
  const { productId = '' } = useParams();
  const [params] = useSearchParams();
  const subjectId = params.get('subjectId') ?? '';

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

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

  const product = PRODUCTS[productId] ?? productId;

  return (
    <>
      <p className="label-caption">Apply for</p>
      <h1 className="mt-1 text-title font-semibold text-ink-900">{product}</h1>

      <div className="mt-6">
        {loading && (
          <div className="card p-6 text-cell text-ink-500" data-testid="apply-loading">
            Checking what we already have on file…
          </div>
        )}

        {!loading && error !== null && <ErrorState error={error} onRetry={() => void load()} />}

        {!loading && error === null && result !== null && (
          <StepUpRouter result={result} productId={productId} />
        )}
      </div>
    </>
  );
}
