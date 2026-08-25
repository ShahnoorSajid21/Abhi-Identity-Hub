import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  createHash,
} from 'node:crypto';

/**
 * GCM parameters, named because the tag length has to be stated rather than
 * defaulted.
 *
 * Node accepts any GCM tag length the caller happens to pass to setAuthTag —
 * 4, 8, 12, 13, 14, 15 or 16 bytes — unless authTagLength pins it at
 * construction. A caller that slices a tag out of an attacker-supplied blob
 * therefore lets the attacker choose how much authentication to verify, and a
 * short tag is materially easier to forge. Pinned at 16 on every cipher and
 * decipher in this file and in vault.ts.
 */
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;

/**
 * HSM port.
 *
 * Production is a PKCS#11 session against a FIPS 140-2 Level 3 appliance with
 * non-extractable key handles. The gateway process never holds the pepper or
 * the KEK — it holds handles and asks the HSM to operate on them.
 *
 * Consequences that are easy to overlook and are called out in the blueprint:
 *   - HSM latency sits on the critical path of every subject-ID derivation.
 *   - HSM availability is a hard dependency of the whole platform.
 *   - Losing every HSM copy of the KEK is a bank-wide crypto-shred nobody
 *     asked for. Off-site HSM backup with a tested restore is a go-live blocker.
 */
export interface Hsm {
  readonly kind: 'software' | 'pkcs11';
  readonly pepperEpoch: number;
  /** HMAC-SHA256 under the pepper. Returns hex. */
  hmacPepper(message: Buffer): Promise<string>;
  /** Generate a fresh DEK. Never persisted unwrapped. */
  generateDek(): Promise<Buffer>;
  /** Wrap a DEK under the KEK. */
  wrapDek(dek: Buffer): Promise<Buffer>;
  /** Unwrap a DEK under the KEK. */
  unwrapDek(wrapped: Buffer): Promise<Buffer>;
}

export class SoftwareHsm implements Hsm {
  readonly kind = 'software' as const;
  readonly pepperEpoch: number;
  readonly #pepper: Buffer;
  readonly #kek: Buffer;

  /**
   * DEVELOPMENT AND DEMO ONLY.
   *
   * This constructor refuses to run in production. It is the four-line guard
   * that stops the POC's software pepper reaching production by accident —
   * which is the single most likely way this project could cause a real
   * incident.
   */
  constructor(pepper: Buffer, kek: Buffer, pepperEpoch = 1) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'FATAL: SoftwareHsm is not permitted in production. Configure PKCS11_LIB and a hardware HSM.',
      );
    }
    if (pepper.length < 32 || kek.length !== 32) {
      throw new Error('pepper must be >=32 bytes and KEK exactly 32 bytes');
    }
    this.#pepper = pepper;
    this.#kek = kek;
    this.pepperEpoch = pepperEpoch;
  }

  static fromSeeds(pepperSeed: string, kekSeed: string, epoch = 1): SoftwareHsm {
    return new SoftwareHsm(
      createHash('sha256').update(pepperSeed).digest(),
      createHash('sha256').update(kekSeed).digest(),
      epoch,
    );
  }

  hmacPepper(message: Buffer): Promise<string> {
    return Promise.resolve(createHmac('sha256', this.#pepper).update(message).digest('hex'));
  }

  generateDek(): Promise<Buffer> {
    return Promise.resolve(randomBytes(32));
  }

  wrapDek(dek: Buffer): Promise<Buffer> {
    const iv = randomBytes(GCM_IV_BYTES);
    const c = createCipheriv('aes-256-gcm', this.#kek, iv, { authTagLength: GCM_TAG_BYTES });
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Promise.resolve(Buffer.concat([iv, c.getAuthTag(), ct]));
  }

  // `async` rather than a bare Promise.resolve: this method can fail, and a
  // method declared to return a Promise must REJECT rather than throw past its
  // caller. Anyone holding it as `unwrapDek(blob).catch(handleCorruption)`
  // would otherwise take the throw synchronously and never reach the handler.
  async unwrapDek(wrapped: Buffer): Promise<Buffer> {
    // Length-check before slicing. subarray() clamps rather than throwing, so
    // a truncated blob yields a SHORT tag instead of an error — and GCM with a
    // short tag is the weakness this guards against, not a malformed input.
    if (wrapped.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
      throw new Error('wrapped DEK is shorter than its own IV and tag');
    }
    const iv = wrapped.subarray(0, GCM_IV_BYTES);
    const tag = wrapped.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES);
    const ct = wrapped.subarray(GCM_IV_BYTES + GCM_TAG_BYTES);
    const d = createDecipheriv('aes-256-gcm', this.#kek, iv, { authTagLength: GCM_TAG_BYTES });
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }
}
