import { KycError, REQUIRED_METHODS, type AssuranceLevel } from '@abhi/types';
import { PRODUCT_POLICIES } from '@abhi/policy';
import type { KycGatewayService } from './service.ts';
import type { MockCbs } from './cbs.ts';
import type { PresentationStore } from './presentation.ts';
import { DEFAULT_RAIL_COSTS } from './rails.ts';
import { planCohort } from './seed-cohort.ts';
import type { DynamicRoute, Handler, RequestCtx } from './http.ts';

/**
 * Read endpoints for the operations console.
 *
 * These compose two sources and keep them distinct:
 *
 *   LEDGER  — verification status, level, dates, version history. The truth.
 *   CBS     — name, employer, designation. Display only, never on-chain.
 *
 * The composition happens here, at the edge, and the response labels which
 * fields came from where. Nothing in this file writes to the ledger.
 */

export interface DirectoryDeps {
  service: KycGatewayService;
  cbs: MockCbs;
  presentation: PresentationStore;
}

/** Cost of running every check a level requires, from the rail cost table. */
export function journeyCostPkr(level: AssuranceLevel): number {
  return REQUIRED_METHODS[level].reduce(
    (total, method) => total + DEFAULT_RAIL_COSTS[method].unitCostPkr,
    0,
  );
}

