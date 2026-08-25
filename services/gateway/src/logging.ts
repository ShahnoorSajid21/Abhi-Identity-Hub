/**
 * Log redaction.
 *
 * Two layers, and both are necessary:
 *
 *  1. Key-based denial — named fields are censored wherever they appear.
 *  2. Value-based scrubbing — anything CNIC-shaped in ANY string is masked,
 *     regardless of the field it sits in.
 *
 * Layer 1 alone fails the moment someone logs a whole request object from a
 * new endpoint whose field names nobody added to the deny-list. Layer 2 is the
 * backstop that makes that mistake survivable.
 *
 * WHY LAYER 2 MATCHES SEPARATORS, NOT JUST DIGIT RUNS.
 *
 * It used to be `\d{13,}` alone, which caught the undashed form `NNNNNNNNNNNNN`
 * and missed `NNNNN-NNNNNNN-N` — and the dashed form is the one that actually
 * arrives. ABHI's CNIC entry screen specifies the dashed form
 * `00000-0000000-0` while the employer bulk template issues them undashed, so
 * both reach the gateway and only one was being masked.
 *
 * The gap needed no coding mistake to reach: `GET /kyc/history?cnic=` and
 * `GET /audit/events?cnic=` take the CNIC in the query string, and the request
 * logger writes `path: req.url` verbatim. One dashed lookup put a citizen's
 * primary identifier on stdout, and from there into wherever container logs
 * ship. On an immutable ledger a leaked CNIC is permanent; in a log
 * aggregator it is merely everywhere.
 *
 * Pinned by 'dashed and spaced CNICs are redacted' in
 * tests/security/regressions.test.ts.
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

/** A bare run of 13+ digits — an undashed CNIC, or one inside a longer number. */
const CNIC_RUN = /\d{13,}/g;

/**
 * The separated form: 5 + 7 + 1 digits, the layout NADRA issues and every ABHI
 * screen renders. The separator may be `-` or whitespace, so this also covers
 * `61101 1234567 8`.
 *
 * Deliberately NOT a generic "13 digits with any punctuation between them":
 * that would swallow RFC 3339 timestamps and monetary figures. The 5-7-1 shape
 * is specific enough to leave ordinary log text alone.
 */
const CNIC_SEPARATED = /\b\d{5}[-\s]\d{7}[-\s]\d\b/g;

const SIXTY_FOUR_HEX_ANCHORED = /^[0-9a-f]{64}$/;

/**
 * 64-hex tokens appearing inside a larger string — a subjectId in a path such
 * as `/customers/<64 hex>/history`.
 *
 * These must survive scrubbing: they are what operators correlate logs by, and
 * they are safe by construction (HMAC under an HSM-resident pepper). But hex
 * includes 0-9, so a meaningful fraction of them contain a 13-digit run and
 * would otherwise be mangled into `[REDACTED-ID]` by CNIC_RUN. They are lifted
 * out before scrubbing and restored after.
 */
const SIXTY_FOUR_HEX_TOKEN = /\b[0-9a-f]{64}\b/g;

/**
 * Placeholder for a lifted-out identifier.
 *
 * Plain ASCII, and shaped so neither CNIC rule can match it: CNIC_RUN needs 13
 * consecutive digits and these indices are small, CNIC_SEPARATED needs the
 * 5-7-1 layout. The surrounding literal makes the restore unambiguous — an
 * earlier draft delimited with spaces, which would have rewritten "in 5
 * minutes" into whatever slot 5 happened to hold.
 */
const SLOT = (i: number): string => `__ABHI_HEX_${i}__`;
const SLOT_PATTERN = /__ABHI_HEX_(\d+)__/g;

export function scrubString(s: string): string {
  // Fast path: the whole string is a safe identifier.
  if (SIXTY_FOUR_HEX_ANCHORED.test(s)) return s;

  const preserved: string[] = [];
  const masked = s.replace(SIXTY_FOUR_HEX_TOKEN, (hex) => {
    preserved.push(hex);
    return SLOT(preserved.length - 1);
  });

  const scrubbed = masked
    .replace(CNIC_SEPARATED, '[REDACTED-ID]')
    .replace(CNIC_RUN, '[REDACTED-ID]');

  // Fall back to the matched text, never to '', so a placeholder this function
  // did not create is left alone rather than silently deleted.
  return scrubbed.replace(SLOT_PATTERN, (whole, i: string) => preserved[Number(i)] ?? whole);
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
