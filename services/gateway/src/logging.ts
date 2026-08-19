/**
 * Log redaction.
 *
 * Two layers, and both are necessary:
 *
 *  1. Key-based denial — named fields are censored wherever they appear.
 *  2. Value-based scrubbing — any 13+ digit run in ANY string is masked,
 *     regardless of the field it sits in.
 *
 * Layer 1 alone fails the moment someone logs a whole request object from a
 * new endpoint whose field names nobody added to the deny-list. Layer 2 is the
 * backstop that makes that mistake survivable.
 */

const DENIED_KEYS = new Set([
  'cnic',
  'cnicNumber',
  'fullName',
  'full_name',
  'address',
  'address_hash',
  'fatherName',
  'attributes',
  'salts',
  'payload',
  'ciphertext',
  'wrappedDek',
  'dek',
  'kek',
  'pepper',
  'authorization',
  'cookie',
  'password',
  'token',
]);

const CNIC_RUN = /\d{13,}/g;
const SIXTY_FOUR_HEX = /^[0-9a-f]{64}$/;

export function scrubString(s: string): string {
  // 64-hex identifiers (subjectId, merkleRoot) are safe and must survive.
  if (SIXTY_FOUR_HEX.test(s)) return s;
  return s.replace(CNIC_RUN, '[REDACTED-ID]');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = DENIED_KEYS.has(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return '[UNSERIALISABLE]';
}

export function logInfo(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify(redact({ level: 'info', message, ts: new Date().toISOString(), ...fields })));
}

export function logSecurity(code: string, fields: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify(redact({ level: 'error', severity: 'P1', code, ts: new Date().toISOString(), ...fields })),
  );
}
