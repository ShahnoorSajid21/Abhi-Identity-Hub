import { useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatCount } from '../lib/format.ts';
import type { ActivityBucket } from '../lib/api.ts';

/**
 * Verifications per day.
 *
 * Vertical bars over a discrete time axis: the job is magnitude across a small
 * fixed set of buckets, which is exactly what a bar chart is for. One series,
 * so there is no legend — the card's title names it, and a legend box for a
 * single series is furniture.
 *
 * Geometry is the reference chart (node 14:1709): 54px columns on a 51px gap,
 * 8px rounded bar ends, a 24px gap to the day label, y-axis labels at 16px and
 * 60% opacity, and dashed gridlines behind. One bar is emphasised the way the
 * reference emphasises its selected day — a filled bar carrying a 45° hatch —
 * which is a SECOND channel on top of colour, so the emphasis survives
 * colour-blindness and greyscale printing.
 *
 * Values are never printed on every bar. The axis carries the scale and the
 * hover tooltip carries the exact figure, per the marks-and-anatomy rules.
 */

const BAR_W = 54;
const GAP = 51;
const PLOT_H = 160;

/** Four gridlines, matching the reference's $0 / $2000 / $3000 / $4000. */
const TICKS = 4;

function niceCeiling(max: number): number {
  if (max <= 0) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(max / TICKS)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const candidate = step * m * TICKS;
    if (candidate >= max) return candidate;
  }
  return step * 10 * TICKS;
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]!;
}

function fullDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dayLabel(iso)}, ${d.getDate()} ${months[d.getMonth()]}`;
}

export function VerificationBarChart({
  buckets,
  complete,
}: {
  buckets: ActivityBucket[];
  /** False when retention did not cover the window — the earliest bars undercount. */
  complete: boolean;
}) {
  const hatchId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (buckets.length === 0) {
    return <p className="py-10 text-center text-cell text-ink-500">No activity recorded yet.</p>;
  }

  const max = Math.max(...buckets.map((b) => b.verifications));
  const ceiling = niceCeiling(max);

  /**
   * Today carries the emphasis, not the tallest bar.
   *
   * The reference highlights a selected day. Highlighting the peak instead
   * looked equivalent until two days tied on 12 and the mark landed on the
   * older one — emphasis that moves for reasons the reader cannot see is
   * worse than none. Today is what an operations console is actually about,
   * and it never ties with itself.
   */
  const emphasis = buckets.length - 1;

  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => Math.round((ceiling / TICKS) * i)).reverse();
  const plotW = buckets.length * BAR_W + (buckets.length - 1) * GAP;

  return (
    <div>
      <div className="flex gap-5 overflow-x-auto pb-1">
        {/* Y axis. Labels only — the rule itself is drawn in the plot. */}
        <ul
          className="flex shrink-0 flex-col justify-between text-right"
          style={{ height: PLOT_H }}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <li key={t} className="tabular text-[16px] leading-none text-ink-900/60">
              {formatCount(t)}
            </li>
          ))}
        </ul>

        <div className="relative shrink-0" style={{ minWidth: plotW }}>
          {/* Gridlines, recessive and behind the marks. */}
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: PLOT_H }}>
            {ticks.map((t, i) => (
              <span
                key={t}
                className="absolute left-0 right-0 border-t border-dashed border-ink-200"
                style={{ top: `${(i / TICKS) * 100}%` }}
              />
            ))}
          </div>

          <svg
            width={plotW}
            height={PLOT_H}
            viewBox={`0 0 ${plotW} ${PLOT_H}`}
            className="relative block"
            role="img"
            aria-label={`Verifications per day over the last ${buckets.length} days`}
          >
            <defs>
              {/* The reference's 45° white hatch on the emphasised bar. This is
                  the non-colour channel that carries emphasis into greyscale. */}
              <pattern
                id={hatchId}
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="8" height="8" fill="var(--abhi-mint-700)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="2" />
              </pattern>
            </defs>

            {buckets.map((b, i) => {
              const x = i * (BAR_W + GAP);
              const h = ceiling === 0 ? 0 : Math.max((b.verifications / ceiling) * PLOT_H, b.verifications > 0 ? 4 : 0);
              const emphasised = i === emphasis && b.verifications > 0;
              return (
                <g
                  key={b.date}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* A full-height hit target: pointing at a short bar should
                      not require hitting a 4px sliver. */}
                  <rect x={x} y={0} width={BAR_W} height={PLOT_H} fill="transparent" />
                  <rect
                    x={x}
                    y={PLOT_H - h}
                    width={BAR_W}
                    height={h}
                    rx={8}
                    fill={emphasised ? `url(#${hatchId})` : 'var(--abhi-mint-100)'}
                    className="transition-opacity duration-fast"
                    opacity={hover === null || hover === i ? 1 : 0.65}
                  />
                </g>
              );
            })}
          </svg>

          {/* X axis, 24px below the plot per the reference. */}
          <ul className="mt-6 flex" style={{ width: plotW }}>
            {buckets.map((b, i) => (
              <li
                key={b.date}
                className="shrink-0 text-center text-[16px] text-ink-900/60"
                style={{ width: BAR_W, marginRight: i === buckets.length - 1 ? 0 : GAP }}
              >
                {dayLabel(b.date)}
              </li>
            ))}
          </ul>

          {/* Tooltip — 116x72, radius 8, per the reference's Info card. */}
          {hover !== null && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 w-[116px] rounded-lg bg-navy-800 px-4 py-3 shadow-panel"
              style={{
                left: Math.min(hover * (BAR_W + GAP) + BAR_W / 2 - 58, plotW - 116),
                top: -14,
              }}
            >
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full bg-mint-500" aria-hidden="true" />
                <span className="tabular text-caption font-medium text-white">
                  {formatCount(buckets[hover]!.verifications)}
                </span>
              </span>
              {/* Two lines, matching the reference's 116x72 Info card. The
                  reused count is deliberately not a third line here — it is
                  already a headline card on this screen, and the tooltip's
                  job is the value under the cursor. */}
              <span className="mt-1 block text-caption text-white/70">
                {fullDate(buckets[hover]!.date)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* The honest half. Drawing truncated buckets as fact would show a
          downward slope that is retention, not behaviour. */}
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
