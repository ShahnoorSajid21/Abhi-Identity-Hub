import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  createHash,
} from 'node:crypto';

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
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.#kek, iv);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Promise.resolve(Buffer.concat([iv, c.getAuthTag(), ct]));
  }

  unwrapDek(wrapped: Buffer): Promise<Buffer> {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ct = wrapped.subarray(28);
    const d = createDecipheriv('aes-256-gcm', this.#kek, iv);
    d.setAuthTag(tag);
    return Promise.resolve(Buffer.concat([d.update(ct), d.final()]));
  }
}
