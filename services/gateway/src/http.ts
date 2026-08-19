import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID, X509Certificate } from 'node:crypto';
import { KycError, SECURITY_ERROR_CODES, type ErrorCode } from '@abhi/types';
import { PRODUCT_POLICIES } from '@abhi/policy';
import { memoryContext, type TxContext } from '@abhi/kyc-registry';
import type { KycGatewayService } from './service.ts';
import { MockCbs } from './cbs.ts';
import { PresentationStore, type ActivityEntry } from './presentation.ts';
import { buildDirectoryRoutes, type DirectoryDeps } from './directory.ts';
import { redact } from './logging.ts';
import {
  RateLimiter,
  IdempotencyStore,
  NonceCache,
  DEFAULT_RATE_RULES,
  identityFromHeaders,
  identityFromCertificate,
  type CallerIdentity,
} from './security.ts';

/**
 * HTTP layer.
 *
 * Built on node:http with zero dependencies. The blueprint recommends Fastify
 * for production and that recommendation stands — the OpenAPI 3.1 document in
 * services/gateway/openapi.yaml is the contract either way. For the POC,
 * zero dependencies means the gateway starts anywhere Node runs, which matters
 * more than framework ergonomics. Recorded as a deviation in
 * docs/ARCHITECTURE_CONFORMANCE.md.
 *
 * SECURITY NOTE — the POC authenticates by header. Production requires mTLS
 * with client-certificate binding, OAuth2 client credentials, request signing
 * over (method, path, body hash, timestamp, nonce), and a replay nonce cache.
 * The header shim below is explicitly rejected when NODE_ENV=production.
 */

export interface HttpDeps {
  service: KycGatewayService;
  /** Set false only in tests. */
  logRequests?: boolean;
  /** Set false only in tests that deliberately exercise burst traffic. */
  enableRateLimit?: boolean;
  /**
   * Display-data source for the operations screens. Defaults to a fresh mock.
   * Never charged for — see cbs.ts.
   */
  cbs?: MockCbs;
  /** Index over the ledger for the queue and activity screens. Not ledger state. */
  presentation?: PresentationStore;
}

export interface Handler {
  (req: RequestCtx): Promise<{ status: number; body: unknown }>;
}

export interface RequestCtx {
  body: Record<string, unknown>;
  query: URLSearchParams;
  tx: TxContext;
  correlationId: string;
  /** Values captured from a dynamic path segment, e.g. :subjectId. */
  params: Record<string, string>;
}

/**
 * A route with a path parameter.
 *
 * The exact-match Map handles every write endpoint, which is most of the API.
 * The directory screens need `/customers/{id}` shapes, and rather than fold a
 * router in, these are matched segment by segment after the Map misses.
 */
export interface DynamicRoute {
  method: string;
  /** Segments of the path; entries starting with ':' capture. */
  segments: string[];
  handler: Handler;
}

export function matchDynamic(
  routes: readonly DynamicRoute[],
  method: string,
  path: string,
): { handler: Handler; params: Record<string, string> } | null {
  const parts = path.split('/').filter((s) => s.length > 0);

  for (const route of routes) {
    if (route.method !== method || route.segments.length !== parts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < route.segments.length; i += 1) {
      const segment = route.segments[i]!;
      const value = parts[i]!;
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(value);
      } else if (segment !== value) {
        matched = false;
        break;
      }
    }

    if (matched) return { handler: route.handler, params };
  }

  return null;
}

const HTTP_STATUS_FOR: Partial<Record<ErrorCode, number>> = {
  ERR_UNKNOWN_MSP: 401,
  ERR_COMPLIANCE_ONLY: 403,
  ERR_INSUFFICIENT_ROLE: 403,
  ERR_SUBJECT_NOT_FOUND: 404,
  ERR_SUBJECT_EXISTS: 409,
  ERR_VERSION_CONFLICT: 409,
  ERR_INVALID_TRANSITION: 409,
  ERR_NO_VALID_CONSENT: 403,
  ERR_PAYLOAD_TOO_LARGE: 413,
  ERR_ATTEMPT_CAP_EXCEEDED: 429,
  ERR_PII_DETECTED: 400,
};

function statusFor(code: ErrorCode): number {
  return HTTP_STATUS_FOR[code] ?? 400;
}

