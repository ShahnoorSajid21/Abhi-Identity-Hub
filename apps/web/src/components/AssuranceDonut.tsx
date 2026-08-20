import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCount, formatPercent } from '../lib/format.ts';
import { LEVELS } from '../copy/strings.ts';
import type { AssuranceLevel } from '../lib/api.ts';

/**
 * The customer base by identity confirmation level.
 *
 * A donut is defensible here for one reason: the four segments are parts of a
 * single whole that sums to the customer base, and the centre is doing real
 * work carrying that total. It would be the wrong form for anything else on
 * this screen.
 *
 * The ramp is ORDINAL — one hue darkening as confirmation accumulates, with A0
 * held outside it in neutral grey. Its worst adjacent pair separates at ΔE 7.9
 * under protanopia, which sits in the band that is legal only when colour is
 * not the sole carrier of identity. That is why every segment is named and
 * counted in the legend, and why the segments are separated by a 2px gap in
 * the surface colour. Those are load-bearing, not decoration — see the
 * measurement note in styles/tokens.css.
 */

const ORDER: AssuranceLevel[] = ['A0', 'A1', 'A2', 'A3'];

const FILL: Record<AssuranceLevel, string> = {
  A0: 'var(--ladder-none)',
  A1: 'var(--ladder-1)',
  A2: 'var(--ladder-2)',
  A3: 'var(--ladder-3)',
};

const RADIUS = 56;
const STROKE = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The 2px surface gap between adjacent fills, expressed as arc length. */
const GAP = 2;

export function AssuranceDonut({
  byLevel,
  total,
}: {
  byLevel: Record<AssuranceLevel, number>;
  total: number;
}) {
  const [hover, setHover] = useState<AssuranceLevel | null>(null);

  const segments = ORDER.map((level) => ({ level, value: byLevel[level] ?? 0 })).filter(
    (s) => s.value > 0,
  );

  if (total <= 0 || segments.length === 0) {
    return <p className="py-8 text-center text-cell text-ink-500">No customers to show yet.</p>;
  }

  let offset = 0;
  const arcs = segments.map((s) => {
    const fraction = s.value / total;
    const length = Math.max(fraction * CIRCUMFERENCE - GAP, 1);
    const arc = { ...s, fraction, length, offset };
    offset += fraction * CIRCUMFERENCE;
    return arc;
  });

  const focused = hover === null ? null : arcs.find((a) => a.level === hover) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-6">
      <div className="relative shrink-0">
        <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Customers by identity confirmation level">
          <g transform="rotate(-90 75 75)">
            {arcs.map((a) => (
              <circle
                key={a.level}
                cx="75"
                cy="75"
                r={RADIUS}
                fill="none"
                stroke={FILL[a.level]}
                strokeWidth={hover === a.level ? STROKE + 6 : STROKE}
                strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
                strokeDashoffset={-a.offset}
                strokeLinecap="butt"
                className="transition-[stroke-width] duration-fast"
                onMouseEnter={() => setHover(a.level)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>

        {/* The centre carries the whole the segments are parts of — or, on
            hover, the segment being pointed at. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {focused === null ? (
            <>
              <span className="tabular text-title font-semibold leading-none text-ink-900">
                {formatCount(total)}
              </span>
              <span className="mt-1 text-caption text-ink-500">customers</span>
            </>
          ) : (
            <>
              <span className="tabular text-title font-semibold leading-none text-ink-900">
                {formatPercent(focused.fraction)}
              </span>
              <span className="mt-1 text-caption text-ink-500">{LEVELS[focused.level].label}</span>
            </>
          )}
        </div>
      </div>

      {/* The legend is not optional. It is the secondary encoding the ramp's
          CVD separation depends on. */}
      <ul className="min-w-[180px] flex-1 space-y-2.5">
        {ORDER.map((level) => {
          const value = byLevel[level] ?? 0;
          return (
            <li key={level}>
              <Link
                to={`/customers?level=${level}`}
                onMouseEnter={() => setHover(level)}
                onMouseLeave={() => setHover(null)}
                className="flex items-center gap-3 rounded-control px-1.5 py-1 transition-colors duration-fast hover:bg-ink-50"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: FILL[level] }}
                />
                <span className="min-w-0 flex-1 truncate text-cell text-ink-700">
                  {LEVELS[level].label}
                </span>
                <span className="tabular shrink-0 text-cell font-semibold text-ink-900">
                  {formatCount(value)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
