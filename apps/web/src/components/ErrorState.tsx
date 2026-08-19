import { ApiError } from '../lib/api.ts';
import { ERRORS, type EmptyStateCopy } from '../copy/strings.ts';
import { EmptyState } from './EmptyState.tsx';
import { TechnicalDetail, TechnicalRow } from './TechnicalDetail.tsx';

/**
 * Turn a thrown error into a designed state.
 *
 * A failure a viewer can read is worth more than a console trace nobody sees.
 * The plain sentence is chosen from the error code; the raw detail and the
 * correlation id go behind the technical expander, where an engineer in the
 * room can still get at them.
 */
function copyFor(error: unknown): EmptyStateCopy {
  if (!(error instanceof ApiError)) return ERRORS.generic!;

  switch (error.code) {
    case 'ERR_GATEWAY_UNREACHABLE':
      return ERRORS.gatewayUnreachable!;
    case 'ERR_COMPLIANCE_ONLY':
    case 'ERR_INSUFFICIENT_ROLE':
      return ERRORS.notAuthorised!;
    case 'ERR_UNKNOWN_MSP':
      return ERRORS.writeRejected!;
    case 'ERR_SUBJECT_NOT_FOUND':
    case 'NOT_FOUND':
      return ERRORS.notFound!;
    case 'ERR_VAULT_UNAVAILABLE':
      return ERRORS.vaultUnavailable!;
    case 'ERR_RAIL_UNAVAILABLE':
      return ERRORS.railUnavailable!;
    default:
      return ERRORS.generic!;
  }
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const copy = copyFor(error);
  const api = error instanceof ApiError ? error : null;

  return (
    <div className="card">
      <EmptyState copy={copy} onAction={onRetry} />
      {api !== null && (
        <div className="px-6 pb-6">
          <TechnicalDetail>
            <TechnicalRow label="Error code">{api.code}</TechnicalRow>
            {api.status > 0 && <TechnicalRow label="HTTP status">{api.status}</TechnicalRow>}
            {api.detail !== null && <TechnicalRow label="Detail">{api.detail}</TechnicalRow>}
            {api.correlationId !== null && (
              <TechnicalRow label="Correlation id">{api.correlationId}</TechnicalRow>
            )}
          </TechnicalDetail>
        </div>
      )}
    </div>
  );
}