/**
 * Caller identity.
 *
 * Prefers the validated client certificate when the connection is mTLS, and
 * falls back to headers only outside production — where identityFromHeaders
 * itself throws. There is no configuration in which a header can establish
 * identity in production (SEC-02).
 */
function callerFrom(req: IncomingMessage): CallerIdentity {
  const socket = req.socket as { getPeerCertificate?: (d?: boolean) => unknown; authorized?: boolean };

  if (typeof socket.getPeerCertificate === 'function' && socket.authorized === true) {
    const raw = socket.getPeerCertificate(true) as { raw?: Buffer } | undefined;
    if (raw?.raw !== undefined) {
      return identityFromCertificate(new X509Certificate(raw.raw));
    }
  }
  return identityFromHeaders(req);
}

function contextFrom(caller: CallerIdentity): TxContext {
  return memoryContext({ mspId: caller.mspId, role: caller.role, timestamp: new Date() });
}

async function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new KycError('ERR_PAYLOAD_TOO_LARGE', 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new KycError('ERR_INVALID_SCOPE', 'body must be valid JSON');
  }
}

function str(body: Record<string, unknown>, field: string, required = true): string {
  const v = body[field];
  if (typeof v === 'string' && v.length > 0) return v;
  if (required) throw new KycError('ERR_INVALID_SCOPE', `${field} is required`);
  return '';
}

