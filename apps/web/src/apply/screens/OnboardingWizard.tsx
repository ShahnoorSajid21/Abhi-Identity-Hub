import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { VerificationMethod } from '../../lib/api.ts';
import { CAPTURE_SPEC } from './CaptureScreen.tsx';
import { sortMethods } from '../../lib/verify.ts';

/**
 * The FULL_KYC destination: the complete Asaan Digital Account journey.
 *
 * Reached when the ledger holds nothing usable — either no record at all, or a
 * record whose vault data has been erased. Unlike a step-up, every stage runs,
 * so the wizard shows the whole path up front. A customer who can see four
 * steps and is on step two behaves very differently from one who is shown an
 * unbounded sequence of screens.
 */

const PERSONAL_DETAILS = 'personal-details';

export function OnboardingWizard({
  methods,
  onComplete,
}: {
  /** The full method pack this product's assurance level requires. */
  methods: VerificationMethod[];
  onComplete: (completed: VerificationMethod[]) => void;
}) {
  // Personal details first, then one stage per method the pack requires.
  const stages = [PERSONAL_DETAILS, ...sortMethods(methods).filter((m) => m !== 'ASSERTED')];
  const [index, setIndex] = useState(0);

  const current = stages[index]!;
  const isLast = index === stages.length - 1;

  function advance() {
    if (isLast) {
      onComplete(stages.filter((s) => s !== PERSONAL_DETAILS) as VerificationMethod[]);
      return;
    }
    setIndex(index + 1);
  }

  const title =
    current === PERSONAL_DETAILS
      ? 'Your details'
      : CAPTURE_SPEC[current as Exclude<VerificationMethod, 'ASSERTED'>].title;

  const instruction =
    current === PERSONAL_DETAILS
      ? 'We need a few details before we begin: your full name as printed on your CNIC, your date of birth, and your current address.'
      : CAPTURE_SPEC[current as Exclude<VerificationMethod, 'ASSERTED'>].instruction;

  return (
    <section className="card p-6" data-testid="full-onboarding">
      <div className="flex items-start gap-4">
        <UserPlus size={30} className="mt-0.5 shrink-0 text-new-fg" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="label-caption">Open an Asaan Digital Account</p>
          <h2 className="mt-1 text-section font-semibold text-ink-900">{title}</h2>
          <p className="mt-2 max-w-prose text-body leading-6 text-ink-700">{instruction}</p>
        </div>
      </div>

      <ol className="mt-6 flex flex-wrap gap-2" data-testid="onboarding-stages">
        {stages.map((stage, i) => (
          <li
            key={stage}
            aria-current={i === index ? 'step' : undefined}
            className={`rounded-pill px-3 py-1 text-caption font-medium ${
              i < index
                ? 'bg-ok-bg text-ok-fg'
                : i === index
                  ? 'bg-new-bg text-new-fg'
                  : 'bg-ink-100 text-ink-500'
            }`}
          >
            {i + 1}.{' '}
            {stage === PERSONAL_DETAILS
              ? 'Your details'
              : CAPTURE_SPEC[stage as Exclude<VerificationMethod, 'ASSERTED'>].title}
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={advance}
        className="mt-6 rounded-control bg-mint-600 px-4 py-2 text-cell font-medium text-white transition-opacity duration-fast hover:opacity-90"
      >
        {isLast ? 'Finish and open my account' : 'Continue'}
      </button>
    </section>
  );
}
