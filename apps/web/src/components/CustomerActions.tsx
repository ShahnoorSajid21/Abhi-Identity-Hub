import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Snowflake, Sun } from 'lucide-react';
import { api, ApiError, type CustomerRecord, type ProductPolicy } from '../lib/api.ts';
import {
  missingMethods,
  previewDecision,
  OUTCOME_CHIP,
  OUTCOME_LABEL,
  type PolicyShape,
} from '../lib/readiness.ts';
import { openApplication } from '../lib/applications.ts';
import { usePersona } from '../lib/useApi.ts';
import { useToast } from './Toast.tsx';
import { ACTIONS, CUSTOMER_FACING_PRODUCTS, NOTES, PRODUCTS } from '../copy/strings.ts';

/**
 * The actions available to an INTERNAL operator on a customer profile.
 *
 * The important word is internal. This screen belongs to bank staff, and the
 * checks a customer still owes are the customer's to perform — in the customer
 * app, not here. So the operator's job from this header is to see where the
 * customer stands and to open the application that sends those checks to them;
 * it is not to run a fingerprint scan on the customer's behalf.
 *
 * That is a deliberate narrowing. There used to be a "Run missing checks"
 * button here that wrote a step-up straight to the ledger — the operator
 * standing in for the customer. It has been removed: opening the application
 * identifies the outstanding checks and makes them available to the customer,
 * and the profile's status panel then watches them land. The only write left
 * on this header is the Compliance freeze, which is genuinely an internal act.
 */

type Panel = 'none' | 'check' | 'freeze';

