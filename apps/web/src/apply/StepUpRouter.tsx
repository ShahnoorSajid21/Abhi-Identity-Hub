import { useState } from 'react';
import { SkipForward } from 'lucide-react';
import type { VerificationMethod } from '../lib/api.ts';
import { METHODS, PRODUCTS } from '../copy/strings.ts';
import { nextStepFor, type NextStep, type VerifyResult } from '../lib/verify.ts';
import { CaptureScreen } from './screens/CaptureScreen.tsx';
import { ReviewDetails } from './screens/ReviewDetails.tsx';
import { HardStop } from './screens/HardStop.tsx';
import { OnboardingWizard } from './screens/OnboardingWizard.tsx';

/**
 * Step-up routing.
 *
 * Given a VerifyKYC result, render exactly one screen: the next thing this
 * customer actually has to do. Screens for checks the ledger already holds are
 * never mounted — not hidden, not disabled, not mounted — so there is no path
 * by which a stale render or a mis-set flag could put a customer back through
 * a fingerprint scan they passed last month.
 *
 * The routing rule itself lives in lib/verify.ts as a pure function. This
 * component only mounts what that rule selected.
 */

/** "A", "A and B", "A, B and C" — never "A and B and C". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function StepUpRouter({
  result,
  productId,
  onFinished,
  onCheckComplete,
  onBack,
  onExit,
  now,
}: {
  result: VerifyResult;
  productId: string;
  /** Fired when the customer clears the last outstanding check. */
  onFinished?: (completed: VerificationMethod[]) => void;
  /** Fired for EACH check the customer clears — this is what the dashboard reads. */
  onCheckComplete?: (method: VerificationMethod) => void;
  /** Pre-confirm Back on the review screen. */
  onBack?: () => void;
  /** Leave for the customer's profile once the application is confirmed. */
  onExit?: () => void;
  /** Injectable clock for the attempt cap. Tests pass a fixed date. */
  now?: Date;
}) {
  const initial = nextStepFor(result.decision);
  const [step, setStep] = useState<NextStep>(initial);
  const [completed, setCompleted] = useState<VerificationMethod[]>([]);

  function completeCurrent(method: VerificationMethod) {
    // Report every check the moment it passes, not just the last one, so the
    // internal dashboard can show "CNIC done, fingerprint pending" while the
    // customer is still mid-journey.
    onCheckComplete?.(method);
    const done = [...completed, method];
    setCompleted(done);

    // Walk the remaining queue. In practice a step-up is one method, but an
    // A0 record stepping to A2 legitimately has three, and the customer should
    // move straight from one to the next without returning to the gateway.
    if (step.remaining.length === 0) {
      onFinished?.(done);
      setStep({ screen: 'review', method: null, remaining: [], skipped: step.skipped });
      return;
    }
    const [next, ...rest] = step.remaining;
    setStep(nextStepFor({ ...result.decision, missingMethods: [next!, ...rest] }));
  }

  const product = PRODUCTS[productId] ?? productId;

  return (
    <div data-testid="step-up-router" data-screen={step.screen}>
      {step.skipped.length > 0 && step.screen !== 'review' && (
        <p
          className="mb-4 flex items-start gap-2 rounded-control border border-ok-line bg-ok-bg px-4 py-3 text-cell leading-6 text-ok-fg"
          data-testid="skipped-notice"
        >
          <SkipForward size={16} className="mt-1 shrink-0" aria-hidden="true" />
          <span>
            {/* The saving, named. This is the sentence the whole programme
                exists to be able to put in front of a customer. Method labels
                keep their own casing — lowercasing them turns NADRA and CNIC
                into words that read as typos. */}
            We already have your {joinList(step.skipped.map((m) => METHODS[m] ?? m))}
            {step.skipped.length === 1 ? '' : ' checks'}, so we will not ask again. Just one more
            step for {product}.
          </span>
        </p>
      )}

      {step.screen === 'review' && (
        <ReviewDetails
          result={result}
          productId={productId}
          // Reached by finishing captures, not straight from an ALLOW — the
          // screen says different things about each.
          steppedUp={completed.length > 0}
          {...(onBack ? { onBack } : {})}
          {...(onExit ? { onExit } : {})}
        />
      )}

      {step.screen === 'hard-stop' && <HardStop reason={result.decision.reason} />}

      {step.screen === 'full-onboarding' && (
        <OnboardingWizard
          methods={step.remaining.length > 0 ? step.remaining : result.decision.missingMethods}
          onComplete={(done) => onFinished?.(done)}
        />
      )}

      {step.method !== null && step.method !== 'ASSERTED' && (
        <CaptureScreen
          method={step.method}
          subjectId={result.subjectId}
          onComplete={(r) => completeCurrent(r.method)}
          {...(now ? { now } : {})}
        />
      )}
    </div>
  );
}
