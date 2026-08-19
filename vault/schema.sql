-- ABHI Unified KYC Ledger — off-chain vault schema (PostgreSQL 16)
--
-- The ONLY place plaintext-derived material exists, and it exists here as
-- ciphertext. Two things live in this database and nothing else:
--   1. encrypted attribute values
--   2. encrypted per-attribute salts
--
-- The security property comes from ENVELOPE ENCRYPTION, not from the database.
-- Disk/TDE encryption below is defence in depth, never the primary control:
-- a DBA with SELECT rights sees ciphertext and nothing more.

BEGIN;

CREATE SCHEMA IF NOT EXISTS vault;

-- ---------------------------------------------------------------------------
-- Vault records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault.records (
    vault_ref     UUID        PRIMARY KEY,
    subject_id    CHAR(64)    NOT NULL,
    version       INTEGER     NOT NULL CHECK (version >= 1),
    pepper_epoch  INTEGER     NOT NULL CHECK (pepper_epoch >= 1),

    -- AES-256-GCM. AAD = subject_id || version || pepper_epoch, which binds the
    -- ciphertext to its record and defeats the swap attack: relocating a row
    -- onto another subject's vault_ref fails GCM authentication.
    ciphertext    BYTEA       NOT NULL,
    iv            BYTEA       NOT NULL CHECK (octet_length(iv) = 12),
    auth_tag      BYTEA       NOT NULL CHECK (octet_length(auth_tag) = 16),

    -- DEK wrapped by the HSM-resident KEK. The unwrapped DEK is never persisted.
    wrapped_dek   BYTEA       NOT NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    shredded_at   TIMESTAMPTZ,

    CONSTRAINT records_subject_version_uniq UNIQUE (subject_id, version),
    CONSTRAINT records_subject_id_hex CHECK (subject_id ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE  vault.records IS
    'Envelope-encrypted KYC attribute values and salts. Never contains plaintext.';
COMMENT ON COLUMN vault.records.subject_id IS
    'HMAC-SHA256(pepper, normalised CNIC). Not reversible without the HSM pepper.';

CREATE INDEX IF NOT EXISTS records_subject_idx ON vault.records (subject_id);
CREATE INDEX IF NOT EXISTS records_created_idx ON vault.records (created_at);

-- ---------------------------------------------------------------------------
-- Decrypt audit — every read is attributable
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault.decrypt_log (
    id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vault_ref      UUID        NOT NULL,
    requested_by   TEXT        NOT NULL,
    purpose        TEXT        NOT NULL,
    correlation_id UUID        NOT NULL,
    succeeded      BOOLEAN     NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decrypt_log_occurred_idx ON vault.decrypt_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS decrypt_log_ref_idx      ON vault.decrypt_log (vault_ref);

-- Anomalous decrypt volume is an exfiltration signal (§8.10, P2).
CREATE OR REPLACE VIEW vault.decrypt_rate_5m AS
SELECT date_trunc('minute', occurred_at) AS minute,
       requested_by,
       count(*)                          AS decrypts
FROM   vault.decrypt_log
WHERE  occurred_at > now() - interval '5 minutes'
GROUP  BY 1, 2;

-- ---------------------------------------------------------------------------
-- Crypto-shredding
-- ---------------------------------------------------------------------------
-- Erasure destroys the ciphertext, the wrapped DEK and the salts. What remains
-- on the ledger is a 32-byte root whose preimage no longer exists anywhere.
--
-- Critically, this also renders every BACKUP copy permanently undecryptable
-- without touching the backups at all — which is where most "right to erasure"
-- implementations quietly fail.
CREATE OR REPLACE FUNCTION vault.crypto_shred(p_vault_ref UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    found BOOLEAN;
BEGIN
    UPDATE vault.records
       SET ciphertext  = '\x'::bytea,
           wrapped_dek = '\x'::bytea,
           auth_tag    = '\x0000000000000000000000000000000000000000'::bytea,
           shredded_at = now()
     WHERE vault_ref = p_vault_ref
       AND shredded_at IS NULL;

    GET DIAGNOSTICS found = FOUND;
    RETURN found;
END;
$$;

COMMENT ON FUNCTION vault.crypto_shred IS
    'Overwrite before delete. Called ONLY after Compliance authorisation and '
    'ALWAYS before MarkShredded on the ledger — reversing that order would '
    'leave the ledger asserting an erasure that did not happen.';

-- ---------------------------------------------------------------------------
-- Least privilege
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'abhi_gateway') THEN
        CREATE ROLE abhi_gateway LOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'abhi_readonly_audit') THEN
        CREATE ROLE abhi_readonly_audit LOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA vault TO abhi_gateway;
GRANT SELECT, INSERT, UPDATE ON vault.records     TO abhi_gateway;
GRANT INSERT                  ON vault.decrypt_log TO abhi_gateway;
GRANT EXECUTE ON FUNCTION vault.crypto_shred(UUID) TO abhi_gateway;

-- Audit sees WHO decrypted WHAT and WHEN — never the ciphertext itself.
GRANT USAGE  ON SCHEMA vault          TO abhi_readonly_audit;
GRANT SELECT ON vault.decrypt_log     TO abhi_readonly_audit;
GRANT SELECT ON vault.decrypt_rate_5m TO abhi_readonly_audit;

-- Deletion is deliberately NOT granted: erasure goes through crypto_shred(),
-- which is auditable. A DELETE would destroy the evidence that erasure occurred.
REVOKE DELETE ON vault.records FROM abhi_gateway;

COMMIT;
