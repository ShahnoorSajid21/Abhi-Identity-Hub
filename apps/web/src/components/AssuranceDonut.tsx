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

/**
 * Ring geometry.
 *
 * Sized by the hole, not the outside: the centre has to hold a 24px figure
 * above a wrapped level name, and the widest of those — "Fingerprint verified"
 * — needs about 92px of line box to break cleanly in two. A 66/20 ring leaves
 * a 112px hole, which inscribes that comfortably. The earlier 56/22 ring left
 * 90px, and the label ran out over the arcs.
 */
const RADIUS = 66;
const STROKE = 20;
const SIZE = 176;
const CENTRE = SIZE / 2;
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
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-6">
      <div className="relative shrink-0">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label="Customers by identity confirmation level"
        >
          <g transform={`rotate(-90 ${CENTRE} ${CENTRE})`}>
            {arcs.map((a) => (
              <circle
                key={a.level}
                cx={CENTRE}
                cy={CENTRE}
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
            hover, the segment being pointed at.

            The label is clamped to the hole's inscribed width and wraps rather
            than running at its natural length. Unclamped, a two-word level name
            ran out across the arcs and sat on the figure above it, which is the
            one thing a donut centre must never do. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
          <span className="tabular text-title font-semibold leading-none text-ink-900">
            {focused === null ? formatCount(total) : formatPercent(focused.fraction)}
          </span>
          <span className="max-w-[92px] text-balance text-caption leading-[14px] text-ink-500">
            {focused === null ? 'customers' : LEVELS[focused.level].label}
          </span>
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
