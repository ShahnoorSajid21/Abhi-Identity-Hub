import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import { directory } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { formatDate } from '../lib/format.ts';
import { LEVELS, METHODS } from '../copy/strings.ts';
import { Avatar } from './Avatar.tsx';
import { StatusChip } from './StatusChip.tsx';
import { CustomerChecks } from './CustomerChecks.tsx';
import { SkeletonCard } from './LoadingSkeleton.tsx';
import { ErrorState } from './ErrorState.tsx';

/**
 * A customer's profile, opened for review over the employer-onboarding list.
 *
 * It exists so a reviewer can inspect one customer and return to exactly the
 * list they left — same upload, same segment, same scroll. A full-page
 * navigation to /customers/:id could not promise that: the thousand-row triage
 * would unmount and be gone. So this is a slide-over. The onboarding page stays
 * mounted underneath, the reviewer moves from one customer to the next by
 * clicking down the list, and nothing about the employer context is lost.
 *
 * It shows only what the POC already holds — core-banking display fields and
 * the ledger record — plus the application's check status, reused from the same
 * panel the profile uses. No customer data is invented for the review.
 */
export function CustomerReviewDrawer({
  subjectId,
  onClose,
}: {
  subjectId: string;
  onClose: () => void;
}) {
  const detail = useApi((signal) => directory.customer(subjectId, signal), [subjectId]);

  // Escape closes, matching the drill-down's own Close affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-navy-900/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-ink-50 shadow-panel">
        <div className="flex items-center justify-between border-b border-ink-200 bg-white px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:text-ink-900"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to the list
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-500 transition-colors duration-fast hover:text-ink-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          {detail.error !== null ? (
            <ErrorState error={detail.error} onRetry={detail.reload} />
          ) : detail.data === null ? (
            <SkeletonCard lines={4} />
          ) : (
            <>
              <section className="card p-5">
                <div className="flex items-start gap-3">
                  <Avatar
                    name={detail.data.cbsProfile.displayName}
                    seed={detail.data.cbsProfile.avatarSeed}
                    size={48}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-section font-semibold text-ink-900">
                        {detail.data.cbsProfile.displayName}
                      </h2>
                      {detail.data.record.status !== null && (
                        <StatusChip status={detail.data.record.status} />
                      )}
                    </div>
                    <p className="mt-0.5 text-cell text-ink-700">
                      {detail.data.cbsProfile.designation} · {detail.data.cbsProfile.employer}
                    </p>
                  </div>
                </div>

                <dl className="mt-4 space-y-3">
                  <Field
                    label="KYC status"
                    value={
                      detail.data.record.assuranceLevel === null
                        ? 'No confirmed identity'
                        : LEVELS[detail.data.record.assuranceLevel].label
                    }
                  />
                  <Field
                    label="Confirmed checks"
                    value={
                      detail.data.record.methods.filter((m) => m !== 'ASSERTED').length === 0
                        ? '—'
                        : detail.data.record.methods
                            .filter((m) => m !== 'ASSERTED')
                            .map((m) => METHODS[m] ?? m)
                            .join(', ')
                    }
                  />
                  <Field
                    label="Confirmed on"
                    value={
                      detail.data.record.verifiedAt === null
                        ? '—'
                        : formatDate(detail.data.record.verifiedAt)
                    }
                  />
                  <Field label="CNIC" value={detail.data.cbsProfile.cnicMasked ?? '—'} />
                  <Field label="Employee code" value={detail.data.cbsProfile.employeeCode} />
                  <Field label="Customer ID" value={detail.data.record.subjectId} mono />
                </dl>
              </section>

              {/* The same monitor-only check status the profile shows. */}
              <CustomerChecks
                subjectId={subjectId}
                displayName={detail.data.cbsProfile.displayName}
                record={detail.data.record}
                surface="review"
              />

              <Link
                to={`/customers/${subjectId}`}
                className="inline-flex items-center gap-1.5 text-caption font-medium text-mint-700 underline-offset-2 hover:text-ink-900 hover:underline"
              >
                Open the full profile
                <ExternalLink size={13} aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-cell text-ink-500">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-cell text-ink-900 ${mono ? 'tabular' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
