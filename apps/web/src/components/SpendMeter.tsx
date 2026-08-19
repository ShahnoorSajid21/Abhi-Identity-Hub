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
 */
export function SpendMeter({ onOpenDetail }: { onOpenDetail?: () => void }) {
  const { data, error } = useApi((signal) => api.metrics(signal));

  if (error !== null || data === null) {
    return (
      <div className="flex flex-col items-end">
        <span className="label-caption">{TOP_BAR.spendLabel}</span>
        <span className="text-cell text-ink-500">—</span>
      </div>
    );
  }

  const spent = data.rails.costSpentPkr;

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      title={NOTES.costsAreModelled}
      className="flex flex-col items-end rounded-control px-2 py-1 text-right transition-colors duration-fast hover:bg-ink-100"
    >
      <span className="label-caption">{TOP_BAR.spendLabel}</span>
      <span className="tabular text-body font-semibold text-ink-900">{formatPkr(spent)}</span>
    </button>
  );
}
