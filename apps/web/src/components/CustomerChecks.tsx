import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import type { CustomerRecord, VerificationMethod } from '../lib/api.ts';
import { statusOf, useApplication, type ApplicationStatus } from '../lib/applications.ts';
import { METHODS, PRODUCTS } from '../copy/strings.ts';
import { formatRelative } from '../lib/format.ts';

/**
 * The internal, monitor-only view of a customer's outstanding checks.
 *
 * This is the half of the redesign that matters most. The checks a customer
 * owes are the customer's to perform, in the customer app — so this panel
 * shows them as STATUS, never as buttons an operator presses. It answers the
 * three questions an internal user actually has about a customer sitting at
 * this stage: which checks are required, which are done, and whether the whole
 * application has been confirmed. It performs none of them.
 *
 * It reads the shared application store, which the customer app writes to as
 * each check passes. Nothing here is invented for display: an empty panel
 * means no application has been opened, and a completed check means the
 * customer cleared it, not that this screen decided to show a tick.
 */

const STATUS_COPY: Record<ApplicationStatus, { label: string; chip: string }> = {
  awaiting_customer: { label: 'Waiting for the customer', chip: 'bg-warn-bg text-warn-fg' },
  checks_complete: { label: 'All checks complete — ready to confirm', chip: 'bg-new-bg text-new-fg' },
  confirmed: { label: 'Application confirmed', chip: 'bg-ok-bg text-ok-fg' },
};

export function CustomerChecks({
  subjectId,
  displayName,
  record,
  /**
   * Where this panel is mounted.
   *
   * Only the empty state cares, and it cares because it used to point at a
   * control: "use Check eligibility above". That is true on the profile and
   * false in the review drawer, which has no such button — the reviewer would
   * have been sent looking for something that is not on their screen.
   */
  surface = 'profile',
}: {
  subjectId: string;
  displayName: string;
  record: CustomerRecord;
  surface?: 'profile' | 'review';
}) {
  const application = useApplication(subjectId);

  if (application === null) {
    return (
      <section className="card p-5">
        <h2 className="text-section font-semibold text-ink-900">Customer checks</h2>
        <p className="mt-3 text-cell leading-6 text-ink-500">
          {surface === 'profile' ? (
            <>
              No application is in progress. Use{' '}
              <span className="font-medium">Check eligibility</span> above to open one — that
              identifies the checks {displayName} needs and makes them available in the customer
              app.
            </>
          ) : (
            <>
              No application is in progress. One is opened from {displayName}’s own profile, which
              identifies the checks they need and makes them available in the customer app.
            </>
          )}
        </p>
      </section>
    );
  }

  const product = PRODUCTS[application.productId] ?? application.productId;
  // One "done" set behind both the chip and the list, so the two can never
  // contradict each other. The ledger already holding a method counts as done;
  // ASSERTED is a self-claim, not a check the customer performs, so it never
  // appears in the list below.
  const status = statusOf(application, record.methods);
  const statusCopy = STATUS_COPY[status];

  const done = new Set<VerificationMethod>([...application.completedMethods, ...record.methods]);
  const checks = application.requiredMethods.filter((m) => m !== 'ASSERTED');
  const completedCount = checks.filter((m) => done.has(m)).length;

  return (
    <section className="card p-5" data-testid="customer-checks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section font-semibold text-ink-900">Customer checks</h2>
        <span
          className={`rounded-pill px-2.5 py-0.5 text-caption font-medium ${statusCopy.chip}`}
          data-testid="application-status"
        >
          {statusCopy.label}
        </span>
      </div>

      <p className="mt-1 text-caption leading-5 text-ink-500">
        {product} · the customer performs these in the app. You are monitoring progress, not running
        them.
      </p>

      {checks.length === 0 ? (
        <p className="mt-4 text-cell leading-6 text-ink-700">
          Nothing was outstanding — {displayName} was already confirmed to the standard {product}{' '}
          needs.
        </p>
      ) : (
        <>
          <p className="mt-4 text-caption text-ink-500">
            <span className="tabular font-medium text-ink-900">
              {completedCount} of {checks.length}
            </span>{' '}
            complete
          </p>
          <ul className="mt-2 divide-y divide-ink-100">
            {checks.map((m) => {
              const isDone = done.has(m);
              return (
                <li key={m} className="flex items-center gap-3 py-2.5">
                  {isDone ? (
                    <CheckCircle2 size={18} className="shrink-0 text-ok-fg" aria-hidden="true" />
                  ) : (
                    <Circle size={18} className="shrink-0 text-ink-300" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 text-cell text-ink-900">{METHODS[m] ?? m}</span>
                  <span
                    className={`text-caption font-medium ${isDone ? 'text-ok-fg' : 'text-ink-500'}`}
                  >
                    {isDone ? 'Completed' : 'Pending'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {application.confirmedAt !== null && (
        <p className="mt-4 border-t border-ink-100 pt-3 text-caption leading-5 text-ink-500">
          Confirmed {formatRelative(application.confirmedAt)}.
        </p>
      )}

      {/* The customer's surface, opened as the customer would see it. This is
          the demo hand-off, not an operator running the check — the customer
          app is where the check is actually performed. */}
      <Link
        to={`/apply/${application.productId}?subjectId=${subjectId}`}
        className="mt-4 inline-flex items-center gap-1.5 text-caption font-medium text-mint-700 underline-offset-2 hover:text-ink-900 hover:underline"
      >
        Open the customer app
        <ExternalLink size={13} aria-hidden="true" />
      </Link>
    </section>
  );
}
