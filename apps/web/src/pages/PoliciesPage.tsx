import { AlertTriangle } from 'lucide-react';
import { api, type ProductPolicy } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { formatDate } from '../lib/format.ts';
import {
  ATTRIBUTES,
  COLUMNS,
  EMPTY,
  LEVELS,
  NOTES,
  PAGE_TITLES,
  PRODUCTS,
} from '../copy/strings.ts';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { ErrorState } from '../components/ErrorState.tsx';

/**
 * Product policies — read-only.
 *
 * Small screen, quick to build, and it answers "who decides what Earned Wage
 * Access is allowed to rely on?" before it is asked.
 *
 * The whole table is read from GET /policies. Nothing about products is
 * hardcoded here, so the screen stays correct if a policy changes — including
 * the internal policies that are not customer-facing, which appear because
 * they are real and hiding them would misrepresent the table.
 */

function maxAge(days: number): string {
  if (days === 365) return '1 year';
  if (days % 365 === 0) return `${days / 365} years`;
  return `${days} days`;
}

function isPending(policy: ProductPolicy): boolean {
  return policy.approvedBy.some((a) => a.startsWith('PENDING:'));
}

export function PoliciesPage() {
  const { data, error, loading, reload } = useApi((signal) => api.policies(signal));

  if (error !== null) {
    return (
      <>
        <h1 className="text-title font-semibold text-white">{PAGE_TITLES.policies}</h1>
        <div className="mt-6">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </>
    );
  }

  const policies = data === null ? [] : Object.values(data);
  const anyPending = policies.some(isPending);

  const columns: Column<ProductPolicy>[] = [
    {
      key: 'product',
      header: COLUMNS.product,
      value: (p) => PRODUCTS[p.productId] ?? p.productId,
      render: (p) => (
        <span className="font-medium">{PRODUCTS[p.productId] ?? p.productId}</span>
      ),
    },
    {
      key: 'level',
      header: COLUMNS.minimumLevel,
      value: (p) => p.minAssurance,
      render: (p) => LEVELS[p.minAssurance].label,
    },
    {
      key: 'age',
      header: COLUMNS.maximumAge,
      value: (p) => p.maxAgeDays,
      render: (p) => maxAge(p.maxAgeDays),
    },
    {
      key: 'attributes',
      header: COLUMNS.attributesDisclosed,
      value: (p) => p.disclosableAttributes.map((a) => ATTRIBUTES[a] ?? a).join('; '),
      render: (p) =>
        p.disclosableAttributes.length === 0 ? (
          <span className="text-ink-500">Nothing — this product creates records rather than relying on them</span>
        ) : (
          <span className="text-ink-700">
            {p.disclosableAttributes.map((a) => ATTRIBUTES[a] ?? a).join(', ')}
          </span>
        ),
    },
    {
      key: 'effective',
      header: 'In force from',
      value: (p) => p.effectiveFrom,
      render: (p) => formatDate(p.effectiveFrom),
    },
  ];

  return (
    <>
      <h1 className="text-title font-semibold text-white">{PAGE_TITLES.policies}</h1>
      <p className="mt-2 max-w-3xl text-body text-white/75">{NOTES.policyGovernance}</p>

      {/* The pending state is shown rather than hidden. These values are
          engineering defaults drawn from the product manual; Compliance and the
          product owner have not signed them off, and a screen that implied they
          had would be the kind of overclaim this project cannot afford. */}
      {anyPending && (
        <div className="mt-4 flex items-start gap-3 rounded-card border border-warn-line bg-warn-bg px-4 py-3 text-warn-fg">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="text-cell leading-6">
            These settings are awaiting sign-off by Compliance and the product owner. They are
            working defaults for this environment, not approved policy.
          </p>
        </div>
      )}

      <div className="mt-6">
        <DataTable
          rows={policies}
          columns={columns}
          rowKey={(p) => p.productId}
          loading={loading}
          empty={EMPTY.policiesNone!}
          exportName="abhi-product-policies"
          caption={`${policies.length} products`}
        />
      </div>
    </>
  );
}
