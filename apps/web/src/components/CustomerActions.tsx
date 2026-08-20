import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Snowflake } from 'lucide-react';
import { api, ApiError, type CustomerRecord } from '../lib/api.ts';
import { usePersona } from '../lib/useApi.ts';
import { useToast } from './Toast.tsx';
import { ACTIONS, CUSTOMER_FACING_PRODUCTS, NOTES, PRODUCTS } from '../copy/strings.ts';

/**
 * The three actions available on a customer profile.
 *
 * All three were previously rendered as buttons with no handler at all: they
 * carried a hover state, took focus, and did nothing when pressed. That is the
 * single worst thing a demo can do, because the audience concludes the whole
 * screen is a mockup.
 *
 * Each one now performs a real gateway call, keyed by subject id. The console
 * holds no CNIC by design, so these use the subjectId-accepting form of the
 * write endpoints rather than asking an operator to retype a card number.
 */

type Panel = 'none' | 'verify' | 'update' | 'freeze';

/** Five years out, RFC 3339, matching what the register path writes. */
function defaultCnicExpiry(): string {
  return new Date(Date.now() + 5 * 365 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function CustomerActions({
  subjectId,
  displayName,
  record,
  onChanged,
}: {
  subjectId: string;
  displayName: string;
  record: CustomerRecord;
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

  function close() {
    setPanel('none');
    setError(null);
    setReason('');
    setReference('');
  }

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(success, 'ok');
      close();
      onChanged();
    } catch (e) {
      // The gateway's own message is more useful than anything invented here —
      // ERR_COMPLIANCE_ONLY and ERR_ATTEMPT_CAP_EXCEEDED both say exactly what
      // went wrong and who enforces it.
      setError(e instanceof ApiError ? (e.detail ?? e.code) : String(e));
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-control border border-ink-200 px-3 py-2 text-cell text-ink-900 placeholder:text-ink-500 focus:border-mint-500 focus:outline-none focus:ring-2 focus:ring-mint-500/25';

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPanel(panel === 'verify' ? 'none' : 'verify')}
          aria-expanded={panel === 'verify'}
          className="rounded-control bg-mint-500 px-4 py-2 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600"
        >
          {ACTIONS.runVerification}
        </button>

        <button
          type="button"
          onClick={() => setPanel(panel === 'update' ? 'none' : 'update')}
          aria-expanded={panel === 'update'}
          className="rounded-control border border-ink-200 px-4 py-2 text-cell font-medium text-ink-700 transition-colors duration-fast hover:border-mint-500 hover:text-ink-900"
        >
          {ACTIONS.updateIdentity}
        </button>

        {/* Present but disabled for non-Compliance. The tooltip says who
            enforces it, because the UI restriction is a convenience — the
            ledger is the control, and it rejects the write regardless. */}
        <button
          type="button"
          disabled={!persona.canFreeze}
          title={persona.canFreeze ? undefined : NOTES.freezeRestricted}
          onClick={() => setPanel(panel === 'freeze' ? 'none' : 'freeze')}
          aria-expanded={panel === 'freeze'}
          className="inline-flex items-center gap-2 rounded-control border border-stop-line px-4 py-2 text-cell font-medium text-stop-fg transition-colors duration-fast hover:bg-stop-bg disabled:cursor-not-allowed disabled:border-ink-200 disabled:text-ink-500 disabled:hover:bg-transparent"
        >
          <Snowflake size={15} />
          {frozen ? ACTIONS.reinstate : ACTIONS.freeze}
        </button>
      </div>

      {panel !== 'none' && (
        <div className="mt-4 w-full rounded-card border border-ink-200 bg-ink-50 p-4">
          {panel === 'verify' && (
            <>
              <p className="text-cell font-medium text-ink-900">
                Check {displayName} against a product
              </p>
              <p className="mt-1 text-caption leading-5 text-ink-500">
                Asks the ledger what this product needs and what is already on file. Nothing is
                written.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-[200px] flex-1">
                  <span className="label-caption">Product</span>
                  <select
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    className={`${field} mt-1 bg-white`}
                  >
                    {CUSTOMER_FACING_PRODUCTS.map((p) => (
                      <option key={p} value={p}>
                        {PRODUCTS[p] ?? p}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => navigate(`/apply/${product}?subjectId=${subjectId}`)}
                  className="rounded-control bg-mint-500 px-4 py-2 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600"
                >
                  Run the check
                </button>
              </div>
            </>
          )}

          {panel === 'update' && (
            <>
              <p className="text-cell font-medium text-ink-900">Update {displayName}'s identity</p>
              <p className="mt-1 text-caption leading-5 text-ink-500">
                Runs only the checks this product still needs and appends a new version. Everything
                already confirmed is reused — nothing is re-run.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label>
                  <span className="label-caption">Product</span>
                  <select
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    className={`${field} mt-1 bg-white`}
                  >
                    {CUSTOMER_FACING_PRODUCTS.map((p) => (
                      <option key={p} value={p}>
                        {PRODUCTS[p] ?? p}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label-caption">Reason (recorded on the ledger)</span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Step-up for SBL application"
                    className={`${field} mt-1`}
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={busy || reason.trim().length === 0}
                onClick={() =>
                  void run(
                    () =>
                      api.update({
                        subjectId,
                        productId: product,
                        // The step-up runs the missing rails itself; these are
                        // the outcome attributes it commits on success.
                        attributes: {
                          verisys_match: true,
                          document_authenticity_pass: true,
                          biometric_match: true,
                          liveness_pass: product === 'SBL' || product === 'MERCHANT_FINANCING',
                        },
                        cnicExpiryAt: record.cnicExpiryAt ?? defaultCnicExpiry(),
                        reason: reason.trim(),
                      }),
                    `${displayName}'s identity record was updated.`,
                  )
                }
                className="mt-3 rounded-control bg-mint-500 px-4 py-2 text-cell font-semibold text-navy-900 transition-colors duration-fast hover:bg-mint-600 disabled:opacity-40"
              >
                {busy ? 'Running…' : 'Run the missing checks'}
              </button>
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
                    frozen
                      ? `${displayName} was reinstated.`
                      : `${displayName} was frozen. Every product now denies against this record.`,
                  )
                }
                className="mt-3 rounded-control border border-stop-line bg-stop-bg px-4 py-2 text-cell font-semibold text-stop-fg transition-colors duration-fast hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Recording…' : frozen ? 'Release the hold' : 'Freeze this record'}
              </button>
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
