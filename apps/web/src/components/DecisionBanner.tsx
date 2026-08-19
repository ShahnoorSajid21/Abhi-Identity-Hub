import { AlertTriangle, CheckCircle2, UserPlus, XCircle, type LucideIcon } from 'lucide-react';
import {
  ACTIONS,
  DECISIONS,
  DECISION_GLOSSARY_TARGET,
  DECISION_REASONS,
  METHODS,
  NOTES,
} from '../copy/strings.ts';
import type { DecisionOutcome, DecisionReason } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { useGlossary } from '../lib/glossary.ts';

/**
 * The four outcomes, in plain language.
 *
 * The headline never contains the value the API returned. A viewer should be
 * able to read the banner and know what happens next without knowing that a
 * decision engine exists.
 */

const STYLES: Record<DecisionOutcome, { box: string; icon: LucideIcon; iconClass: string }> = {
  ALLOW: {
    box: 'border-ok-line bg-ok-bg',
    icon: CheckCircle2,
    iconClass: 'text-ok-fg',
  },
  STEP_UP: {
    box: 'border-warn-line bg-warn-bg',
    icon: AlertTriangle,
    iconClass: 'text-warn-fg',
  },
  FULL_KYC: {
    box: 'border-new-line bg-new-bg',
    icon: UserPlus,
    iconClass: 'text-new-fg',
  },
  DENY: {
    box: 'border-stop-line bg-stop-bg',
    icon: XCircle,
    iconClass: 'text-stop-fg',
  },
};

const TEXT: Record<DecisionOutcome, string> = {
  ALLOW: 'text-ok-fg',
  STEP_UP: 'text-warn-fg',
  FULL_KYC: 'text-new-fg',
  DENY: 'text-stop-fg',
};

/** Which glossary entry the "What does this mean?" link opens. */
function glossaryTarget(outcome: DecisionOutcome, reason: DecisionReason | null): string {
  if (outcome === 'DENY' && reason !== null) {
    const specific = DECISION_GLOSSARY_TARGET[`DENY_${reason}`];
    if (specific !== undefined) return specific;
  }
  return DECISION_GLOSSARY_TARGET[outcome] ?? 'confirmation-levels';
}

export function DecisionBanner({
  outcome,
  reason = null,
  missingMethods = [],
  cnicExpiryAt = null,
}: {
  outcome: DecisionOutcome;
  reason?: DecisionReason | null;
  /** For STEP_UP: the checks this product still needs. */
  missingMethods?: string[];
  /** For a CNIC_EXPIRED denial, so the date can be named. */
  cnicExpiryAt?: string | null;
}) {
  const openGlossary = useGlossary();
  const style = STYLES[outcome];
  const IconComponent = style.icon;
  const copy = DECISIONS[outcome]!;

  let supporting = copy.supporting;

  if (outcome === 'STEP_UP') {
    const missing = missingMethods.map((m) => (METHODS[m] ?? m).toLowerCase()).join(' and ');
    supporting = supporting.replace('{missing}', missing.length > 0 ? missing : 'a further check');
  }

  if (outcome === 'DENY') {
    const line = reason === null ? '' : (DECISION_REASONS[reason] ?? '');
    supporting = line.replace('{date}', formatDate(cnicExpiryAt));
  }

  return (
    <div className={`rounded-card border-l-4 border-y border-r px-6 py-5 ${style.box}`}>
      <div className="flex items-start gap-4">
        <IconComponent size={28} className={`mt-0.5 shrink-0 ${style.iconClass}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-section font-semibold ${TEXT[outcome]}`}>{copy.headline}</p>
          <p className="mt-1 text-body leading-6 text-ink-900">{supporting}</p>

          <button
            type="button"
            onClick={() => openGlossary(glossaryTarget(outcome, reason))}
            className="mt-3 text-cell font-medium underline underline-offset-2 text-ink-700 transition-colors duration-fast hover:text-ink-900"
          >
            {ACTIONS.whatDoesThisMean}
          </button>
        </div>
      </div>

      {/* Nobody may leave the room believing this replaced the credit or
          sanctions checks. It did not, and the copy says so next to the result
          rather than in a footnote. */}
      {outcome === 'ALLOW' && (
        <p className="mt-4 border-t border-ok-line/30 pt-3 text-caption leading-5 text-ink-700">
          {NOTES.reuseScope}
        </p>
      )}
    </div>
  );
}
