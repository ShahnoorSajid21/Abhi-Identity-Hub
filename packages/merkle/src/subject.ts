import { hmacSha256Hex } from './hash.ts';

/**
 * CNIC normalisation. Order matters and must be identical everywhere.
 *
 * This is not cosmetic: the employer CSV template strips dashes while the app
 * captures them. Without shared normalisation the same customer resolves to
 * two different subjects and the entire premise of the ledger fails silently.
 */
export function normaliseCnic(raw: string): string {
  if (typeof raw !== 'string') throw new Error('ERR_INVALID_CNIC: not a string');

  const digits = raw.replace(/\D/g, '');

  // Fail closed. Never pad, never truncate — a padded CNIC is a different
  // person's CNIC.
  if (digits.length !== 13) throw new Error('ERR_INVALID_CNIC: must be exactly 13 digits');
  if (/^(\d)\1{12}$/.test(digits)) throw new Error('ERR_INVALID_CNIC: repeated-digit test value');

  return digits;
}

export interface PepperProvider {
  /** Current epoch. Every record records the epoch that derived its subjectId. */
  readonly epoch: number;
  /**
   * Compute HMAC-SHA256(pepper, message) without exposing the pepper.
   *
   * In production this is a PKCS#11 call to a non-extractable HSM key handle,
   * so the gateway process never holds the pepper at all.
   */
  hmac(message: Buffer): Promise<string>;
}

/**
 * Software pepper provider — DEVELOPMENT AND DEMO ONLY.
 *
 * Guarded at construction: this must never be instantiated in production. The
 * gateway additionally refuses to boot if NODE_ENV=production without a
 * PKCS#11 provider configured (see services/gateway/src/config.ts).
 */
export class SoftwarePepperProvider implements PepperProvider {
  readonly #pepper: Buffer;
  readonly epoch: number;

  constructor(pepper: Buffer, epoch = 1, allowInProduction = false) {
    if (process.env['NODE_ENV'] === 'production' && !allowInProduction) {
      throw new Error(
        'FATAL: SoftwarePepperProvider is not permitted in production. Configure a PKCS#11 HSM provider.',
      );
    }
    if (pepper.length < 32) throw new Error('pepper must be at least 32 bytes');
    this.#pepper = pepper;
    this.epoch = epoch;
  }

  hmac(message: Buffer): Promise<string> {
    return Promise.resolve(hmacSha256Hex(this.#pepper, message));
  }
}

/** subject_id = HMAC-SHA256(pepper, normalise(CNIC)) */
export async function deriveSubjectId(cnic: string, pepper: PepperProvider): Promise<string> {
  const normalised = normaliseCnic(cnic);
  return pepper.hmac(Buffer.from(normalised, 'utf8'));
}
