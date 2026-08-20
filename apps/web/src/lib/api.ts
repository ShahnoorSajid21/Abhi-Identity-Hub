/**
 * Gateway client.
 *
 * Every call carries the signed-in persona's identity headers. The gateway
 * reads X-ABHI-MSP and X-ABHI-Role in identityFromHeaders
 * (services/gateway/src/security.ts) and refuses header identity outright when
 * NODE_ENV=production, which is correct and left alone here.
 *
 * Errors come back as { error, detail?, correlationId } with the correlation
 * id also on the x-correlation-id response header. ApiError below preserves
 * all of it so <ErrorState> can put the raw detail behind the technical
 * expander rather than dropping it.
 *
 * Paths are relative to /api, which vite.config.ts proxies to the gateway.
 */

import { getPersona } from './roles.ts';

const BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;
  readonly correlationId: string | null;

  constructor(status: number, code: string, detail: string | null, correlationId: string | null) {
    super(`${code}${detail === null ? '' : `: ${detail}`}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.correlationId = correlationId;
  }

  /** True when the endpoint simply is not built yet. See FRONTEND_PLAN §4.4. */
  get isNotBuilt(): boolean {
    return this.status === 404 && this.code === 'NOT_FOUND';
  }
}

interface RequestOptions {
  /** Sent as Idempotency-Key. Only meaningful on POST /kyc/* and /consent/*. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const persona = getPersona();
  const headers: Record<string, string> = {
    'x-abhi-msp': persona.mspId,
    'x-abhi-role': persona.role,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey !== undefined) headers['idempotency-key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (cause) {
    // The gateway is not answering at all — a different state from a rejected
    // request, and the copy for it is ERRORS.gatewayUnreachable.
    throw new ApiError(0, 'ERR_GATEWAY_UNREACHABLE', String(cause), null);
  }

  const correlationId = res.headers.get('x-correlation-id');
  const text = await res.text();

  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Prometheus exposition is text/plain. Nothing else should reach here.
      parsed = { __raw: text };
    }
  }

  if (!res.ok) {
    const shape = (parsed ?? {}) as { error?: string; detail?: string | null };
    throw new ApiError(
      res.status,
      shape.error ?? 'ERR_UNKNOWN',
      shape.detail ?? null,
      correlationId,
    );
  }

  return parsed as T;
}

/* ------------------------------------------------------------------ */
/* Endpoints that exist today                                          */
/* ------------------------------------------------------------------ */

export type AssuranceLevel = 'A0' | 'A1' | 'A2' | 'A3';
export type RecordStatus = 'ACTIVE' | 'SUSPENDED' | 'SUPERSEDED' | 'SHREDDED';
export type DecisionOutcome = 'ALLOW' | 'STEP_UP' | 'FULL_KYC' | 'DENY';
export type DecisionReason =
  | 'SUFFICIENT'
  | 'NO_RECORD'
  | 'SUSPENDED'
  | 'SHREDDED'
  | 'CNIC_EXPIRED'
  | 'ASSURANCE_LOW'
  | 'STALE';
export type VerificationMethod = 'ASSERTED' | 'VERISYS' | 'DOC_AUTH' | 'BIOMETRIC_1TO1' | 'LIVENESS';

export interface ProductPolicy {
  docType: 'ProductPolicy';
  productId: string;
  policyVersion: number;
  minAssurance: AssuranceLevel;
  maxAgeDays: number;
  disclosableAttributes: string[];
  requireConsent: boolean;
  denyOnCnicExpiry: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedBy: string[];
  createdTxId: string;
}

export interface RailMetrics {
  callsMade: number;
  callsAvoided: number;
  costSpentPkr: number;
  costAvoidedPkr: number;
  capLockouts: number;
  byMethod: Record<string, { made: number; avoided: number }>;
}

export interface GatewayMetrics {
  rails: RailMetrics;
  ecibCalls: number;
  vaultDecrypts: number;
  /** 'fabric' when backed by a real network, 'simulated' otherwise. */
  ledgerMode: string;
}

export interface HealthResponse {
  status: string;
  ledger: string;
  ts: string;
}

export const api = {
  health: (signal?: AbortSignal) =>
    request<HealthResponse>('GET', '/health', undefined, signal ? { signal } : {}),

  metrics: (signal?: AbortSignal) =>
    request<GatewayMetrics>('GET', '/metrics', undefined, signal ? { signal } : {}),

  policies: (signal?: AbortSignal) =>
    request<Record<string, ProductPolicy>>('GET', '/policies', undefined, signal ? { signal } : {}),

  verify: (input: {
    cnic: string;
    productId: string;
    consentId?: string | null;
    requestedAttributes?: string[];
  }) => request<unknown>('POST', '/kyc/verify', input),

  /**
   * Step up an existing identity.
   *
   * Only the missing checks are supplied; everything already confirmed is
   * reused, which is the entire point of the step-up path.
   */
  update: (input: {
    /** Either identifier; subjectId wins when both are sent. */
    subjectId?: string;
    cnic?: string;
    productId: string;
    attributes: Record<string, string | boolean | number>;
    cnicExpiryAt: string;
    reason: string;
  }) => request<unknown>('POST', '/kyc/update', input),

  suspend: (input: { subjectId?: string; cnic?: string; reason: string; referenceId: string }) =>
    request<unknown>('POST', '/kyc/suspend', input),

  reinstate: (input: { subjectId?: string; cnic?: string; reason: string; referenceId: string }) =>
    request<unknown>('POST', '/kyc/reinstate', input),

  /** Erasure. The repository's internal name is crypto-shredding; never surface it. */
  shred: (input: { cnic: string; reason: string; legalBasis: string }) =>
    request<unknown>('POST', '/kyc/shred', input),

  employerBulkLookup: (cnics: string[]) =>
    request<{
      total: number;
      activateNow: string[];
      needsOnboarding: string[];
      denied: string[];
      invalid: string[];
      unauthorised: string[];
    }>('POST', '/employer/bulk-lookup', { cnics }),
};

/* ------------------------------------------------------------------ */
/* Directory endpoints — FRONTEND_PLAN §4.4                            */
/* ------------------------------------------------------------------ */

export interface ActivityBucket {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  verifications: number;
  /** The subset that was answered ALLOW — a reused identity. */
  reused: number;
}

export interface DailyActivity {
  buckets: ActivityBucket[];
  /** False when retention did not cover the window; earliest bars undercount. */
  complete: boolean;
}

export interface DashboardSummary {
  totalCustomers: number;
  confirmedCustomers: number;
  byLevel: Record<AssuranceLevel, number>;
  frozen: number;
  cnicExpiringIn90Days: number;
  queueDepth: number;
  queueCounts: Record<DecisionOutcome, number>;
  verificationsToday: number;
  reuseRate: number;
  spendTodayPkr: number;
  spendAvoidedTodayPkr: number;
  /** Always true here. The unit costs are placeholders pending Finance. */
  costsAreModelled: boolean;
  ledgerMode: string;
}

/** One row of the customer directory: ledger truth plus display data. */
export interface CustomerRow {
  // Ledger
  subjectId: string;
  assuranceLevel: AssuranceLevel;
  status: RecordStatus;
  methods: VerificationMethod[];
  verifiedAt: string;
  expiresAt: string;
  cnicExpiryAt: string;
  versionCount: number;
  // Core banking — display only, never on-chain
  displayName: string;
  employer: string;
  designation: string;
  employeeCode: string;
  avatarSeed: string;
  /** Masked form only, e.g. 61101-*****-8. The full number is never sent. */
  cnicMasked: string | null;
}

export interface CustomerListResponse {
  rows: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  employers: string[];
}

export interface CbsProfile {
  subjectId: string;
  displayName: string;
  employer: string;
  designation: string;
  employeeCode: string;
  joinedAt: string;
  avatarSeed: string;
  cnicMasked: string | null;
}

export interface CustomerRecord {
  found: boolean;
  subjectId: string;
  version: number | null;
  assuranceLevel: AssuranceLevel | null;
  methods: VerificationMethod[];
  status: RecordStatus | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  cnicExpiryAt: string | null;
  merkleRoot: string | null;
  attributeSetId: string | null;
  ageDays: number | null;
  cnicExpired: boolean;
}

export interface CustomerDetail {
  record: CustomerRecord;
  cbsProfile: CbsProfile;
  productAccess: {
    productId: string;
    minAssurance: AssuranceLevel;
    maxAgeDays: number;
    disclosableAttributes: string[];
  }[];
}

export interface VersionChainEntry {
  version: number;
  merkleRoot: string;
  previousVersionHash: string | null;
  assuranceLevel: AssuranceLevel;
  methods: VerificationMethod[];
  status: RecordStatus;
  verifiedAt: string;
  cnicExpiryAt: string;
  [key: string]: unknown;
}

export interface QueueRequest {
  requestId: string;
  subjectId: string;
  displayName: string;
  productId: string;
  requestedAt: string;
  decision: DecisionOutcome;
  decisionReason: DecisionReason;
  missingMethods: VerificationMethod[];
  currentAssurance: string | null;
  requiredAssurance: string;
  ageDays: number | null;
  policyId: string;
  railCallsAvoided: number;
  costAvoidedPkr: number;
  disclosedAttributes: string[];
  resolvedAt: string | null;
}

export interface ActivityRow {
  at: string;
  actorMsp: string;
  actorRole: string | null;
  action: string;
  subjectId: string;
  displayName: string;
  productId: string | null;
  decision: DecisionOutcome | null;
  detail: string | null;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text.length > 0 ? `?${text}` : '';
}

export const directory = {
  summary: (signal?: AbortSignal) =>
    request<DashboardSummary>('GET', '/dashboard/summary', undefined, signal ? { signal } : {}),

  /**
   * Verifications per day, bucketed by the gateway.
   *
   * `complete` is false when the gateway's retention window did not cover the
   * whole span, which makes the earliest bars undercounts — the chart says so
   * rather than drawing them as fact.
   */
  dailyActivity: (days: number, signal?: AbortSignal) =>
    request<DailyActivity>(
      'GET',
      `/dashboard/activity${qs({ days })}`,
      undefined,
      signal ? { signal } : {},
    ),

  customers: (
    params: {
      q?: string;
      level?: string;
      status?: string;
      employer?: string;
      expiringSoon?: boolean;
      page?: number;
      pageSize?: number;
      sort?: string;
    },
    signal?: AbortSignal,
  ) =>
    request<CustomerListResponse>(
      'GET',
      `/customers${qs(params)}`,
      undefined,
      signal ? { signal } : {},
    ),

  customer: (subjectId: string, signal?: AbortSignal) =>
    request<CustomerDetail>(
      'GET',
      `/customers/${encodeURIComponent(subjectId)}`,
      undefined,
      signal ? { signal } : {},
    ),

  history: (subjectId: string, signal?: AbortSignal) =>
    request<{ subjectId: string; versionCount: number; chainValid: boolean; brokenAt: number | null; versions: VersionChainEntry[] }>(
      'GET',
      `/customers/${encodeURIComponent(subjectId)}/history`,
      undefined,
      signal ? { signal } : {},
    ),

  consents: (subjectId: string, signal?: AbortSignal) =>
    request<{ consents: Record<string, unknown>[] }>(
      'GET',
      `/customers/${encodeURIComponent(subjectId)}/consents`,
      undefined,
      signal ? { signal } : {},
    ),

  activity: (subjectId: string, signal?: AbortSignal) =>
    request<{ events: Record<string, unknown>[] }>(
      'GET',
      `/customers/${encodeURIComponent(subjectId)}/activity`,
      undefined,
      signal ? { signal } : {},
    ),

  queue: (params: { decision?: string; product?: string }, signal?: AbortSignal) =>
    request<{ rows: QueueRequest[]; counts: Record<DecisionOutcome, number> }>(
      'GET',
      `/queue${qs(params)}`,
      undefined,
      signal ? { signal } : {},
    ),

  request: (requestId: string, signal?: AbortSignal) =>
    request<QueueRequest>(
      'GET',
      `/queue/${encodeURIComponent(requestId)}`,
      undefined,
      signal ? { signal } : {},
    ),

  audit: (
    params: { subjectId?: string; action?: string; since?: string; page?: number; pageSize?: number },
    signal?: AbortSignal,
  ) =>
    request<{ rows: ActivityRow[]; total: number; page: number; pageSize: number }>(
      'GET',
      `/audit${qs(params)}`,
      undefined,
      signal ? { signal } : {},
    ),

  /**
   * Resolve a CNIC to a subject id.
   *
   * POST, not GET. A CNIC in a query string ends up in browser history and
   * every access log between here and the gateway.
   */
  subjectIdFor: (cnic: string) => request<{ subjectId: string }>('POST', '/subject-id', { cnic }),

  sampleEmployerList: (size: number, signal?: AbortSignal) =>
    request<{ cnics: string[] }>('GET', `/employer/sample-list?size=${size}`, undefined, signal ? { signal } : {}),

  cbsProfile: (subjectId: string) =>
    request<CbsProfile>('POST', '/rails/cbs/profile', { subjectId }),
};

/**
 * Rail counts. Returns null if the endpoint is unavailable, so the shell
 * renders without badges rather than showing a zero — a zero would claim
 * "nothing needs attention" when the truth is that nobody could ask.
 */
export async function dashboardSummary(signal?: AbortSignal): Promise<DashboardSummary | null> {
  try {
    return await directory.summary(signal);
  } catch (e) {
    if (e instanceof ApiError && e.isNotBuilt) return null;
    throw e;
  }
}

export { request };
