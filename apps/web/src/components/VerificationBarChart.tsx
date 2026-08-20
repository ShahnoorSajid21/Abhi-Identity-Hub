import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatCount } from '../lib/format.ts';
import type { ActivityBucket } from '../lib/api.ts';

/**
 * Verifications per day.
 *
 * Vertical bars over a discrete time axis: the job is magnitude across a small
 * fixed set of buckets, which is what a bar chart is for. One series, so there
 * is no legend — the title and subtitle name it, and a legend box for a single
 * series is furniture.
 *
 * Laid out in CSS rather than a fixed-width SVG. The first cut hard-coded 40px
 * bars on a 26px gap, which came to 436px inside a card nearly 1,000px wide —
 * the plot used less than half its space and the rest sat empty. Columns are
 * now `flex-1`, so the chart fills whatever it is given at any breakpoint.
 *
 * Emphasis on today is carried by a 45° hatch as well as a darker fill: two
 * channels, so it survives greyscale and colour-blindness. Today rather than
 * the tallest bar, because a mark that moves for reasons the reader cannot see
 * is worse than no mark.
 */

const PLOT_H = 184;
const TICKS = 4;

/**
 * Height of the tooltip card, and its gap to the bar it labels.
 *
 * Three 16px caption lines on 4px leading inside 8px of vertical padding comes
 * to 72px. Both feed the clamp below rather than a branch in JS: the tooltip is
 * positioned in the plot's own percentage space, so the ceiling has to be
 * expressed in that space too.
 */
const TOOLTIP_H = 72;
const TOOLTIP_GAP = 8;

/**
 * Bar fill, measured against the white card: 3.94:1.
 *
 * The previous fill was --abhi-mint-100 at 1.10:1, which is why the bars read
 * as ghosts of themselves in a screenshot. Marks are not text and do not owe
 * 4.5:1, but they do have to be visible.
 */
const BAR = 'var(--chart-bar)';
const BAR_TODAY = 'var(--chart-bar-today)';

