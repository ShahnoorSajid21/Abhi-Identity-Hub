import { useState } from 'react';
import { Fingerprint, ScanFace, FileCheck2, BadgeCheck, type LucideIcon } from 'lucide-react';
import type { VerificationMethod } from '../../lib/api.ts';
import {
  DAILY_ATTEMPT_CAP,
  attemptsRemaining,
  isCapped,
  recordAttempt,
} from '../../lib/verify.ts';

/**
 * One capture screen per verification method.
 *
 * These are POC stand-ins for real capture hardware: the fingerprint screen
 * would drive a Morpho/Mantra scanner and the liveness screen a camera with
 * an active-liveness SDK. The button below simulates the rail returning a
 * result. What is NOT simulated is the surrounding behaviour — the attempt
 * cap, the lockout copy, and the fact that only this one screen is shown —
 * because that is the part the step-up routing is being judged on.
 */

interface Spec {
  icon: LucideIcon;
  title: string;
  /** What the customer is being asked to do, in their words. */
  instruction: string;
  /** The attribute this capture writes on success. */
  attribute: string;
  action: string;
  testId: string;
}

export const CAPTURE_SPEC: Record<Exclude<VerificationMethod, 'ASSERTED'>, Spec> = {
  VERISYS: {
    icon: BadgeCheck,
    title: 'Checking your details with NADRA',
    instruction:
      'We are matching the details on your CNIC against NADRA’s record. Nothing is needed from you — this usually takes a few seconds.',
    attribute: 'verisys_match',
    action: 'Run the NADRA check',
    testId: 'nadra-check',
  },
  DOC_AUTH: {
    icon: FileCheck2,
    title: 'Photograph your CNIC',
    instruction:
      'Place your CNIC on a flat surface in good light and capture both sides. We check the card is genuine, not just readable.',
    attribute: 'document_authenticity_pass',
    action: 'Capture CNIC',
    testId: 'document-capture',
  },
  BIOMETRIC_1TO1: {
    icon: Fingerprint,
    title: 'Fingerprint verification',
    instruction:
      'Place your thumb on the scanner and hold still until it beeps. We match it against the fingerprint NADRA holds for you.',
    attribute: 'biometric_match',
    action: 'Scan fingerprint',
    testId: 'fingerprint-capture',
  },
  LIVENESS: {
    icon: ScanFace,
    title: 'Live selfie verification',
    instruction:
      'Look straight at the camera and follow the prompt on screen. This confirms a real person is here right now, not a photograph.',
    attribute: 'liveness_pass',
    action: 'Start face verification',
    testId: 'liveness-capture',
  },
};

export function CaptureScreen({
  method,
  subjectId,
  onComplete,
  now = new Date(),
}: {
  method: Exclude<VerificationMethod, 'ASSERTED'>;
  subjectId: string;
  onComplete: (result: { method: VerificationMethod; attribute: string; passed: boolean }) => void;
  /** Injectable for tests; the cap is a per-calendar-day counter. */
  now?: Date;
}) {
  const spec = CAPTURE_SPEC[method];
  const IconComponent = spec.icon;

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [remaining, setRemaining] = useState(() => attemptsRemaining(subjectId, method, now));

  const capped = isCapped(method);
  const lockedOut = capped && remaining <= 0;

  function run(passed: boolean) {
    if (lockedOut) return;
    setBusy(true);
    setFailed(false);

    // A real capture consumes an attempt whether it succeeds or fails —
    // counting only failures would let an attacker probe indefinitely by
    // alternating.
    if (capped) setRemaining(Math.max(0, DAILY_ATTEMPT_CAP - recordAttempt(subjectId, method, now)));

    if (passed) {
      onComplete({ method, attribute: spec.attribute, passed: true });
    } else {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <section className="card p-6" data-testid={spec.testId}>
      <div className="flex items-start gap-4">
        <IconComponent size={30} className="mt-0.5 shrink-0 text-mint-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-section font-semibold text-ink-900">{spec.title}</h2>
          <p className="mt-2 max-w-prose text-body leading-6 text-ink-700">{spec.instruction}</p>
        </div>
      </div>

      {capped && !lockedOut && (
        <p
          className="mt-5 rounded-control border border-warn-line bg-warn-bg px-3 py-2 text-cell text-warn-fg"
          data-testid="attempts-remaining"
        >
          {remaining === 1
            ? 'This is your last attempt today. If it does not work, please try again tomorrow or visit a branch.'
            : `${remaining} of ${DAILY_ATTEMPT_CAP} attempts remaining today.`}
        </p>
      )}

      {lockedOut ? (
        <div
          className="mt-5 rounded-control border border-stop-line bg-stop-bg px-4 py-3"
          data-testid="attempt-cap-reached"
        >
          <p className="text-body font-semibold text-stop-fg">
            You have used all {DAILY_ATTEMPT_CAP} attempts for today
          </p>
          <p className="mt-1 text-cell leading-6 text-ink-700">
            {/* Named so the customer knows the limit is deliberate and
                temporary, not a fault with their identity. */}
            This limit protects your account. Please try again tomorrow, or visit any ABHI branch
            where a colleague can complete this for you.
          </p>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(true)}
            className="rounded-control bg-mint-600 px-4 py-2 text-cell font-medium text-white transition-opacity duration-fast hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Checking…' : spec.action}
          </button>
          {/* POC affordance only — a real device reports its own outcome. It
              is here so the attempt cap and the failure path are demonstrable
              without a scanner on the table. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(false)}
            className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:text-ink-900 disabled:opacity-40"
          >
            Simulate a failed attempt
          </button>
        </div>
      )}

      {failed && !lockedOut && (
        <p className="mt-4 text-cell text-stop-fg" data-testid="capture-failed">
          That did not match. Please try once more.
        </p>
      )}
    </section>
  );
}
