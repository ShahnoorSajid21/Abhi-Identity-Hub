import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link2, Lock, Snowflake } from 'lucide-react';
import { api, directory, type AssuranceLevel, type CustomerDetail, type ProductPolicy } from '../lib/api.ts';
import { useApi, usePersona } from '../lib/useApi.ts';
import { daysSince, formatDate, formatDateLong, formatRelative, formatTimestamp } from '../lib/format.ts';
import {
  ACTIONS,
  ATTRIBUTES,
  CUSTOMER_FACING_PRODUCTS,
  EMPTY,
  LEVELS,
  METHODS,
  NOTES,
  PRODUCTS,
  TABS,
} from '../copy/strings.ts';
import { IdentityStatus } from '../components/IdentityStatus.tsx';
import { StatusChip } from '../components/StatusChip.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { ErrorState } from '../components/ErrorState.tsx';
import { SkeletonCard } from '../components/LoadingSkeleton.tsx';
import { TechnicalDetail, TechnicalRow, CopyableId } from '../components/TechnicalDetail.tsx';
import { Avatar } from '../components/Avatar.tsx';

/**
 * The customer profile — the heart of the app.
 *
 * Two sources, kept visually and structurally distinct: the Identity card is
 * ledger truth and carries a mint Ledger tag; the Customer details card is
 * core banking and carries a slate one. The standing sentence under the
 * Identity card says so in words, because that sentence does more for the
 * compliance conversation than a slide would.
 */

type TabId = 'identity' | 'history' | 'products' | 'activity';

const RANK: Record<AssuranceLevel, number> = { A0: 0, A1: 1, A2: 2, A3: 3 };

/**
 * What a product would decide for this customer right now.
 *
 * A PREVIEW, computed from the same inputs the gateway's engine uses. The
 * server remains authoritative — this never writes anything and never claims
 * to have run a verification. It exists so the tab can answer "what does each
 * product actually see?" without firing four real verifications.
 */
function previewDecision(
  record: CustomerDetail['record'],
  policy: { minAssurance: AssuranceLevel; maxAgeDays: number },
  now: Date,
): { outcome: 'ALLOW' | 'STEP_UP' | 'FULL_KYC' | 'DENY'; why: string } {
  if (!record.found || record.assuranceLevel === null) {
    return { outcome: 'FULL_KYC', why: 'No confirmed identity yet.' };
  }
  if (record.status === 'SUSPENDED') {
    return { outcome: 'DENY', why: 'Frozen by Compliance.' };
  }
  if (record.status === 'SHREDDED') {
    return { outcome: 'DENY', why: 'Personal details were erased at the customer’s request.' };
  }
  if (record.cnicExpiryAt !== null && new Date(record.cnicExpiryAt) < now) {
    return { outcome: 'DENY', why: 'Their CNIC has expired. They must renew it with NADRA.' };
  }

  const age = daysSince(record.verifiedAt, now);
  if (RANK[record.assuranceLevel] < RANK[policy.minAssurance]) {
    return {
      outcome: 'STEP_UP',
      why: `Needs ${LEVELS[policy.minAssurance].label.toLowerCase()}.`,
    };
  }
  if (age !== null && age > policy.maxAgeDays) {
    return {
      outcome: 'STEP_UP',
      why: `Confirmed ${age} days ago; this product accepts up to ${policy.maxAgeDays}.`,
    };
  }
  return { outcome: 'ALLOW', why: 'Already confirmed to the standard this product needs.' };
}

const OUTCOME_CHIP: Record<string, string> = {
  ALLOW: 'bg-ok-bg text-ok-fg',
  STEP_UP: 'bg-warn-bg text-warn-fg',
  FULL_KYC: 'bg-new-bg text-new-fg',
  DENY: 'bg-stop-bg text-stop-fg',
};

const OUTCOME_LABEL: Record<string, string> = {
  ALLOW: 'Ready to proceed',
  STEP_UP: 'One more check needed',
  FULL_KYC: 'Full onboarding',
  DENY: 'Cannot proceed',
};