function niceCeiling(max: number): number {
  if (max <= 0) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(max / TICKS, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const candidate = step * m * TICKS;
    if (candidate >= max) return candidate;
  }
  return step * 10 * TICKS;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayLabel(iso: string): string {
  const d = parse(iso);
  return d === null ? iso : DAYS[d.getDay()]!;
}

function fullDate(iso: string): string {
  const d = parse(iso);
  return d === null ? iso : `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function VerificationBarChart({
  buckets,
  complete,
}: {
  buckets: ActivityBucket[];
  /** False when retention did not cover the window — the earliest bars undercount. */
  complete: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (buckets.length === 0) {
    return <p className="py-10 text-center text-cell text-ink-500">No activity recorded yet.</p>;
  }

  const max = Math.max(...buckets.map((b) => b.verifications));
  const ceiling = niceCeiling(max);
  const today = buckets.length - 1;
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) =>
    Math.round((ceiling / TICKS) * i),
  ).reverse();

  const total = buckets.reduce((n, b) => n + b.verifications, 0);
  const reused = buckets.reduce((n, b) => n + b.reused, 0);

  return (
    <div>
      <p className="text-cell leading-6 text-ink-500">
        Identity checks each product asked for, by day.{' '}
        <span className="font-medium text-ink-900">
          {formatCount(total)} in this period, {formatCount(reused)} answered from an existing
          record.
        </span>{' '}
        Today is shaded.
      </p>

      <div className="mt-5 flex gap-4">
        {/* Y axis. Labels only; the rules themselves are drawn across the plot. */}
        <ul
          className="flex shrink-0 flex-col justify-between pb-6 text-right"
          style={{ height: PLOT_H + 24 }}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <li key={t} className="tabular text-caption leading-none text-ink-500">
              {formatCount(t)}
            </li>
          ))}
        </ul>

        {/* The plot fills the remaining width, whatever the card gives it. */}
        <div className="relative min-w-0 flex-1">
          <div
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ height: PLOT_H }}
            aria-hidden="true"
          >
            {ticks.map((t, i) => (
              <span
                key={t}
                className="absolute left-0 right-0 border-t border-dashed border-ink-200"
                style={{ top: `${(i / TICKS) * 100}%` }}
              />
            ))}
          </div>

          <ul
            className="relative flex items-end gap-2 sm:gap-3"
            style={{ height: PLOT_H }}
            aria-label={`Verifications per day over the last ${buckets.length} days`}
          >
            {buckets.map((b, i) => {
              const pct = ceiling === 0 ? 0 : (b.verifications / ceiling) * 100;
              // A day with one verification must still draw something, or the
              // chart reports it as a zero.
              const height = b.verifications > 0 ? `max(${pct}%, 6px)` : '2px';
              const isToday = i === today;
              const dim = hover !== null && hover !== i;

              // Where the tooltip goes: 8px above the bar it describes, but
              // never so high that it leaves the plot.
              //
              // `bottom-full` on the COLUMN resolved against the full plot
              // height rather than the bar, so every tooltip sat above the plot
              // and covered the paragraph describing the chart. Anchoring to
              // the bar fixes that; the min() is the ceiling, and it is written
              // in CSS rather than branched in JS so it holds in the plot's own
              // percentage space whatever the bar height turns out to resolve
              // to. A tall bar's tooltip slides down inside the bar instead of
              // escaping upward.
              const tooltipBottom = `min(calc(${height} + ${TOOLTIP_GAP}px), calc(100% - ${TOOLTIP_H}px))`;

              return (
                <li
                  key={b.date}
                  className="group relative flex h-full min-w-0 flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                >
                  {/* The value on today's bar, always. Selective by design —
                      a number over every bar is noise, and the axis plus the
                      tooltip already carry the rest. */}
                  {isToday && b.verifications > 0 && hover !== i && (
                    <span
                      className="tabular pointer-events-none absolute inset-x-0 text-center text-caption font-semibold text-ink-900"
                      style={{ bottom: `calc(${height} + 6px)` }}
                    >
                      {formatCount(b.verifications)}
                    </span>
                  )}

                  <span
                    className="block w-full rounded-t-lg transition-opacity duration-fast"
                    style={{
                      height,
                      background: isToday
                        ? `repeating-linear-gradient(45deg, ${BAR_TODAY} 0 5px, rgba(255,255,255,0.32) 5px 8px)`
                        : BAR,
                      opacity: dim ? 0.45 : 1,
                    }}
                  />

                  {/*
                    Horizontal placement: the first and last columns align to
                    their own edge, so the card never overhangs the chart — an
                    earlier version clamped only on the right and threw
                    Thursday's card across Wednesday. Vertical placement is
                    `tooltipBottom`, computed above.
                  */}
                  {hover === i && (
                    <div
                      role="status"
                      style={{ bottom: tooltipBottom }}
                      className={[
                        'pointer-events-none absolute z-20 w-[132px] rounded-lg',
                        'bg-navy-800 px-3 py-2 shadow-panel',
                        i === 0
                          ? 'left-0'
                          : i === buckets.length - 1
                            ? 'right-0'
                            : 'left-1/2 -translate-x-1/2',
                      ].join(' ')}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: BAR_TODAY }}
                          aria-hidden="true"
                        />
                        <span className="tabular text-caption font-semibold text-white">
                          {formatCount(b.verifications)} checks
                        </span>
                      </span>
                      <span className="mt-1 block text-caption text-white/70">
                        {fullDate(b.date)}
                      </span>
                      <span className="tabular mt-1 block text-caption text-mint-300">
                        {formatCount(b.reused)} reused
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <ul className="mt-2 flex gap-2 sm:gap-3">
            {buckets.map((b, i) => (
              <li
                key={b.date}
                className={`min-w-0 flex-1 truncate text-center text-caption ${
                  i === today ? 'font-semibold text-ink-900' : 'text-ink-500'
                }`}
              >
                {dayLabel(b.date)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Drawing truncated buckets as fact would show a downward slope that is
          retention, not behaviour. */}
      {!complete && (
        <p className="mt-4 flex items-start gap-2 border-t border-ink-100 pt-3 text-caption leading-5 text-ink-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          The gateway's activity retention did not reach the start of this window, so the earliest
          days are undercounted.
        </p>
      )}
    </div>
  );
}
