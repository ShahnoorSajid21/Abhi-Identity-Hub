import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, Inbox, Snowflake } from 'lucide-react';
import { directory } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { formatCount, formatPercent, formatPkr, formatRelative } from '../lib/format.ts';
import { EMPTY, NOTES, PAGE_TITLES, PRODUCTS } from '../copy/strings.ts';
import { ConfirmationBar } from '../components/ConfirmationBar.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { SkeletonCard } from '../components/LoadingSkeleton.tsx';
import { Avatar } from '../components/Avatar.tsx';

/**
 * The landing screen.
 *
 * It has to pass the bystander test on its own: somebody who has never heard
 * of this project, shown this screen for ten seconds, should be able to say
 * what the system is for.
 *
 * Every figure is computed from GET /dashboard/summary and reconciles with
 * `npm run numbers`. Nothing on this screen is typed in.
 */

function MetricCard({
  label,
  figure,
  sub,
  subTone = 'muted',
  to,
}: {
  label: string;
  figure: string;
  sub?: string;
  subTone?: 'muted' | 'good' | 'warn';
  to?: string;
}) {
  const tone = {
    muted: 'text-ink-500',
    good: 'text-ok-fg',
    warn: 'text-warn-fg',
  }[subTone];

  const inner = (
    <>
      <p className="label-caption">{label}</p>
      <p className="tabular mt-2 text-metric font-bold leading-none text-ink-900">{figure}</p>
      {sub !== undefined && <p className={`mt-2 text-cell ${tone}`}>{sub}</p>}
    </>
  );

  return to === undefined ? (
    <div className="card p-4">{inner}</div>
  ) : (
    <Link to={to} className="card block p-4 transition-colors duration-fast hover:bg-ink-50">
      {inner}
    </Link>
  );
}

const ACTION_SENTENCE: Record<string, (name: string, product: string | null) => string> = {
  IDENTITY_CONFIRMED: (n) => `${n}'s identity was confirmed`,
  IDENTITY_UPDATED: (n) => `${n}'s identity record was updated`,
  VERIFICATION: (n, p) =>
    p === null ? `${n} was checked` : `${PRODUCTS[p] ?? p} checked ${n}`,
  FROZEN: (n) => `${n} was frozen by Compliance`,
  REINSTATED: (n) => `${n} was reinstated`,
  ERASED: (n) => `${n}'s personal details were erased`,
  CONSENT_GRANTED: (n) => `${n} gave consent`,
  CONSENT_REVOKED: (n) => `${n} withdrew consent`,
};