/** Ledger actions, as sentences a non-technical reader follows without help. */
const HISTORY_TITLE: Record<string, string> = {
  REGISTER: 'Identity first confirmed',
  UPDATE: 'Identity updated',
  SUSPEND: 'Frozen by Compliance',
  REINSTATE: 'Reinstated by Compliance',
  SHRED: 'Personal details erased',
};

export function CustomerProfilePage() {
  const { subjectId = '' } = useParams();
  const [tab, setTab] = useState<TabId>('identity');
  const persona = usePersona();

  const detail = useApi((signal) => directory.customer(subjectId, signal), [subjectId]);
  const history = useApi((signal) => directory.history(subjectId, signal), [subjectId]);
  const activity = useApi((signal) => directory.activity(subjectId, signal), [subjectId]);
  const consents = useApi((signal) => directory.consents(subjectId, signal), [subjectId]);
  const policies = useApi((signal) => api.policies(signal));

  if (detail.error !== null) {
    return <ErrorState error={detail.error} onRetry={detail.reload} />;
  }
  if (detail.data === null) {
    return (
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonCard lines={4} />
        </div>
        <SkeletonCard lines={3} />
      </div>
    );
  }

  const { record, cbsProfile } = detail.data;
  const now = new Date();
  const level = record.assuranceLevel ?? 'A0';

  const productRows = Object.values(policies.data ?? {})
    .filter((p: ProductPolicy) => CUSTOMER_FACING_PRODUCTS.includes(p.productId))
    .map((p: ProductPolicy) => ({ policy: p, ...previewDecision(record, p, now) }));

  const TABS_LIST: { id: TabId; label: string }[] = [
    { id: 'identity', label: TABS.identity },
    { id: 'history', label: TABS.identityHistory },
    { id: 'products', label: TABS.productAccess },
    { id: 'activity', label: TABS.activity },
  ];

  return (
    <>
      {/* --- Header band ------------------------------------------------ */}
      <div className="card flex flex-wrap items-start gap-4 p-5">
        <Avatar name={cbsProfile.displayName} seed={cbsProfile.avatarSeed} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-title font-semibold text-ink-900">{cbsProfile.displayName}</h1>
            {record.status !== null && <StatusChip status={record.status} />}
          </div>
          <p className="mt-1 text-body text-ink-700">
            {cbsProfile.designation} · {cbsProfile.employer}
          </p>
          <p className="tabular mt-0.5 text-cell text-ink-500">
            {cbsProfile.cnicMasked ?? 'CNIC not held here'} · {cbsProfile.employeeCode}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-control bg-navy-700 px-4 py-2 text-cell font-medium text-white transition-colors duration-fast hover:bg-navy-600"
          >
            {ACTIONS.runVerification}
          </button>
          <button
            type="button"
            className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100"
          >
            {ACTIONS.updateIdentity}
          </button>
          {/* Present but disabled for non-Compliance. The tooltip says who
              enforces it, because the UI restriction is a convenience — the
              ledger is the control. */}
          <button
            type="button"
            disabled={!persona.canFreeze}
            title={persona.canFreeze ? undefined : NOTES.freezeRestricted}
            className="inline-flex items-center gap-2 rounded-control border border-stop-line px-4 py-2 text-cell font-medium text-stop-fg transition-colors duration-fast hover:bg-stop-bg disabled:cursor-not-allowed disabled:border-ink-200 disabled:text-ink-500 disabled:hover:bg-transparent"
          >
            <Snowflake size={15} />
            {ACTIONS.freeze}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* --- Left column ---------------------------------------------- */}
        <div className="lg:col-span-2">
          <div className="flex gap-1 border-b border-ink-200">
            {TABS_LIST.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-cell font-medium transition-colors duration-fast ${
                  tab === t.id
                    ? 'border-mint-600 text-ink-900'
                    : 'border-transparent text-ink-500 hover:text-ink-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'identity' && (
            <section className="card mt-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-section font-semibold text-ink-900">Identity</h2>
                <span className="rounded-pill bg-mint-100 px-2.5 py-0.5 text-caption font-medium text-ok-fg">
                  Ledger
                </span>
              </div>

              <div className="mt-4">
                {record.found ? (
                  <IdentityStatus
                    level={level}
                    verifiedAt={record.verifiedAt}
                    cnicExpiryAt={record.cnicExpiryAt}
                    methods={record.methods}
                    size="lg"
                  />
                ) : (
                  <EmptyState copy={EMPTY.profileNoIdentity!} compact />
                )}
              </div>

              <TechnicalDetail>
                <TechnicalRow label="subjectId">
                  <CopyableId value={record.subjectId} />
                </TechnicalRow>
                {record.merkleRoot !== null && (
                  <TechnicalRow label="merkleRoot">
                    <CopyableId value={record.merkleRoot} />
                  </TechnicalRow>
                )}
                <TechnicalRow label="version">{record.version ?? '—'}</TechnicalRow>
                <TechnicalRow label="attributeSetId">{record.attributeSetId ?? '—'}</TechnicalRow>
                <TechnicalRow label="Endorsing organisations">
                  ABHI Compliance ✓ &nbsp; ABHI Bank ✓
                </TechnicalRow>
              </TechnicalDetail>
            </section>
          )}

          {tab === 'history' && (
            <section className="card mt-4 p-5">
              <h2 className="text-section font-semibold text-ink-900">{TABS.identityHistory}</h2>

              {history.data === null ? (
                <div className="mt-4">
                  <SkeletonCard lines={3} />
                </div>
              ) : history.data.versions.length <= 1 ? (
                <>
                  <ol className="mt-4">
                    {history.data.versions.map((v) => (
                      <HistoryEntry key={v.version} entry={v} />
                    ))}
                  </ol>
                  <EmptyState copy={EMPTY.profileHistorySingle!} compact />
                </>
              ) : (
                <ol className="mt-4">
                  {[...history.data.versions]
                    .sort((a, b) => b.version - a.version)
                    .map((v) => (
                      <HistoryEntry key={v.version} entry={v} />
                    ))}
                </ol>
              )}

              <p className="mt-4 flex items-start gap-2 border-t border-ink-100 pt-3 text-caption leading-5 text-ink-500">
                <Link2 size={14} className="mt-0.5 shrink-0" />
                {NOTES.historyImmutable}
              </p>
            </section>
          )}

          {tab === 'products' && (
            <section className="card mt-4 p-5">
              <h2 className="text-section font-semibold text-ink-900">{TABS.productAccess}</h2>
              <p className="mt-1 text-cell text-ink-500">
                What each product would decide for this customer right now, and what it would be
                shown.
              </p>

              <ul className="mt-4 divide-y divide-ink-100">
                {productRows.map(({ policy, outcome, why }) => (
                  <li key={policy.productId} className="py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-body font-medium text-ink-900">
                        {PRODUCTS[policy.productId] ?? policy.productId}
                      </span>
                      <span
                        className={`rounded-pill px-2.5 py-0.5 text-caption font-medium ${OUTCOME_CHIP[outcome]}`}
                      >
                        {OUTCOME_LABEL[outcome]}
                      </span>
                    </div>
                    <p className="mt-1 text-cell text-ink-700">{why}</p>
                    <p className="mt-1 text-caption text-ink-500">
                      Requires {LEVELS[policy.minAssurance].label.toLowerCase()}, confirmed within
                      the last {policy.maxAgeDays} days.
                    </p>
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {policy.disclosableAttributes.map((a) => (
                        <span
                          key={a}
                          className="rounded-pill bg-ink-100 px-2 py-0.5 text-caption text-ink-700"
                        >
                          {ATTRIBUTES[a] ?? a}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption text-ink-500">
                        <Lock size={11} />
                        everything else stays hidden
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === 'activity' && (
            <section className="card mt-4 p-5">
              <h2 className="text-section font-semibold text-ink-900">{TABS.activity}</h2>
              {activity.data === null || activity.data.events.length === 0 ? (
                <EmptyState copy={EMPTY.profileNoActivity!} compact />
              ) : (
                <ul className="mt-3 divide-y divide-ink-100">
                  {activity.data.events.map((e, i) => {
                    const event = e as Record<string, string | null>;
                    return (
                      <li key={String(event['eventId'] ?? i)} className="py-3">
                        <p className="text-cell text-ink-900">
                          {HISTORY_TITLE[String(event['action'])] ?? String(event['action'])}
                          {event['requestedFor'] !== null &&
                            ` · ${PRODUCTS[String(event['requestedFor'])] ?? String(event['requestedFor'])}`}
                        </p>
                        <p className="text-caption text-ink-500">
                          <span title={formatTimestamp(String(event['occurredAt']))}>
                            {formatRelative(String(event['occurredAt']))}
                          </span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* --- Right column --------------------------------------------- */}
        <div className="space-y-5">
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-section font-semibold text-ink-900">Customer details</h2>
              <span className="rounded-pill bg-ink-100 px-2.5 py-0.5 text-caption font-medium text-ink-700">
                Core banking
              </span>
            </div>
            <dl className="mt-4 space-y-3">
              <Field label="Employer" value={cbsProfile.employer} />
              <Field label="Designation" value={cbsProfile.designation} />
              <Field label="Employee code" value={cbsProfile.employeeCode} />
              <Field label="Joined" value={formatDate(cbsProfile.joinedAt)} />
              <Field label="CNIC" value={cbsProfile.cnicMasked ?? '—'} />
            </dl>
            {/* The ledger-holds-no-data sentence belongs under the Identity
                card, where the lg trust meter renders it. Repeating it here
                would say the same thing twice on one screen. */}
          </section>

          <section className="card p-5">
            <h2 className="text-section font-semibold text-ink-900">Consent</h2>
            {consents.data === null || consents.data.consents.length === 0 ? (
              <EmptyState copy={EMPTY.profileNoConsent!} compact />
            ) : (
              <ul className="mt-3 divide-y divide-ink-100">
                {consents.data.consents.map((c, i) => {
                  const consent = c as Record<string, string>;
                  return (
                    <li key={String(consent['consentId'] ?? i)} className="py-3">
                      <p className="text-cell font-medium text-ink-900">
                        {PRODUCTS[String(consent['grantedTo'])] ?? String(consent['grantedTo'])}
                      </p>
                      <p className="text-caption text-ink-500">
                        {String(consent['purpose'])} · until {formatDate(String(consent['expiresAt']))}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-cell text-ink-500">{label}</dt>
      <dd className="text-cell text-ink-900">{value}</dd>
    </div>
  );
}

/** One version, as a plain sentence with the technical detail behind an expander. */
function HistoryEntry({ entry }: { entry: Record<string, unknown> }) {
  const version = Number(entry['version'] ?? 0);
  const level = String(entry['assuranceLevel'] ?? 'A0') as AssuranceLevel;
  const methods = (entry['methods'] as string[] | undefined) ?? [];
  const verifiedAt = String(entry['verifiedAt'] ?? '');
  const status = String(entry['status'] ?? '');

  const title =
    version === 1
      ? 'Identity first confirmed'
      : status === 'SUSPENDED'
        ? 'Frozen by Compliance'
        : `Upgraded to ${LEVELS[level].label.toLowerCase()}`;

  return (
    <li className="relative border-l-2 border-mint-300 pb-6 pl-6 last:pb-0">
      <span className="absolute -left-[7px] top-1 block h-3 w-3 rounded-pill border-2 border-white bg-mint-500" />
      <p className="text-body font-semibold text-ink-900">
        {formatDateLong(verifiedAt)} — {title}
      </p>
      <p className="mt-1 text-cell leading-6 text-ink-700">
        {methods.map((m) => METHODS[m] ?? m).join(', ')}. Signed off by ABHI Compliance and ABHI
        Bank.
      </p>
      <TechnicalDetail>
        <TechnicalRow label="version">
          v{version} · {status}
        </TechnicalRow>
        <TechnicalRow label="merkleRoot">
          <CopyableId value={String(entry['merkleRoot'] ?? '')} />
        </TechnicalRow>
        <TechnicalRow label="previousVersionHash">
          {entry['previousVersionHash'] === null ? (
            'none — first version'
          ) : (
            <CopyableId value={String(entry['previousVersionHash'])} />
          )}
        </TechnicalRow>
        <TechnicalRow label="txId">{String(entry['createdTxId'] ?? '—')}</TechnicalRow>
      </TechnicalDetail>
    </li>
  );
}
