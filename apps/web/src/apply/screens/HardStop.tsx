import { XCircle } from 'lucide-react';
import type { DecisionReason } from '../../lib/api.ts';

/**
 * The DENY destination.
 *
 * A hard stop, with no retry affordance anywhere on the screen. Offering one
 * would be dishonest: nothing the customer does in this app clears a
 * compliance freeze or an expired CNIC, and a button that cannot work erodes
 * trust faster than the refusal itself.
 *
 * The reason is always named. "We can't proceed" without a reason sends the
 * customer to a branch to find out what a screen could have told them, and
 * reads as arbitrary.
 */

interface StopCopy {
  headline: string;
  explanation: string;
  whatToDo: string;
}

const COPY: Record<string, StopCopy> = {
  CNIC_EXPIRED: {
    headline: 'Your CNIC has expired',
    explanation:
      'We cannot open or extend a facility against an expired identity card. This is a regulatory requirement and applies regardless of how long you have banked with us.',
    whatToDo:
      'Renew your CNIC at any NADRA centre or through the Pak-ID app, then come back and we will pick up where you left off — you will not have to start over.',
  },
  SUSPENDED: {
    headline: 'This application is on hold',
    explanation:
      'Your identity record is currently under review by our compliance team. New applications cannot proceed while that review is open.',
    whatToDo:
      'Our team will contact you directly. If you need this urgently, call ABHI support and quote your account number.',
  },
};

const FALLBACK: StopCopy = {
  headline: 'We cannot proceed with this application',
  explanation: 'Your identity record does not currently permit this product.',
  whatToDo: 'Please contact ABHI support, who can explain what is needed.',
};

export function HardStop({ reason }: { reason: DecisionReason | null }) {
  const copy = (reason === null ? undefined : COPY[reason]) ?? FALLBACK;

  return (
    <section
      className="card border-stop-line p-6"
      data-testid="hard-stop"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-4">
        <XCircle size={30} className="mt-0.5 shrink-0 text-stop-fg" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-semibold text-stop-fg">{copy.headline}</h2>
          <p className="mt-2 max-w-prose text-body leading-6 text-ink-900">{copy.explanation}</p>

          <h3 className="mt-5 text-cell font-semibold text-ink-900">What you can do</h3>
          <p className="mt-1 max-w-prose text-body leading-6 text-ink-700">{copy.whatToDo}</p>
        </div>
      </div>
    </section>
  );
}