function daysUntil(iso: string, now: Date): number {
  return Math.floor((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

function requireParam(ctx: RequestCtx, name: string): string {
  const value = ctx.params[name];
  if (value === undefined || value.length === 0) {
    throw new KycError('ERR_INVALID_SCOPE', `${name} is required`);
  }
  return value;
}

export function buildDirectoryRoutes(deps: DirectoryDeps): {
  exact: Map<string, Handler>;
  dynamic: DynamicRoute[];
} {
  const { service, cbs, presentation } = deps;
  const exact = new Map<string, Handler>();

  /**
   * Resolve a CNIC to its subject id.
   *
   * POST rather than GET, and deliberately: a GET would put a citizen's CNIC
   * in the query string, and from there into browser history, referrer headers
   * and every access log in between. The whole point of addressing customers
   * by subject id is undone if the lookup that produces one leaks the CNIC.
   */
  exact.set('POST /subject-id', async ({ body }) => {
    const cnic = body['cnic'];
    if (typeof cnic !== 'string' || cnic.length === 0) {
      throw new KycError('ERR_INVALID_SCOPE', 'cnic is required');
    }
    return { status: 200, body: { subjectId: await service.subjectId(cnic) } };
  });

  /** The customer directory. */
  exact.set('GET /customers', async ({ query, tx }) => {
    const subjects = await service.listSubjects();
    const profiles = await cbs.profiles(subjects.map((s) => s.subjectId));

    const q = (query.get('q') ?? '').trim().toLowerCase();
    const level = query.get('level');
    const status = query.get('status');
    const employer = query.get('employer');
    const expiringSoon = query.get('expiringSoon') === 'true';

    let rows = subjects.map((subject, i) => {
      const profile = profiles[i]!;
      return {
        // --- ledger ---
        subjectId: subject.subjectId,
        assuranceLevel: subject.assuranceLevel,
        status: subject.status,
        methods: subject.methods,
        verifiedAt: subject.verifiedAt,
        expiresAt: subject.expiresAt,
        cnicExpiryAt: subject.cnicExpiryAt,
        versionCount: subject.versionCount,
        // --- core banking, display only ---
        displayName: profile.displayName,
        employer: profile.employer,
        designation: profile.designation,
        employeeCode: profile.employeeCode,
        cnicMasked: profile.cnicMasked,
        avatarSeed: profile.avatarSeed,
      };
    });

    if (q.length > 0) {
      rows = rows.filter(
        (r) =>
          r.displayName.toLowerCase().includes(q) ||
          r.employeeCode.toLowerCase().includes(q) ||
          r.employer.toLowerCase().includes(q),
      );
    }
    if (level !== null) {
      const levels = level.split(',');
      rows = rows.filter((r) => levels.includes(r.assuranceLevel));
    }
    if (status !== null) rows = rows.filter((r) => r.status === status);
    if (employer !== null) rows = rows.filter((r) => r.employer === employer);
    if (expiringSoon) {
      const days = (r: { cnicExpiryAt: string }) => daysUntil(r.cnicExpiryAt, tx.timestamp);
      rows = rows.filter((r) => days(r) <= 90);
    }

    const sort = query.get('sort') ?? 'displayName';
    rows.sort((a, b) =>
      sort === 'verifiedAt'
        ? b.verifiedAt.localeCompare(a.verifiedAt)
        : a.displayName.localeCompare(b.displayName, 'en-GB'),
    );

    const page = Math.max(0, Number(query.get('page') ?? 0));
    const pageSize = Math.min(2000, Math.max(1, Number(query.get('pageSize') ?? 25)));
    const total = rows.length;

    return {
      status: 200,
      body: {
        rows: rows.slice(page * pageSize, page * pageSize + pageSize),
        total,
        page,
        pageSize,
        employers: [...new Set(profiles.map((p) => p.employer))].sort(),
      },
    };
  });

  /** Everything the dashboard needs, in one call. */
  exact.set('GET /dashboard/summary', async ({ tx }) => {
    const subjects = await service.listSubjects();
    const metrics = service.metrics;

    const byLevel: Record<AssuranceLevel, number> = { A0: 0, A1: 0, A2: 0, A3: 0 };
    let frozen = 0;
    let cnicExpiringIn90Days = 0;

    for (const subject of subjects) {
      byLevel[subject.assuranceLevel] += 1;
      if (subject.status === 'SUSPENDED') frozen += 1;
      const days = daysUntil(subject.cnicExpiryAt, tx.timestamp);
      if (days >= 0 && days <= 90) cnicExpiringIn90Days += 1;
    }

    const confirmed = byLevel.A1 + byLevel.A2 + byLevel.A3;
    const railTotal = metrics.rails.callsMade + metrics.rails.callsAvoided;
    const queue = presentation.queue();

    return {
      status: 200,
      body: {
        totalCustomers: subjects.length,
        confirmedCustomers: confirmed,
        byLevel,
        frozen,
        cnicExpiringIn90Days,
        queueDepth: queue.length,
        queueCounts: presentation.queueCounts(),
        verificationsToday: railTotal === 0 ? 0 : metrics.rails.callsMade,
        reuseRate: railTotal === 0 ? 0 : metrics.rails.callsAvoided / railTotal,
        // Money. Every figure below is derived from DEFAULT_RAIL_COSTS, which
        // the repository marks as placeholder grid points awaiting Finance
        // ([OPEN-3]). The UI must present them as modelled, not measured.
        spendTodayPkr: metrics.rails.costSpentPkr,
        spendAvoidedTodayPkr: metrics.rails.costAvoidedPkr,
        costsAreModelled: true,
        ledgerMode: metrics.ledgerMode,
      },
    };
  });

  /**
   * Verifications per day, for the dashboard's activity chart.
   *
   * Aggregated server-side over the whole retained index. Paging /audit and
   * counting in the browser would undercount the oldest days whenever a page
   * truncates, and a chart that slopes down for that reason is worse than no
   * chart. `complete` reports whether retention actually covered the window.
   */
  exact.set('GET /dashboard/activity', async ({ query, tx }) => {
    const requested = Number.parseInt(query.get('days') ?? '7', 10);
    const days = Number.isFinite(requested) && requested > 0 ? requested : 7;
    return { status: 200, body: presentation.dailyActivity(days, tx.timestamp) };
  });

  /** The verification queue. */
  exact.set('GET /queue', async ({ query }) => {
    const decision = query.get('decision');
    const productId = query.get('product');

    const rows = presentation.queue({
      ...(decision === null ? {} : { decision }),
      ...(productId === null ? {} : { productId }),
    });

    const profiles = await cbs.profiles(rows.map((r) => r.subjectId));

    return {
      status: 200,
      body: {
        rows: rows.map((r, i) => ({ ...r, displayName: profiles[i]!.displayName })),
        counts: presentation.queueCounts(),
      },
    };
  });

  /** The global activity feed. The per-subject ledger trail remains the record. */
  exact.set('GET /audit', async ({ query }) => {
    const entries = presentation.activity({
      ...(query.get('subjectId') === null ? {} : { subjectId: query.get('subjectId')! }),
      ...(query.get('action') === null ? {} : { action: query.get('action')! }),
      ...(query.get('since') === null ? {} : { since: query.get('since')! }),
    });

    const page = Math.max(0, Number(query.get('page') ?? 0));
    const pageSize = Math.min(200, Math.max(1, Number(query.get('pageSize') ?? 50)));
    const slice = entries.slice(page * pageSize, page * pageSize + pageSize);
    const profiles = await cbs.profiles(slice.map((e) => e.subjectId));

    return {
      status: 200,
      body: {
        rows: slice.map((e, i) => ({ ...e, displayName: profiles[i]!.displayName })),
        total: entries.length,
        page,
        pageSize,
      },
    };
  });

  /**
   * A sample employer file.
   *
   * An employer's spreadsheet contains CNICs — that is what makes the bulk
   * lookup a CNIC-keyed call. The screens have no CNICs (they address
   * customers by subject id, which cannot be reversed), so the demo needs a
   * file-like source for them, and this is it.
   *
   * Every value is synthetic and comes from the same generator that seeded the
   * base, so roughly the cohort's own proportions are already known to ABHI —
   * which is the point the triage bar makes.
   */
  exact.set('GET /employer/sample-list', async ({ query, tx }) => {
    const size = Math.min(2000, Math.max(1, Number(query.get('size') ?? 1000)));
    const plan = planCohort(tx.timestamp);

    // Two thirds already on the books, one third genuinely new — an employer
    // whose entire workforce was already an ABHI customer would not be a
    // realistic upload, and the triage bar would have nothing to show.
    const known = plan.slice(0, Math.floor(size * 0.7)).map((s) => s.cnic);
    const unknown: string[] = [];
    for (let i = 0; unknown.length < size - known.length; i += 1) {
      const area = 34000 + (i % 900);
      const serial = String(2_000_000 + i * 7919).slice(0, 7);
      unknown.push(`${area}-${serial}-${i % 10}`);
    }

    return { status: 200, body: { cnics: [...known, ...unknown] } };
  });

  /** Core banking profile lookups. Cost-free — see cbs.ts. */
  exact.set('POST /rails/cbs/profile', async ({ body }) => {
    const subjectId = body['subjectId'];
    if (typeof subjectId !== 'string' || subjectId.length === 0) {
      throw new KycError('ERR_INVALID_SCOPE', 'subjectId is required');
    }
    return { status: 200, body: await cbs.profile(subjectId) };
  });

  exact.set('POST /rails/cbs/profiles', async ({ body }) => {
    const ids = body['subjectIds'];
    if (!Array.isArray(ids)) {
      throw new KycError('ERR_INVALID_SCOPE', 'subjectIds must be an array');
    }
    return { status: 200, body: { profiles: await cbs.profiles(ids as string[]) } };
  });

  const dynamic: DynamicRoute[] = [
    {
      method: 'GET',
      segments: ['customers', ':subjectId'],
      handler: async (ctx) => {
        const subjectId = requireParam(ctx, 'subjectId');
        const record = await readCurrentRecord(service, ctx, subjectId);
        const profile = await cbs.profile(subjectId);

        return {
          status: 200,
          body: {
            record,
            cbsProfile: profile,
            /** What each product would decide right now, from GET /policies. */
            productAccess: Object.values(PRODUCT_POLICIES).map((policy) => ({
              productId: policy.productId,
              minAssurance: policy.minAssurance,
              maxAgeDays: policy.maxAgeDays,
              disclosableAttributes: policy.disclosableAttributes,
            })),
          },
        };
      },
    },
    {
      method: 'GET',
      segments: ['customers', ':subjectId', 'history'],
      handler: async (ctx) => {
        const subjectId = requireParam(ctx, 'subjectId');
        const chain = await service.versionChainFor(ctx.tx, subjectId);
        return { status: 200, body: chain };
      },
    },
    {
      method: 'GET',
      segments: ['customers', ':subjectId', 'consents'],
      handler: async (ctx) => {
        const subjectId = requireParam(ctx, 'subjectId');
        return { status: 200, body: { consents: await service.consentsFor(subjectId) } };
      },
    },
    {
      method: 'GET',
      segments: ['customers', ':subjectId', 'activity'],
      handler: async (ctx) => {
        const subjectId = requireParam(ctx, 'subjectId');
        const events = await service.auditTrailFor(ctx.tx, subjectId);
        return { status: 200, body: { events } };
      },
    },
    {
      method: 'GET',
      segments: ['queue', ':requestId'],
      handler: async (ctx) => {
        const requestId = requireParam(ctx, 'requestId');
        const request = presentation.request(requestId);
        if (request === null) throw new KycError('ERR_SUBJECT_NOT_FOUND', 'no such request');
        const profile = await cbs.profile(request.subjectId);
        return { status: 200, body: { ...request, displayName: profile.displayName } };
      },
    },
  ];

  return { exact, dynamic };
}

/** Read a subject's current record, failing cleanly when there is none. */
async function readCurrentRecord(service: KycGatewayService, ctx: RequestCtx, subjectId: string) {
  const record = await service.recordFor(ctx.tx, subjectId);
  if (!record.found) throw new KycError('ERR_SUBJECT_NOT_FOUND', 'no record for this customer');
  return record;
}
