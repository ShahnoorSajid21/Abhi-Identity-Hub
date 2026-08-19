import { Check, ShieldQuestion } from 'lucide-react';
import { LEVELS, METHODS, NOTES } from '../copy/strings.ts';
import type { AssuranceLevel } from '../lib/api.ts';
import { daysSince, formatDate } from '../lib/format.ts';

/**
 * The trust meter — the single most important component in the app.
 *
 * It replaces a bare level code everywhere one would otherwise appear. Four
 * pips, filled to the level reached, and the plain label under each pip is
 * always visible: a level code without its plain-English label beside it is
 * exactly the thing this rebuild exists to remove.
 */

const ORDER: AssuranceLevel[] = ['A0', 'A1', 'A2', 'A3'];

export interface IdentityStatusProps {
  level: AssuranceLevel;
  /** When the confirmation was made. */
  verifiedAt?: string | null;
  /** When the customer's CNIC expires. */
  cnicExpiryAt?: string | null;
  /** The checks actually performed, as returned by the ledger. */
  methods?: string[];
  size?: 'sm' | 'md' | 'lg';
  /** True when no identity has been confirmed at all. */
  unconfirmed?: boolean;
}

function Pips({ level, size }: { level: AssuranceLevel; size: 'sm' | 'md' | 'lg' }) {
  const reached = ORDER.indexOf(level);
  const dot = size === 'sm' ? 8 : 10;

  return (
    <div className="flex items-center" aria-hidden="true">
      {ORDER.map((step, index) => (
        <div key={step} className="flex items-center">
          {index > 0 && (
            <span
              className={`block h-0.5 ${size === 'sm' ? 'w-4' : 'w-8'} ${
                index <= reached ? 'bg-mint-500' : 'bg-ink-300'
              }`}
            />
          )}
          <span
            className={`block rounded-pill ${index <= reached ? 'bg-mint-500' : 'bg-ink-300'}`}
            style={{ width: dot, height: dot }}
          />
        </div>
      ))}
    </div>
  );
}

export function IdentityStatus({
  level,
  verifiedAt,
  cnicExpiryAt,
  methods,
  size = 'md',
  unconfirmed = false,
}: IdentityStatusProps) {
  if (unconfirmed) {
    return (
      <span className="inline-flex items-center gap-2 text-ink-500">
        <ShieldQuestion size={size === 'sm' ? 14 : 18} />
        <span className={size === 'sm' ? 'text-cell' : 'text-body'}>Not confirmed</span>
      </span>
    );
  }

  const meta = LEVELS[level];
  const age = daysSince(verifiedAt);

  if (size === 'sm') {
    return (
      <span className="inline-flex items-center gap-2" title={meta.meaning}>
        <Pips level={level} size="sm" />
        <span className="text-cell text-ink-900">{meta.label}</span>
      </span>
    );
  }

  const headline = level === 'A0' ? 'Identity not checked' : 'Identity confirmed';

  return (
    <div className={size === 'lg' ? 'space-y-4' : 'space-y-3'}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex shrink-0 items-center justify-center rounded-pill ${
            level === 'A0' ? 'bg-ink-100 text-ink-500' : 'bg-ok-bg text-ok-fg'
          }`}
          style={{ width: 28, height: 28 }}
        >
          {level === 'A0' ? <ShieldQuestion size={16} /> : <Check size={16} />}
        </span>
        <div className="min-w-0">
          <p className={`font-semibold text-ink-900 ${size === 'lg' ? 'text-section' : 'text-body'}`}>
            {headline}
          </p>
          <p className="text-cell text-ink-700">
            {meta.label}
            {age !== null && age >= 0 && ` · ${age} day${age === 1 ? '' : 's'} ago`}
          </p>
          {cnicExpiryAt !== undefined && cnicExpiryAt !== null && (
            <p className="text-cell text-ink-500">CNIC valid until {formatDate(cnicExpiryAt)}</p>
          )}
        </div>
      </div>

      <div>
        <Pips level={level} size={size} />
        <div className="mt-2 flex gap-2">
          {ORDER.map((step) => (
            <span
              key={step}
              title={LEVELS[step].meaning}
              className={`text-caption ${
                ORDER.indexOf(step) <= ORDER.indexOf(level) ? 'text-ink-700' : 'text-ink-500'
              }`}
              style={{ width: size === 'lg' ? 88 : 76 }}
            >
              {LEVELS[step].short}
            </span>
          ))}
        </div>
      </div>

      {methods !== undefined && methods.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {methods.map((method) => (
            <span
              key={method}
              className="rounded-pill bg-ink-100 px-3 py-1 text-caption font-medium text-ink-700"
            >
              {METHODS[method] ?? method}
            </span>
          ))}
        </div>
      )}

      {size === 'lg' && <p className="text-caption leading-5 text-ink-500">{NOTES.ledgerHoldsNoData}</p>}
    </div>
  );
}
