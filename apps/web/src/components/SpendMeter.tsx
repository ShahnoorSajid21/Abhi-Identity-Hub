import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { formatPkr } from '../lib/format.ts';
import { NOTES, TOP_BAR } from '../copy/strings.ts';

/**
 * The spend counter, in the top bar.
 *
 * Reads GET /metrics — there is no /rails/summary in this gateway, whatever
 * the original plan said. Resetting is `npm run demo:seed` against a restarted
 * gateway; the UI never resets anything itself.
 *
 * The figure carries its caveat because the unit costs behind it are modelled
 * grid points awaiting Finance, not ABHI's contracted rates.
 *
 * Renders as a button ONLY when a handler is supplied. It previously rendered
 * a button unconditionally while the top bar passed nothing, so the control
 * carried a hover state and a pointer cursor and then did nothing when
 * clicked — the specific pattern that teaches a user their clicks are being
 * dropped.
 */
export function SpendMeter({ onOpenDetail }: { onOpenDetail?: () => void }) {
  const { data, error } = useApi((signal) => api.metrics(signal));

  const body =
    error !== null || data === null ? (
      <span className="text-cell text-white/50">—</span>
    ) : (
      <span className="tabular text-body font-semibold text-white">
        {formatPkr(data.rails.costSpentPkr)}
      </span>
    );

  const label = <span className="label-caption-dark">{TOP_BAR.spendLabel}</span>;

  if (onOpenDetail === undefined) {
    return (
      <div
        className="hidden flex-col items-end px-2 py-1 text-right sm:flex"
        title={NOTES.costsAreModelled}
      >
        {label}
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      title={NOTES.costsAreModelled}
      className="hidden flex-col items-end rounded-control px-2 py-1 text-right transition-colors duration-fast hover:bg-navy-700 sm:flex"
    >
      {label}
      {body}
    </button>
  );
}
