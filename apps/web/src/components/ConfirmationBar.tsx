import { Link } from 'react-router-dom';
import { LEVELS } from '../copy/strings.ts';
import { formatCount, formatPercent } from '../lib/format.ts';
import type { AssuranceLevel } from '../lib/api.ts';

/**
 * Identity confirmation across the customer base.
 *
 * One chart that is the entire problem statement in a picture: the grey
 * segment is the employer-asserted CNICs nobody has ever checked.
 *
 * The colour is an ORDINAL ramp, not a categorical palette — the levels have
 * an order, and one hue deepening carries that order where four hues would
 * throw it away. A0 sits outside the ramp in neutral grey because it is the
 * absence of confirmation rather than a degree of it. Tokens and validation
 * notes are in styles/tokens.css.
 *
 * Every segment is directly labelled, which is what discharges the sub-3:1
 * contrast of the lightest step: nothing here is readable by colour alone.
 */

const SEGMENTS: { level: AssuranceLevel; token: string }[] = [
  { level: 'A0', token: 'var(--ladder-none)' },
  { level: 'A1', token: 'var(--ladder-1)' },
  { level: 'A2', token: 'var(--ladder-2)' },
  { level: 'A3', token: 'var(--ladder-3)' },
];

export function ConfirmationBar({
  byLevel,
  total,
}: {
  byLevel: Record<AssuranceLevel, number>;
  total: number;
}) {
  if (total === 0) return null;

  return (
    <figure className="m-0">
      {/* 2px gaps between segments, so adjacent fills never touch. */}
      <div className="flex h-10 w-full gap-[2px] overflow-hidden">
        {SEGMENTS.map(({ level, token }, i) => {
          const count = byLevel[level] ?? 0;
          if (count === 0) return null;
          const share = count / total;
          return (
            <Link
              key={level}
              to={`/customers?level=${level}`}
              title={`${LEVELS[level].label} — ${formatCount(count)} customers`}
              style={{ width: `${share * 100}%`, background: token }}
              className={[
                'block transition-opacity duration-fast hover:opacity-80',
                i === 0 ? 'rounded-l' : '',
                i === SEGMENTS.length - 1 ? 'rounded-r' : '',
              ].join(' ')}
            />
          );
        })}
      </div>

      <figcaption className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SEGMENTS.map(({ level, token }) => {
          const count = byLevel[level] ?? 0;
          return (
            <Link
              key={level}
              to={`/customers?level=${level}`}
              className="group flex items-start gap-2 rounded-control p-1 transition-colors duration-fast hover:bg-ink-50"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: token }}
              />
              <span className="min-w-0">
                <span className="tabular block text-body font-semibold text-ink-900">
                  {formatCount(count)}
                </span>
                <span className="block text-caption leading-4 text-ink-500">
                  {LEVELS[level].label}
                </span>
                <span className="tabular block text-caption text-ink-500">
                  {formatPercent(count / total)}
                </span>
              </span>
            </Link>
          );
        })}
      </figcaption>
    </figure>
  );
}