export function buildRoutes(svc: KycGatewayService): Map<string, Handler> {
  const routes = new Map<string, Handler>();

  routes.set('POST /kyc/register', async ({ body, tx }) => {
    const r = await svc.register(tx, {
      cnic: str(body, 'cnic'),
      attributes: (body['attributes'] as Record<string, string | boolean | number>) ?? {},
      originProduct: str(body, 'originProduct'),
      cnicExpiryAt: str(body, 'cnicExpiryAt'),
    });
    return { status: 201, body: r };
  });

  routes.set('POST /kyc/verify', async ({ body, tx }) => {
    const r = await svc.verify(
      tx,
      str(body, 'cnic'),
      str(body, 'productId'),
      (body['consentId'] as string | undefined) ?? null,
      body['requestedAttributes'] as string[] | undefined,
    );
    return { status: 200, body: r };
  });

  routes.set('POST /kyc/update', async ({ body, tx }) => {
    const r = await svc.stepUp(
      tx,
      str(body, 'cnic'),
      str(body, 'productId'),
      (body['attributes'] as Record<string, string | boolean | number>) ?? {},
      str(body, 'cnicExpiryAt'),
      str(body, 'reason'),
    );
    return { status: 200, body: r };
  });

  routes.set('POST /kyc/suspend', async ({ body, tx }) => {
    const r = await svc.suspend(tx, str(body, 'cnic'), str(body, 'reason'), str(body, 'referenceId'));
    return { status: 200, body: r };
  });

  routes.set('POST /kyc/reinstate', async ({ body, tx }) => {
    const r = await svc.reinstate(tx, str(body, 'cnic'), str(body, 'reason'), str(body, 'referenceId'));
    return { status: 200, body: r };
  });

  routes.set('POST /kyc/shred', async ({ body, tx }) => {
    const r = await svc.shred(tx, str(body, 'cnic'), str(body, 'reason'), str(body, 'legalBasis'));
    return { status: 200, body: r };
  });

  routes.set('POST /consent/create', async ({ body, tx }) => {
    const r = await svc.grantConsent(
      tx,
      str(body, 'cnic'),
      str(body, 'grantedTo'),
      str(body, 'purpose'),
      (body['scope'] as string[]) ?? [],
      str(body, 'expiresAt'),
      str(body, 'evidenceRef'),
    );
    return { status: 201, body: r };
  });

  routes.set('POST /consent/revoke', async ({ body, tx }) => {
    const r = await svc.revokeConsent(
      tx,
      str(body, 'cnic'),
      str(body, 'grantedTo'),
      str(body, 'consentId'),
      str(body, 'reason'),
    );
    return { status: 200, body: r };
  });

  routes.set('POST /employer/bulk-lookup', async ({ body, tx }) => {
    const r = await svc.employerBulkLookup(tx, (body['cnics'] as string[]) ?? []);
    return { status: 200, body: r };
  });

  routes.set('GET /kyc/history', async ({ query, tx }) => {
    const cnic = query.get('cnic');
    if (cnic === null) throw new KycError('ERR_INVALID_SCOPE', 'cnic query parameter is required');
    return { status: 200, body: await svc.versionChain(tx, cnic) };
  });

  routes.set('GET /audit/events', async ({ query, tx }) => {
    const cnic = query.get('cnic');
    if (cnic === null) throw new KycError('ERR_INVALID_SCOPE', 'cnic query parameter is required');
    return { status: 200, body: { events: await svc.auditTrail(tx, cnic) } };
  });

  routes.set('GET /policies', async () => ({ status: 200, body: PRODUCT_POLICIES }));

  routes.set('GET /metrics', async () => ({ status: 200, body: svc.metrics }));

  // Prometheus exposition. Metric names match monitoring/prometheus-rules.yaml
  // — if these drift, the alerts silently stop firing, which is worse than no
  // alerts at all because it looks like health.
  routes.set('GET /metrics/prometheus', async () => {
    const m = svc.metrics;
    const total = m.rails.callsMade + m.rails.callsAvoided;
    const lines: string[] = [
      '# HELP rail_calls_total Verification rail calls, by outcome.',
      '# TYPE rail_calls_total counter',
      `rail_calls_total{outcome="made"} ${m.rails.callsMade}`,
      `rail_calls_total{outcome="avoided"} ${m.rails.callsAvoided}`,
      '# HELP rail_cost_pkr_total Rail spend in PKR.',
      '# TYPE rail_cost_pkr_total counter',
      `rail_cost_pkr_total{kind="spent"} ${m.rails.costSpentPkr}`,
      `rail_cost_pkr_total{kind="avoided"} ${m.rails.costAvoidedPkr}`,
      '# HELP kyc_reuse_ratio Proportion of rail calls avoided through reuse.',
      '# TYPE kyc_reuse_ratio gauge',
      `kyc_reuse_ratio ${total === 0 ? 0 : (m.rails.callsAvoided / total).toFixed(4)}`,
      '# HELP rail_cap_lockouts_total Customers who hit the daily biometric cap.',
      '# TYPE rail_cap_lockouts_total counter',
      `rail_cap_lockouts_total ${m.rails.capLockouts}`,
      '# HELP ecib_calls_total e-CIB checks. Never avoided by reuse, by design.',
      '# TYPE ecib_calls_total counter',
      `ecib_calls_total ${m.ecibCalls}`,
      '# HELP vault_decrypt_total Vault decrypt operations. Exfiltration signal.',
      '# TYPE vault_decrypt_total counter',
      `vault_decrypt_total ${m.vaultDecrypts}`,
      '# HELP kyc_ledger_mode 1 when backed by a real Fabric network, 0 for the simulator.',
      '# TYPE kyc_ledger_mode gauge',
      `kyc_ledger_mode ${m.ledgerMode === 'fabric' ? 1 : 0}`,
    ];
    for (const [method, counts] of Object.entries(m.rails.byMethod)) {
      lines.push(`rail_calls_by_method_total{method="${method}",outcome="made"} ${counts.made}`);
      lines.push(`rail_calls_by_method_total{method="${method}",outcome="avoided"} ${counts.avoided}`);
    }
    return { status: 200, body: { __raw: lines.join('\n') + '\n' } };
  });

  routes.set('GET /health', async () => ({
    status: 200,
    body: { status: 'ok', ledger: svc.metrics.ledgerMode, ts: new Date().toISOString() },
  }));

  return routes;
}

/** Endpoints that mutate state and therefore accept an idempotency key. */
const MUTATING = /^\/(kyc|consent)\//;

/** Endpoints subject to the low-volume Compliance limit. */
const COMPLIANCE_PATHS = new Set(['/kyc/suspend', '/kyc/reinstate', '/kyc/shred']);

/**
 * Append to the presentation index after a successful write or verify.
 *
 * Done here rather than inside the service so that the domain layer stays
 * unaware of it. This index is for screens; nothing in the business logic may
 * come to depend on it. See presentation.ts.
 */