export function DashboardPage() {
  const summary = useApi((signal) => directory.summary(signal));
  const activity = useApi((signal) => directory.audit({ pageSize: 8 }, signal));

  if (summary.error !== null) {
    return (
      <>
        <h1 className="text-title font-semibold text-ink-900">{PAGE_TITLES.dashboard}</h1>
        <div className="mt-6">
          <ErrorState error={summary.error} onRetry={summary.reload} />
        </div>
      </>
    );
  }

  const d = summary.data;
  const needsAttention = d === null ? 0 : d.frozen + d.cnicExpiringIn90Days;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-title font-semibold text-ink-900">{PAGE_TITLES.dashboard}</h1>
        <p className="text-caption text-ink-500">
          {NOTES.syntheticData}
          {d !== null && ` ${formatCount(d.totalCustomers)} records.`}
        </p>
      </div>

      {d === null ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Customers with confirmed identity"
              figure={`${formatCount(d.confirmedCustomers)} of ${formatCount(d.totalCustomers)}`}
              sub={`${formatPercent(d.confirmedCustomers / d.totalCustomers)} of the base`}
              to="/customers"
            />
            <MetricCard
              label="Identity checks reused today"
              figure={formatCount(d.queueCounts.ALLOW)}
              sub={d.queueCounts.ALLOW === 0 ? 'No reuse yet today' : 'no re-checks required'}
              subTone={d.queueCounts.ALLOW === 0 ? 'muted' : 'good'}
              to="/queue"
            />
            <MetricCard
              label="Verification spend today"
              figure={formatPkr(d.spendTodayPkr)}
              sub={`${formatPkr(d.spendAvoidedTodayPkr)} avoided`}
              subTone={d.spendAvoidedTodayPkr > 0 ? 'good' : 'muted'}
            />
            <MetricCard
              label="Needs attention"
              figure={formatCount(needsAttention)}
              sub={`${d.frozen} frozen · ${d.cnicExpiringIn90Days} CNICs expiring within 90 days`}
              subTone={needsAttention > 0 ? 'warn' : 'muted'}
            />
          </div>

          {/* Money on this screen is modelled, and says so. The unit costs behind
              it are placeholder grid points awaiting Finance. */}
          <p className="mt-2 text-caption text-ink-500">{NOTES.costsAreModelled}</p>

          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <section className="card p-5 lg:col-span-2">
              <h2 className="text-section font-semibold text-ink-900">
                Identity confirmation across the customer base
              </h2>
              <p className="mt-1 text-cell text-ink-500">
                Select a segment to see those customers.
              </p>
              <div className="mt-5">
                <ConfirmationBar byLevel={d.byLevel} total={d.totalCustomers} />
              </div>
            </section>

            <section className="card p-5">
              <h2 className="text-section font-semibold text-ink-900">Needs attention</h2>
              {needsAttention === 0 && d.queueDepth === 0 ? (
                <EmptyState copy={EMPTY.dashboardNeedsAttention!} compact />
              ) : (
                <ul className="mt-3 divide-y divide-ink-100">
                  <li>
                    <Link
                      to="/customers?status=SUSPENDED"
                      className="flex items-center gap-3 py-3 transition-colors duration-fast hover:bg-ink-50"
                    >
                      <Snowflake size={18} className="shrink-0 text-stop-fg" />
                      <span className="flex-1 text-cell text-ink-900">Frozen customers</span>
                      <span className="tabular text-body font-semibold text-ink-900">
                        {formatCount(d.frozen)}
                      </span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/customers?expiringSoon=true"
                      className="flex items-center gap-3 py-3 transition-colors duration-fast hover:bg-ink-50"
                    >
                      <CalendarClock size={18} className="shrink-0 text-warn-fg" />
                      <span className="flex-1 text-cell text-ink-900">
                        CNICs expiring within 90 days
                      </span>
                      <span className="tabular text-body font-semibold text-ink-900">
                        {formatCount(d.cnicExpiringIn90Days)}
                      </span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/queue"
                      className="flex items-center gap-3 py-3 transition-colors duration-fast hover:bg-ink-50"
                    >
                      <Inbox size={18} className="shrink-0 text-ink-500" />
                      <span className="flex-1 text-cell text-ink-900">Requests waiting</span>
                      <span className="tabular text-body font-semibold text-ink-900">
                        {formatCount(d.queueDepth)}
                      </span>
                    </Link>
                  </li>
                </ul>
              )}

              {d.ledgerMode !== 'fabric' && (
                <p className="mt-4 flex items-start gap-2 border-t border-ink-100 pt-3 text-caption leading-5 text-ink-500">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {NOTES.simulatedLedger}
                </p>
              )}
            </section>
          </div>

          <section className="card mt-5 p-5">
            <h2 className="text-section font-semibold text-ink-900">Recent activity</h2>
            {activity.data === null || activity.data.rows.length === 0 ? (
              <EmptyState copy={EMPTY.dashboardRecentActivity!} compact />
            ) : (
              <ul className="mt-2 divide-y divide-ink-100">
                {activity.data.rows.map((row, i) => (
                  <li key={`${row.at}-${i}`} className="flex items-center gap-3 py-2.5">
                    <Avatar name={row.displayName} seed={row.subjectId.slice(0, 8)} size={26} />
                    <Link
                      to={`/customers/${row.subjectId}`}
                      className="flex-1 truncate text-cell text-ink-900 hover:underline"
                    >
                      {(ACTION_SENTENCE[row.action] ?? ((n: string) => n))(
                        row.displayName,
                        row.productId,
                      )}
                    </Link>
                    <span className="shrink-0 text-caption text-ink-500">
                      {formatRelative(row.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