export function CustomerActions({
  subjectId,
  displayName,
  record,
  policies,
  onChanged,
}: {
  subjectId: string;
  displayName: string;
  record: CustomerRecord;
  /** From GET /policies, already loaded by the profile. Null while it loads. */
  policies: Record<string, ProductPolicy> | null;
  /** Re-fetch the profile after a write so the screen reflects the ledger. */
  onChanged: () => void;
}) {
  const persona = usePersona();
  const navigate = useNavigate();
  const toast = useToast();

  const [panel, setPanel] = useState<Panel>('none');
  const [product, setProduct] = useState('EWA');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frozen = record.status === 'SUSPENDED';

  /**
   * What the ledger already holds for the selected product.
   *
   * Null only while the policy table is in flight. Every panel degrades to
   * plain product names in that window rather than blocking on a request the
   * profile has already made.
   */
  const policy: PolicyShape | null = policies?.[product] ?? null;
  const now = new Date();
  const decision = policy === null ? null : previewDecision(record, policy, now);
  const missing = policy === null ? [] : missingMethods(record, policy);

  function close() {
    setPanel('none');
    setError(null);
    setReason('');
    setReference('');
  }

  function open(next: Panel) {
    setPanel(panel === next ? 'none' : next);
    setError(null);
  }

  /**
   * Open the application for the selected product.
   *
   * This is the hand-off point. It records the outstanding checks against the
   * customer so the customer app knows what to ask for and the profile's
   * status panel knows what to watch, then navigates into the customer-facing
   * journey. It writes nothing to the identity ledger — a DENY is never given
   * a checklist, because nothing the customer does would clear it.
   */
  function openApplicationFor() {
    if (decision !== null && decision.outcome !== 'DENY') {
      openApplication(subjectId, product, missing);
    }
    navigate(`/apply/${product}?subjectId=${subjectId}`);
  }

  async function run(fn: () => Promise<unknown>, success: (result: unknown) => string) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      toast(success(result), 'ok');
      close();
      onChanged();
    } catch (e) {
      // The gateway's own message is more useful than anything invented here —
      // ERR_COMPLIANCE_ONLY says exactly what went wrong and who enforces it.
      setError(e instanceof ApiError ? (e.detail ?? e.code) : String(e));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-control border border-ink-200 px-3 py-2 text-cell text-ink-900 placeholder:text-ink-500 focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/25';

  /**
   * The product picker.
   *
   * Each option carries the outcome for that product, so the answer an operator
   * opened the panel to find is visible before they choose anything.
   */
  function productPicker() {
    return (
      <label className="min-w-[220px] flex-1">
        <span className="label-caption">Product</span>
        <select
          value={product}
          onChange={(e) => {
            setProduct(e.target.value);
            setError(null);
          }}
          className={`${field} mt-1 bg-white`}
        >
          {CUSTOMER_FACING_PRODUCTS.map((p) => {
            const name = PRODUCTS[p] ?? p;
            const pp = policies?.[p];
            const outcome = pp === undefined ? null : previewDecision(record, pp, now).outcome;
            return (
              <option key={p} value={p}>
                {outcome === null ? name : `${name} — ${OUTCOME_LABEL[outcome]}`}
              </option>
            );
          })}
        </select>
      </label>
    );
  }

  /** The chip and sentence that say where this customer stands on a product. */
  function statusLine() {
    if (decision === null) {
      return <p className="mt-3 text-caption text-ink-500">Loading what this product requires…</p>;
    }
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-pill px-2.5 py-0.5 text-caption font-medium ${OUTCOME_CHIP[decision.outcome]}`}
        >
          {OUTCOME_LABEL[decision.outcome]}
        </span>
        <span className="text-caption text-ink-700">{decision.why}</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => open('check')}
          aria-expanded={panel === 'check'}
          aria-controls="customer-action-panel"
          className="rounded-control bg-mint-500 px-4 py-2 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600"
        >
          {ACTIONS.checkEligibility}
        </button>

        {/*
          Compliance only, and absent rather than disabled for everyone else.
          A dead control teaches an operator nothing except that the screen has
          dead controls, and the two personas who cannot freeze have no
          decision to make here.

          Hiding it is still only a convenience. The ledger is the control and
          rejects the write regardless of what is rendered — /compliance keeps
          the button visible-but-disabled beside an "attempt anyway" escape
          hatch precisely so that rejection can be shown happening.
        */}
        {persona.canFreeze && (
          <button
            type="button"
            onClick={() => open('freeze')}
            aria-expanded={panel === 'freeze'}
            aria-controls="customer-action-panel"
            className="inline-flex items-center gap-2 rounded-control border border-stop-line px-4 py-2 text-cell font-medium text-stop-fg transition-colors duration-fast hover:bg-stop-bg"
          >
            {frozen ? <Sun size={15} /> : <Snowflake size={15} />}
            {frozen ? ACTIONS.releaseHold : ACTIONS.freeze}
          </button>
        )}
      </div>

      {panel !== 'none' && (
        <div
          id="customer-action-panel"
          className="mt-4 w-full rounded-card border border-ink-200 bg-ink-50 p-4"
        >
          {panel === 'check' && (
            <>
              <p className="text-cell font-medium text-ink-900">
                What can {displayName} get right now?
              </p>
              <p className="mt-1 text-caption leading-5 text-ink-500">
                Compares what each product requires against what the ledger already holds.
              </p>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                {productPicker()}
                <button
                  type="button"
                  onClick={openApplicationFor}
                  disabled={decision?.outcome === 'DENY'}
                  className="inline-flex items-center gap-2 rounded-control bg-mint-500 px-4 py-2 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600 disabled:opacity-40"
                >
                  Open the application
                  <ArrowRight size={15} />
                </button>
              </div>

              {statusLine()}

              {/* What opening the application will do, said plainly — the checks
                  are the customer's to perform, and this is where they are
                  handed over rather than run on their behalf. */}
              {decision !== null && decision.outcome !== 'DENY' && (
                <p className="mt-3 text-caption leading-5 text-ink-700">
                  {missing.length === 0
                    ? `${displayName} is already confirmed to the standard this product needs. Opening the application takes them straight to confirmation.`
                    : `Opening the application sends ${missing.length === 1 ? 'one check' : `${missing.length} checks`} to ${displayName} to complete. You will see each one land on this profile as it is done.`}
                </p>
              )}

              <p className="mt-3 text-caption leading-5 text-ink-500">
                {NOTES.eligibilityPreview}
              </p>
            </>
          )}

          {panel === 'freeze' && (
            <>
              <p className="text-cell font-medium text-ink-900">
                {frozen ? 'Release the hold on' : 'Freeze'} {displayName}
              </p>
              <p className="mt-1 text-caption leading-5 text-ink-500">
                {frozen
                  ? 'Every product will be able to rely on this record again immediately.'
                  : 'Every product is denied against this record immediately, and the reason is written to the ledger.'}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label>
                  <span className="label-caption">Reason</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={frozen ? 'e.g. Investigation closed' : 'e.g. AML alert'}
                    className={`${field} mt-1`}
                  />
                </label>
                <label>
                  <span className="label-caption">Case reference</span>
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. CASE-2026-114"
                    className={`${field} mt-1`}
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={busy || reason.trim().length === 0 || reference.trim().length === 0}
                onClick={() =>
                  void run(
                    () =>
                      frozen
                        ? api.reinstate({
                            subjectId,
                            reason: reason.trim(),
                            referenceId: reference.trim(),
                          })
                        : api.suspend({
                            subjectId,
                            reason: reason.trim(),
                            referenceId: reference.trim(),
                          }),
                    () =>
                      frozen
                        ? `${displayName} was reinstated.`
                        : `${displayName} was frozen. Every product now denies against this record.`,
                  )
                }
                className="mt-3 rounded-control border border-stop-line bg-stop-bg px-4 py-2 text-cell font-semibold text-stop-fg transition-colors duration-fast hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Recording…' : frozen ? 'Release the hold' : 'Freeze this record'}
              </button>
              {(reason.trim().length === 0 || reference.trim().length === 0) && (
                <p className="mt-2 text-caption text-ink-500">
                  Both a reason and a case reference are required — the ledger records them with the
                  freeze.
                </p>
              )}
            </>
          )}

          {error !== null && (
            <p className="mt-3 rounded-control border border-stop-line bg-stop-bg px-3 py-2 text-caption text-stop-fg">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={close}
            className="mt-3 block text-caption font-medium text-ink-500 underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
