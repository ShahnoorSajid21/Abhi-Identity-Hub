/**
 * PostgresVaultStore — the production vault backend.
 *
 * REQUIRES: npm i pg
 *
 * Closes GAP-06 and SEC-07. Schema in vault/schema.sql.
 *
 * The security property comes from ENVELOPE ENCRYPTION, not from PostgreSQL.
 * A DBA with SELECT sees ciphertext. Disk/TDE encryption is defence in depth,
 * never the primary control.
 */
import type { Pool, PoolClient } from 'pg';
import type { VaultRecord } from '@abhi/types';
import { fail } from '@abhi/types';
import type { VaultStore } from './vault.ts';

export interface PostgresVaultOptions {
  pool: Pool;
  /** Identity recorded against every decrypt, for the audit trail. */
  serviceIdentity: string;
}

interface Row {
  vault_ref: string;
  subject_id: string;
  version: number;
  pepper_epoch: number;
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
  wrapped_dek: Buffer;
  created_at: Date;
  shredded_at: Date | null;
}

function toRecord(r: Row): VaultRecord {
  return {
    vaultRef: r.vault_ref,
    subjectId: r.subject_id,
    version: r.version,
    pepperEpoch: r.pepper_epoch,
    ciphertext: r.ciphertext.toString('base64'),
    iv: r.iv.toString('base64'),
    authTag: r.auth_tag.toString('base64'),
    wrappedDek: r.wrapped_dek.toString('base64'),
    createdAt: r.created_at.toISOString(),
  };
}

export class PostgresVaultStore implements VaultStore {
  readonly #pool: Pool;
  readonly #identity: string;

  constructor(opts: PostgresVaultOptions) {
    this.#pool = opts.pool;
    this.#identity = opts.serviceIdentity;
  }

  async put(record: VaultRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO vault.records
         (vault_ref, subject_id, version, pepper_epoch, ciphertext, iv, auth_tag, wrapped_dek)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (subject_id, version) DO NOTHING`,
      [
        record.vaultRef,
        record.subjectId,
        record.version,
        record.pepperEpoch,
        Buffer.from(record.ciphertext, 'base64'),
        Buffer.from(record.iv, 'base64'),
        Buffer.from(record.authTag, 'base64'),
        Buffer.from(record.wrappedDek, 'base64'),
      ],
    );
  }

  /**
   * Read a vault record and log the decrypt.
   *
   * The audit insert is in the SAME transaction as the read, so a decrypt
   * cannot occur without leaving a trace — anomalous decrypt volume is the
   * primary exfiltration signal (§8.10) and it is worthless if the log can be
   * skipped on the hot path.
   */
  async get(vaultRef: string): Promise<VaultRecord | null> {
    const client: PoolClient = await this.#pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query<Row>(
        `SELECT * FROM vault.records WHERE vault_ref = $1 AND shredded_at IS NULL`,
        [vaultRef],
      );

      await client.query(
        `INSERT INTO vault.decrypt_log (vault_ref, requested_by, purpose, correlation_id, succeeded)
         VALUES ($1, $2, $3, gen_random_uuid(), $4)`,
        [vaultRef, this.#identity, 'PROOF_ASSEMBLY', res.rowCount === 1],
      );

      await client.query('COMMIT');
      return res.rowCount === 1 ? toRecord(res.rows[0]!) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Crypto-shred.
   *
   * Delegates to vault.crypto_shred(), which OVERWRITES before marking the row
   * shredded rather than DELETEing it — DELETE is revoked from the gateway role
   * precisely so erasure remains auditable, and so the row's existence (not its
   * content) survives as evidence that erasure occurred.
   *
   * This also renders every BACKUP copy permanently undecryptable without
   * touching the backups, which is where most erasure implementations fail.
   */
  async destroy(vaultRef: string): Promise<boolean> {
    const res = await this.#pool.query<{ crypto_shred: boolean }>(
      `SELECT vault.crypto_shred($1) AS crypto_shred`,
      [vaultRef],
    );
    return res.rows[0]?.crypto_shred === true;
  }

  async count(): Promise<number> {
    const res = await this.#pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM vault.records WHERE shredded_at IS NULL`,
    );
    return Number(res.rows[0]?.n ?? '0');
  }

  /** Decrypts in the last 5 minutes, per identity. Feeds the P2 alert. */
  async recentDecryptRate(): Promise<{ identity: string; decrypts: number }[]> {
    const res = await this.#pool.query<{ requested_by: string; decrypts: string }>(
      `SELECT requested_by, sum(decrypts)::text AS decrypts
         FROM vault.decrypt_rate_5m GROUP BY requested_by`,
    );
    return res.rows.map((r) => ({ identity: r.requested_by, decrypts: Number(r.decrypts) }));
  }

  /** Startup assertion: the gateway role must not hold DELETE on vault.records. */
  async assertLeastPrivilege(): Promise<void> {
    const res = await this.#pool.query<{ has: boolean }>(
      `SELECT has_table_privilege(current_user, 'vault.records', 'DELETE') AS has`,
    );
    if (res.rows[0]?.has === true) {
      fail(
        'ERR_INVALID_VAULTREF',
        'FATAL: gateway role holds DELETE on vault.records; erasure must go through crypto_shred()',
      );
    }
  }
}