export async function recordPresentation(
  deps: Required<Pick<HttpDeps, 'service' | 'presentation'>>,
  path: string,
  caller: CallerIdentity,
  tx: TxContext,
  body: Record<string, unknown>,
  result: unknown,
): Promise<void> {
  const { service, presentation } = deps;
  const at = tx.timestamp.toISOString();
  const cnic = typeof body['cnic'] === 'string' ? (body['cnic'] as string) : null;

  const subjectIdOf = async (): Promise<string | null> => {
    const fromResult = (result as { subjectId?: unknown } | null)?.subjectId;
    if (typeof fromResult === 'string') return fromResult;
    return cnic === null ? null : service.subjectId(cnic);
  };

  const base = { at, actorMsp: caller.mspId, actorRole: caller.role };

  if (path === '/kyc/verify') {
    const r = result as {
      subjectId: string;
      decision: {
        outcome: 'ALLOW' | 'STEP_UP' | 'FULL_KYC' | 'DENY';
        reason: string;
        missingMethods: string[];
        disclosableAttributes: string[];
        currentAssurance: string | null;
        requiredAssurance: string;
        ageDays: number | null;
        policyId: string;
      };
      railCallsAvoided: number;
      costAvoidedPkr: number;
    };

    presentation.recordVerification({
      subjectId: r.subjectId,
      productId: String(body['productId'] ?? ''),
      requestedAt: at,
      decision: r.decision.outcome,
      decisionReason: r.decision.reason as never,
      missingMethods: r.decision.missingMethods as never,
      currentAssurance: r.decision.currentAssurance,
      requiredAssurance: r.decision.requiredAssurance,
      ageDays: r.decision.ageDays,
      policyId: r.decision.policyId,
      railCallsAvoided: r.railCallsAvoided,
      costAvoidedPkr: r.costAvoidedPkr,
      disclosedAttributes: r.decision.disclosableAttributes,
    });

    presentation.recordActivity({
      ...base,
      action: 'VERIFICATION',
      subjectId: r.subjectId,
      productId: String(body['productId'] ?? ''),
      decision: r.decision.outcome,
      detail: null,
    });
    return;
  }

  const ACTIONS: Record<string, ActivityEntry['action']> = {
    '/kyc/register': 'IDENTITY_CONFIRMED',
    '/kyc/update': 'IDENTITY_UPDATED',
    '/kyc/suspend': 'FROZEN',
    '/kyc/reinstate': 'REINSTATED',
    '/kyc/shred': 'ERASED',
    '/consent/create': 'CONSENT_GRANTED',
    '/consent/revoke': 'CONSENT_REVOKED',
  };

  const action = ACTIONS[path];
  if (action === undefined) return;

  const subjectId = await subjectIdOf();
  if (subjectId === null) return;

  presentation.recordActivity({
    ...base,
    action,
    subjectId,
    productId: typeof body['productId'] === 'string' ? (body['productId'] as string) : null,
    decision: null,
    detail: typeof body['reason'] === 'string' ? (body['reason'] as string) : null,
  });
}

