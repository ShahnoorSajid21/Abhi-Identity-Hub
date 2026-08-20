import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Inbox,
  Recycle,
  Snowflake,
} from 'lucide-react';
import { directory } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { formatCount, formatPercent, formatRelative } from '../lib/format.ts';
import { EMPTY, NOTES, PRODUCTS } from '../copy/strings.ts';
import { AssuranceDonut } from '../components/AssuranceDonut.tsx';
import { VerificationBarChart } from '../components/VerificationBarChart.tsx';
import { KpiCard } from '../components/KpiCard.tsx';
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
 * Layout follows the reference's three content rows — three headline cards, a
 * wide chart beside a donut, then two list cards. The mapping is not arbitrary:
 * the reference's "Maintenance Requests" card is a list of things a person has
 * to act on, which is exactly what "Needs attention" is here.
 *
 * Every figure is computed from GET /dashboard/summary and reconciles with
 * `npm run numbers`. Nothing on this screen is typed in.
 */

const ACTION_SENTENCE: Record<string, (name: string, product: string | null) => string> = {
  IDENTITY_CONFIRMED: (n) => `${n}'s identity was confirmed`,
  IDENTITY_UPDATED: (n) => `${n}'s identity record was updated`,
  VERIFICATION: (n, p) => (p === null ? `${n} was checked` : `${PRODUCTS[p] ?? p} checked ${n}`),
  FROZEN: (n) => `${n} was frozen by Compliance`,
  REINSTATED: (n) => `${n} was reinstated`,
  ERASED: (n) => `${n}'s personal details were erased`,
  CONSENT_GRANTED: (n) => `${n} gave consent`,
  CONSENT_REVOKED: (n) => `${n} withdrew consent`,
};

function SeeAll({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="shrink-0 text-cell font-medium text-mint-700 transition-colors duration-fast hover:text-ink-900"
    >
      See all
    </Link>
  );
}

