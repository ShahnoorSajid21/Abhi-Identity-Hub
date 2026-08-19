import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, MoreHorizontal, type LucideIcon } from 'lucide-react';

/**
 * A headline figure.
 *
 * Geometry is the reference card exactly: 28px padding, 27px radius, an 18px
 * column gap, a 48px icon tile beside a 20px title, a 36px figure, and a
 * delta chip of radius 8 sitting on the figure's baseline with the comparison
 * sentence beside it.
 *
 * What is NOT copied from the reference is its delta chip's meaning. Every card
 * there reads "↗ 20%" in green, including the two where the screenshot tints
 * the arrow red — a mockup can afford that because its numbers are decoration.
 * Here the direction and the tone are computed from the actual figure, and a
 * card with no prior period renders no chip at all rather than an invented one.
 */

export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface KpiDelta {
  /** Signed percentage change. Negative renders a down arrow. */
  percent: number;
  /**
   * Whether the movement is good news. Not derivable from the sign: spend
   * falling is good, confirmed customers falling is not.
   */
  tone: DeltaTone;
  /** The comparison sentence, e.g. "Last month total 1,050". */
  caption: string;
}

const TONE: Record<DeltaTone, string> = {
  good: 'bg-ok-bg text-ok-fg',
  bad: 'bg-stop-bg text-stop-fg',
  neutral: 'bg-ink-100 text-ink-700',
};

export function KpiCard({
  label,
  figure,
  icon: Icon,
  delta,
  caption,
  to,
}: {
  label: string;
  figure: string;
  icon: LucideIcon;
  /** Omit where there is no prior period to compare against. */
  delta?: KpiDelta;
  /** Shown when there is no delta — the supporting line on its own. */
  caption?: string;
  to?: string;
}) {
  const Arrow = delta !== undefined && delta.percent < 0 ? ArrowDownRight : ArrowUpRight;

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-mint-100 text-mint-700">
            <Icon size={22} aria-hidden="true" />
          </span>
          <p className="min-w-0 text-[20px] font-medium leading-tight text-ink-900">{label}</p>
        </div>
        {/* The reference's overflow affordance. Decorative until the menu it
            implies exists, so it is hidden from assistive technology rather
            than announced as a control that does nothing. */}
        <MoreHorizontal size={20} className="shrink-0 text-ink-300" aria-hidden="true" />
      </div>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <p className="tabular text-[36px] font-medium leading-none text-ink-900">{figure}</p>

        <div className="flex items-center gap-2">
          {delta !== undefined && (
            <span
              className={`tabular inline-flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-cell font-medium ${TONE[delta.tone]}`}
            >
              <Arrow size={13} aria-hidden="true" />
              {Math.abs(Math.round(delta.percent))}%
            </span>
          )}
          <span className="text-cell text-ink-500">{delta?.caption ?? caption}</span>
        </div>
      </div>
    </>
  );

  const shell = 'card flex min-h-[171px] flex-col gap-4 p-7';

  return to === undefined ? (
    <div className={shell}>{body}</div>
  ) : (
    <Link
      to={to}
      className={`${shell} transition-shadow duration-fast hover:shadow-panel focus-visible:shadow-panel`}
    >
      {body}
    </Link>
  );
}