export function createGateway(deps: HttpDeps): Server {
  const cbs = deps.cbs ?? new MockCbs();
  const presentation = deps.presentation ?? new PresentationStore();

  const directoryDeps: DirectoryDeps = { service: deps.service, cbs, presentation };
  const directory = buildDirectoryRoutes(directoryDeps);

  const routes = buildRoutes(deps.service);
  for (const [key, handler] of directory.exact) routes.set(key, handler);
  const dynamicRoutes = directory.dynamic;

  const logRequests = deps.logRequests ?? true;
  const rateLimitEnabled = deps.enableRateLimit ?? true;

  const limiter = new RateLimiter(DEFAULT_RATE_RULES);
  const idempotency = new IdempotencyStore();
  const nonces = new NonceCache();

  const sweeper = setInterval(() => limiter.sweep(), 60_000);
  sweeper.unref();

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const correlationId = randomUUID();
    const started = performance.now();

    void (async () => {
      let status = 500;
      let payload: unknown = { error: 'ERR_INTERNAL' };

      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        const method = req.method ?? 'GET';
        const key = `${method} ${path}`;
        const exactHandler = routes.get(key);
        const dynamicMatch =
          exactHandler === undefined ? matchDynamic(dynamicRoutes, method, path) : null;

        const handler = exactHandler ?? dynamicMatch?.handler;
        const params = dynamicMatch?.params ?? {};

        if (handler === undefined) {
          status = 404;
          payload = { error: 'NOT_FOUND', path };
        } else {
          const caller = callerFrom(req);
          const body = method === 'GET' ? {} : await readBody(req);

          // ---- rate limiting -------------------------------------------
          if (rateLimitEnabled && path !== '/health') {
            limiter.check('product', caller.mspId);

            if (COMPLIANCE_PATHS.has(path)) limiter.check('compliance', caller.mspId);
            if (path === '/employer/bulk-lookup') limiter.check('employerBulk', caller.mspId);

            // Per-subject: the enumeration and cost-attack control. Keyed on
            // the raw CNIC so it applies before any HSM work is done.
            const subject = (body['cnic'] as string | undefined) ?? url.searchParams.get('cnic');
            if (subject !== null && subject !== undefined) {
              limiter.check('subject', `${caller.mspId}:${subject}`);
            }
          }

          // ---- replay defence (only when the caller signs) --------------
          const nonce = req.headers['x-abhi-nonce'] as string | undefined;
          const reqTs = req.headers['x-abhi-timestamp'] as string | undefined;
          if (nonce !== undefined && reqTs !== undefined) {
            nonces.assertFresh(nonce, reqTs);
          }

          // ---- idempotency ---------------------------------------------
          const idemKey = req.headers['idempotency-key'] as string | undefined;
          const isMutating = MUTATING.test(path) && method === 'POST';
          const reqHash = IdempotencyStore.hashRequest(method, path, body);

          if (isMutating && idemKey !== undefined) {
            const cached = idempotency.lookup(idemKey, reqHash);
            if (cached !== null) {
              status = cached.status;
              payload = cached.body;
              res.setHeader('idempotent-replay', 'true');
              throw { __short_circuit: true };
            }
          }

          const tx = contextFrom(caller);
          const result = await handler({
            body,
            query: url.searchParams,
            tx,
            correlationId,
            params,
          });
          status = result.status;
          payload = result.body;

          if (isMutating && idemKey !== undefined && status < 500) {
            idempotency.store(idemKey, reqHash, status, payload);
          }

          // Index the write for the operations screens. A failure here must
          // never fail the request — the ledger write already succeeded, and
          // losing a row from a presentation index is not worth a 500.
          if (status < 400 && method === 'POST') {
            try {
              await recordPresentation(
                { service: deps.service, presentation },
                path,
                caller,
                tx,
                body,
                payload,
              );
            } catch (indexError) {
              console.error(
                JSON.stringify({
                  level: 'warn',
                  correlationId,
                  message: `presentation index failed: ${String(indexError)}`,
                }),
              );
            }
          }
        }
      } catch (e) {
        if (typeof e === 'object' && e !== null && '__short_circuit' in e) {
          // Idempotent replay: status and payload are already populated.
        } else if (e instanceof KycError) {
          status = statusFor(e.code);
          // Security-class errors never surface detail to a caller — they page.
          payload = SECURITY_ERROR_CODES.has(e.code)
            ? { error: e.code, correlationId }
            : { error: e.code, detail: e.detail ?? null, correlationId };
          if (SECURITY_ERROR_CODES.has(e.code)) {
            console.error(
              JSON.stringify({ level: 'error', severity: 'P1', code: e.code, correlationId }),
            );
          }
        } else {
          status = 500;
          payload = { error: 'ERR_INTERNAL', correlationId };
          console.error(JSON.stringify({ level: 'error', correlationId, message: String(e) }));
        }
      }

      // Prometheus exposition is text/plain, not JSON.
      const isRaw =
        typeof payload === 'object' && payload !== null && '__raw' in payload;
      const bodyText = isRaw
        ? String((payload as { __raw: string }).__raw)
        : JSON.stringify(payload);

      res.writeHead(status, {
        'content-type': isRaw ? 'text/plain; version=0.0.4; charset=utf-8' : 'application/json',
        'x-correlation-id': correlationId,
        // Security headers — minimal set appropriate to a JSON API.
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
      });
      res.end(bodyText);

      if (logRequests) {
        console.log(
          JSON.stringify(
            redact({
              level: 'info',
              correlationId,
              method: req.method,
              path: req.url,
              status,
              durationMs: Number((performance.now() - started).toFixed(2)),
            }),
          ),
        );
      }
    })();
  });
}