export function DashboardPage() {
  const [days, setDays] = useState(7);
  const summary = useApi((signal) => directory.summary(signal));
  const activityChart = useApi((signal) => directory.dailyActivity(days, signal), [days]);
  const activity = useApi((signal) => directory.audit({ pageSize: 6 }, signal));

  if (summary.error !== null) {
    return <ErrorState error={summary.error} onRetry={summary.reload} />;
  }

  const d = summary.data;

  if (d === null) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    );
  }

  const needsAttention = d.frozen + d.cnicExpiringIn90Days;
  const confirmedShare = d.totalCustomers > 0 ? d.confirmedCustomers / d.totalCustomers : 0;

  return (
    <>
      {/* Row 1 — the three headline figures. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Confirmed identities"
          figure={formatCount(d.confirmedCustomers)}
          icon={BadgeCheck}
          to="/customers"
          caption={`${formatPercent(confirmedShare)} of ${formatCount(d.totalCustomers)} customers`}
        />
        <KpiCard
          label="Checks reused today"
          figure={formatCount(d.queueCounts.ALLOW)}
          icon={Recycle}
          to="/queue"
          caption={
            d.queueCounts.ALLOW === 0
              ? 'No reuse yet today'
              : `${formatPercent(d.reuseRate)} of today's requests`
          }
        />
        {/* The backlog, not a money figure.

            This slot used to read "Spend avoided today — PKR 600 / PKR 0
            spent". Both numbers were correct and the pairing was not: spend is
            booked only when a rail runs, and a verification decides without
            buying anything, so an untouched queue reads as free. The card
            therefore implied an infinite return from modelled unit costs that
            Finance has not signed.

            Waiting work is the number an operations lead actually opens this
            screen for, it is measured rather than modelled, and it completes
            the row: how many customers we have confirmed, how many we waved
            through today, and how much is still queued. The cost of clearing
            that queue now sits on the queue screen, where it is operational
            context instead of a headline claim. */}
        <KpiCard
          label="Waiting on a check"
          figure={formatCount(d.pendingRequests)}
          icon={ClipboardList}
          to="/queue"
          caption={
            d.pendingRequests === 0
              ? 'Nothing waiting'
              : `${formatCount(d.queueCounts.STEP_UP)} step-ups · ${formatCount(d.queueCounts.FULL_KYC)} full onboardings`
          }
        />
      </div>

      {/* Row 2 — the wide chart beside the composition donut. */}
      {/* No modelled-cost note here any more: every figure on this screen is now
          a count of something that happened, so there is nothing to caveat.
          The note travels with the money, which lives on the queue. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-section font-semibold text-ink-900">Verification activity</h2>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-ink-200 px-2.5 text-cell text-ink-700">
              <CalendarDays size={18} className="shrink-0 opacity-70" aria-hidden="true" />
              <span className="sr-only">Range</span>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="cursor-pointer appearance-none bg-transparent pr-1 text-cell text-ink-700 focus:outline-none"
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </label>
          </div>
          <div className="mt-7">
            {activityChart.data === null ? (
              <p className="py-10 text-center text-cell text-ink-500">Loading…</p>
            ) : (
              <VerificationBarChart
                buckets={activityChart.data.buckets}
                complete={activityChart.data.complete}
              />
            )}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-section font-semibold text-ink-900">Confirmation mix</h2>
            <SeeAll to="/customers" />
          </div>
          <div className="mt-6">
            <AssuranceDonut byLevel={d.byLevel} total={d.totalCustomers} />
          </div>
        </section>
      </div>

      {/* Row 3 — two list cards. */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-section font-semibold text-ink-900">Recent activity</h2>
            <SeeAll to="/audit" />
          </div>
          {activity.data === null || activity.data.rows.length === 0 ? (
            <EmptyState copy={EMPTY.dashboardRecentActivity!} compact />
          ) : (
            <ul className="mt-4 divide-y divide-ink-100">
              {activity.data.rows.map((row, i) => (
                <li key={`${row.at}-${i}`} className="flex items-center gap-3 py-3">
                  <Avatar name={row.displayName} seed={row.subjectId.slice(0, 8)} size={40} />
                  <Link
                    to={`/customers/${row.subjectId}`}
                    className="min-w-0 flex-1 truncate text-cell text-ink-900 hover:underline"
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

        <section className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-section font-semibold text-ink-900">Needs attention</h2>
            <SeeAll to="/queue" />
          </div>

          {needsAttention === 0 && d.queueDepth === 0 ? (
            <EmptyState copy={EMPTY.dashboardNeedsAttention!} compact />
          ) : (
            <ul className="mt-4 divide-y divide-ink-100">
              {[
                {
                  to: '/customers?status=SUSPENDED',
                  icon: Snowflake,
                  tint: 'bg-stop-bg text-stop-fg',
                  label: 'Frozen customers',
                  detail: 'Compliance hold',
                  value: d.frozen,
                },
                {
                  to: '/customers?expiringSoon=true',
                  icon: CalendarClock,
                  tint: 'bg-warn-bg text-warn-fg',
                  label: 'CNICs expiring',
                  detail: 'Within 90 days',
                  value: d.cnicExpiringIn90Days,
                },
                {
                  to: '/queue',
                  icon: Inbox,
                  tint: 'bg-ink-100 text-ink-700',
                  label: 'Requests waiting',
                  detail: 'Across all products',
                  value: d.queueDepth,
                },
              ].map((r) => (
                <li key={r.to}>
                  <Link
                    to={r.to}
                    className="flex items-center gap-3 py-3 transition-colors duration-fast hover:bg-ink-50"
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${r.tint}`}
                    >
                      <r.icon size={19} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-cell font-medium text-ink-900">
                        {r.label}
                      </span>
                      <span className="block truncate text-caption text-ink-500">{r.detail}</span>
                    </span>
                    <span className="tabular shrink-0 text-body font-semibold text-ink-900">
                      {formatCount(r.value)}
                    </span>
                  </Link>
                </li>
              ))}
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
    </>
  );
}
