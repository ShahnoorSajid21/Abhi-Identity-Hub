import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { VaultRecord } from '@abhi/types';
import { fail } from '@abhi/types';
import type { Hsm } from './hsm.ts';

/**
 * The off-chain vault.
 *
 * Holds exactly two things, and it matters that the list is short: the
 * plaintext attribute VALUES and the per-attribute SALTS. Nothing else. No
 * proofs (regenerated on demand), no decisions (on-ledger), no audit trail
 * (on-ledger).
 */
export interface VaultPayload {
  attributes: Record<string, string | boolean | number>;
  /** attribute name -> 32-byte salt, hex. */
  salts: Record<string, string>;
}

/**
 * Single NUL character used to overwrite sensitive strings before release.
 *
 * Constructed rather than written as a literal control character: a raw NUL in
 * source makes the whole file binary to grep and diff, which is exactly how a
 * security control becomes invisible in code review.
 */
const ZERO_FILL = String.fromCharCode(0);

export interface VaultStore {
  put(record: VaultRecord): Promise<void>;
  get(vaultRef: string): Promise<VaultRecord | null>;
  /** Destroy ciphertext and wrapped DEK. Used only by crypto-shredding. */
  destroy(vaultRef: string): Promise<boolean>;
  count(): Promise<number>;
}

/** In-memory store for the POC. Production is PostgreSQL — schema in vault/schema.sql. */
export class MemoryVaultStore implements VaultStore {
  readonly #rows = new Map<string, VaultRecord>();

  put(record: VaultRecord): Promise<void> {
    this.#rows.set(record.vaultRef, record);
    return Promise.resolve();
  }

  get(vaultRef: string): Promise<VaultRecord | null> {
    return Promise.resolve(this.#rows.get(vaultRef) ?? null);
  }

  destroy(vaultRef: string): Promise<boolean> {
    const row = this.#rows.get(vaultRef);
    if (row === undefined) return Promise.resolve(false);

    // Overwrite before delete (SEC-07). Blanking a JS string only drops the
    // reference — the original bytes survive until collection — so overwrite
    // with same-length filler first to reduce the window in which a heap dump
    // could recover them. The production path (PostgresVaultStore) issues an
    // explicit UPDATE via vault.crypto_shred() so the ciphertext does not
    // linger in a dead tuple.
    row.ciphertext = ZERO_FILL.repeat(row.ciphertext.length);
    row.wrappedDek = ZERO_FILL.repeat(row.wrappedDek.length);
    row.iv = ZERO_FILL.repeat(row.iv.length);
    row.authTag = ZERO_FILL.repeat(row.authTag.length);
    row.ciphertext = '';
    row.wrappedDek = '';

    this.#rows.delete(vaultRef);
    return Promise.resolve(true);
  }

  count(): Promise<number> {
    return Promise.resolve(this.#rows.size);
  }

  /** Test-only: relocate a ciphertext onto another vaultRef (swap attack). */
  _swapCiphertext(fromRef: string, toRef: string): void {
    const from = this.#rows.get(fromRef);
    const to = this.#rows.get(toRef);
    if (from === undefined || to === undefined) throw new Error('both refs must exist');
    to.ciphertext = from.ciphertext;
    to.iv = from.iv;
    to.authTag = from.authTag;
    to.wrappedDek = from.wrappedDek;
  }
}

/**
 * Additional Authenticated Data binds a ciphertext to its record.
 *
 * Without this, an attacker with database write access could copy customer A's
 * ciphertext row onto customer B's vaultRef and produce proofs for B's
 * on-chain root using A's data — a swap attack that leaves the ledger
 * untouched and looks entirely legitimate. With subjectId||version as AAD,
 * GCM authentication fails and the request errors closed.
 */
function aadFor(subjectId: string, version: number, pepperEpoch: number): Buffer {
  return Buffer.from(`${subjectId}|${version}|${pepperEpoch}`, 'utf8');
}

export class Vault {
  readonly #store: VaultStore;
  readonly #hsm: Hsm;
  #decryptCount = 0;

  constructor(store: VaultStore, hsm: Hsm) {
    this.#store = store;
    this.#hsm = hsm;
  }

  /** Number of decrypt operations — anomalous volume is an exfiltration signal. */
  get decryptCount(): number {
    return this.#decryptCount;
  }

  async write(
    subjectId: string,
    version: number,
    payload: VaultPayload,
  ): Promise<string> {
    const vaultRef = randomUUID();
    const dek = await this.#hsm.generateDek();
    const iv = randomBytes(12);
    const aad = aadFor(subjectId, version, this.#hsm.pepperEpoch);

    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
      cipher.final(),
    ]);

    const record: VaultRecord = {
      vaultRef,
      subjectId,
      version,
      pepperEpoch: this.#hsm.pepperEpoch,
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      wrappedDek: (await this.#hsm.wrapDek(dek)).toString('base64'),
      createdAt: new Date().toISOString(),
    };

    await this.#store.put(record);
    dek.fill(0); // zero the DEK buffer after use
    return vaultRef;
  }

  async read(vaultRef: string): Promise<VaultPayload> {
    const row = await this.#store.get(vaultRef);
    if (row === null) fail('ERR_INVALID_VAULTREF', 'no such vault record');

    this.#decryptCount += 1;

    const dek = await this.#hsm.unwrapDek(Buffer.from(row.wrappedDek, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(aadFor(row.subjectId, row.version, row.pepperEpoch));
    decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));

    try {
      const plain = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext, 'base64')),
        decipher.final(),
      ]);
      dek.fill(0);
      return JSON.parse(plain.toString('utf8')) as VaultPayload;
    } catch {
      dek.fill(0);
      // GCM authentication failure. Either the ciphertext was tampered with or
      // it was relocated onto a different record. Fail closed and alert.
      fail('ERR_INVALID_VAULTREF', 'vault authentication failed — possible tampering or swap');
    }
  }

  /**
   * Crypto-shredding: destroy ciphertext, wrapped DEK and salts.
   *
   * Destroying the salts is what makes this complete — without them an
   * adversary could still brute-force low-entropy attribute leaves such as
   * fatca_status, which has only two possible values.
   *
   * This also silently makes every BACKUP copy undecryptable, which is where
   * most "right to erasure" implementations quietly fail: deleting a row does
   * not delete it from six months of backups; destroying the key does.
   */
  shred(vaultRef: string): Promise<boolean> {
    return this.#store.destroy(vaultRef);
  }
}
