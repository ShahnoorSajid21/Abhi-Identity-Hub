/**
 * The synthetic customer base.
 *
 *   npm run seed:cohort        (standalone, prints the distribution)
 *
 * The operations screens need a population: a directory with one row is not a
 * directory, and the dashboard's whole argument is the shape of the base —
 * that a third of it has never actually been checked by anybody.
 *
 * DETERMINISM. Everything here comes from a fixed seed. The same cohort is
 * produced on every run, so the rehearsal and the performance show identical
 * figures. Nothing calls Math.random.
 *
 * SYNTHETIC IDENTITIES. Area prefixes are real geographic codes (they are
 * public, and not personal data), but the seven-digit serial is generated and
 * the final digit — which on a real CNIC encodes the holder's gender — is set
 * inconsistently with the generated profile. No value here is a valid card.
 * They are never written as literals in this file, so nothing to declare to
 * scripts/check-cnic-literals.mjs.
 *
 * NO NAMES ARE STORED. The ledger receives a subject id and verification
 * facts, and nothing else. Names, employers and designations are derived on
 * demand from the subject id by services/gateway/src/cbs.ts, which is where
 * they would come from in production too.
 */
import { memoryContext, type TxContext } from '@abhi/kyc-registry';
import type { AssuranceLevel } from '@abhi/types';
import type { KycGatewayService } from './service.ts';
import { maskCnic, type MockCbs } from './cbs.ts';

/**
 * The distribution.
 *
 * Chosen, not inherited: the Build Guide the frontend plan cites does not
 * exist in this repository. These proportions make the dashboard's four metric
 * cards reconcile with each other — 847 of 1,204 confirmed is 70% of the base,
 * and the 357 unchecked are the employer-asserted CNICs that are the entire
 * problem statement.
 *
 * If you change these, run `npm run numbers` and update any figure quoted in a
 * document, because the screens compute from here and will not match a stale
 * slide.
 */
export const COHORT: Readonly<Record<AssuranceLevel, number>> = Object.freeze({
  A0: 357,
  A1: 122,
  A2: 604,
  A3: 121,
});

/** Customers Compliance has frozen. */
export const FROZEN_COUNT = 3;
/** Customers whose CNIC expires inside 90 days. */
export const EXPIRING_SOON_COUNT = 15;

/** Real Pakistani area codes. Public geography, not personal data. */
const AREA_CODES = ['33100', '35202', '42201', '61101', '17301', '45504'];

/** Deterministic PRNG. Same seed, same cohort, every time. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METHOD_FLAGS: Record<AssuranceLevel, Record<string, boolean>> = {
  A0: {},
  A1: { verisys_match: true, document_authenticity_pass: true },
  A2: { verisys_match: true, document_authenticity_pass: true, biometric_match: true },
  A3: {
    verisys_match: true,
    document_authenticity_pass: true,
    biometric_match: true,
    liveness_pass: true,
  },
};

export interface CohortSubject {
  cnic: string;
  level: AssuranceLevel;
  verifiedAt: Date;
  cnicExpiryAt: string;
  frozen: boolean;
}

/** Build the cohort definition without touching the ledger. */
export function planCohort(now: Date): CohortSubject[] {
  const random = mulberry32(0x41424849); // "ABHI"
  const subjects: CohortSubject[] = [];

  const levels: AssuranceLevel[] = [];
  for (const [level, count] of Object.entries(COHORT) as [AssuranceLevel, number][]) {
    for (let i = 0; i < count; i += 1) levels.push(level);
  }

  // Interleave rather than append, so the directory's first page is not 357
  // unchecked customers in a row.
  for (let i = levels.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [levels[i], levels[j]] = [levels[j]!, levels[i]!];
  }

  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i]!;
    const area = AREA_CODES[Math.floor(random() * AREA_CODES.length)]!;
    const serial = String(Math.floor(random() * 9_000_000) + 1_000_000);
    const finalDigit = Math.floor(random() * 10);
    const cnic = `${area}-${serial}-${finalDigit}`;

    // Verification dates spread over the past two years. This is what makes
    // some confirmations too old for the 180-day products, which is a real
    // decision path the demo should be able to show.
    const daysAgo =
      level === 'A0' ? Math.floor(random() * 730) : Math.floor(random() * 700) + 1;
    const verifiedAt = new Date(now.getTime() - daysAgo * 86_400_000);

    // Most cards run years out; a deliberate few are inside 90 days so the
    // "needs attention" card has something true to say.
    const expiringSoon = i < EXPIRING_SOON_COUNT;
    const expiryDays = expiringSoon
      ? Math.floor(random() * 88) + 2
      : Math.floor(random() * 1800) + 200;

    subjects.push({
      cnic,
      level,
      verifiedAt,
      cnicExpiryAt: new Date(now.getTime() + expiryDays * 86_400_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z'),
      frozen: i >= EXPIRING_SOON_COUNT && i < EXPIRING_SOON_COUNT + FROZEN_COUNT,
    });
  }

  return subjects;
}

export interface SeedResult {
  registered: number;
  frozen: number;
  byLevel: Record<AssuranceLevel, number>;
}

/**
 * A working day's inbound product requests.
 *
 * These are REAL verifications, not fabricated rows: each one runs the policy
 * engine against a real record and gets whatever decision the engine returns.
 * That matters, because the queue is the screen an operations team would live
 * in, and a queue full of invented outcomes would be the one place the demo
 * was lying.
 *
 * Verification does not spend on the rails — a reuse avoids cost rather than
 * incurring it — so seeding these leaves "spend today" at zero while giving
 * "reused today" and "avoided" something true to report.
 */
/**
 * Relative request volume by weekday, Sunday first.
 *
 * These products are employer-driven — salary advances and payroll lending —
 * so the week has a real shape and the weekend is quiet without being empty.
 * The previous seeder placed every request 90 seconds apart, which put the
 * whole cohort inside a 96-minute window: fine for a queue, but it gave the
 * activity chart one spike and six empty days.
 *
 * DEMONSTRATION DATA. The shape is plausible, not measured — no ABHI volume
 * figures exist yet ([OPEN-3]), and nothing here should be read as a forecast.
 */
const WEEKDAY_WEIGHT = [0.35, 1.0, 1.05, 1.15, 1.1, 0.95, 0.4];

/** Business-hours timestamp for seeded request `i`, spread across `days`. */
export function seededRequestTime(now: Date, i: number, count: number, days = 7): Date {
  // Weight each day in the window, then walk the cumulative distribution to
  // find which day this request falls on.
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  const weights: number[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(midnight);
    day.setDate(midnight.getDate() - d);
    weights.push(WEEKDAY_WEIGHT[day.getDay()] ?? 1);
  }
  const total = weights.reduce((a, b) => a + b, 0);

  const target = ((i + 0.5) / Math.max(count, 1)) * total;
  let cumulative = 0;
  let index = weights.length - 1;
  for (let k = 0; k < weights.length; k++) {
    cumulative += weights[k]!;
    if (target <= cumulative) {
      index = k;
      break;
    }
  }

  const at = new Date(midnight);
  at.setDate(midnight.getDate() - (days - 1 - index));

  // Spread within 09:00–17:00. The final day stops at `now`, because a request
  // timestamped later this afternoon than the clock reads is a defect an
  // auditor would spot immediately.
  const within = (i * 37) % 480; // deterministic minute inside the window
  at.setHours(9, 0, 0, 0);
  at.setMinutes(within);
  return at > now ? new Date(now.getTime() - (i % 45) * 60_000) : at;
}

export async function seedActivity(
  service: KycGatewayService,
  now: Date,
  count: number,
  record: (input: {
    path: string;
    mspId: string;
    role: string;
    tx: TxContext;
    body: Record<string, unknown>;
    result: unknown;
  }) => Promise<void>,
): Promise<number> {
  const plan = planCohort(now);
  const products = ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING'];
  let recorded = 0;

  // Walk the cohort with a stride so the requests are spread across levels and
  // products rather than clustered on the first few customers.
  for (let i = 0; i < count && i * 17 < plan.length; i += 1) {
    // Roughly one request in seven is for somebody ABHI has never seen. A
    // queue where every customer is already known would misrepresent the job:
    // new applicants are most of why the queue exists.
    const isNewApplicant = i % 7 === 3;
    const cnic = isNewApplicant
      ? `34${String(100 + i).slice(0, 3)}-${String(3_100_000 + i * 4241).slice(0, 7)}-${i % 10}`
      : plan[(i * 17) % plan.length]!.cnic;
    const subject = { cnic };
    const productId = products[i % products.length]!;
    const at = seededRequestTime(now, i, count);
    const tx = memoryContext({ mspId: 'ABHILendingMSP', role: 'gateway', timestamp: at });

    try {
      const result = await service.verify(tx, subject.cnic, productId, null);
      await record({
        path: '/kyc/verify',
        mspId: 'ABHILendingMSP',
        role: 'lending',
        tx,
        body: { cnic: subject.cnic, productId },
        result,
      });
      recorded += 1;
    } catch {
      // A denied or unknown subject is a legitimate outcome, not a failure to
      // seed. Skip and continue.
    }
  }

  return recorded;
}

/**
 * Write the cohort to the ledger.
 *
 * Registration runs the rails, so the caller is expected to reset the rail
 * metrics afterwards — these are historical verifications, not today's spend,
 * and leaving them in would make "verification spend today" meaningless on the
 * first screen anyone sees.
 */
export async function seedCohort(
  service: KycGatewayService,
  now: Date,
  log: (message: string) => void = () => {},
  /**
   * Core banking, so it can be told each customer's masked CNIC.
   *
   * Only the mask is handed over — never the number. A subject id is an HMAC
   * and cannot be reversed, so the mask has to come from the point where the
   * CNIC was known, which is here.
   */
  cbs?: MockCbs,
): Promise<SeedResult> {
  const subjects = planCohort(now);
  const byLevel: Record<AssuranceLevel, number> = { A0: 0, A1: 0, A2: 0, A3: 0 };
  let frozen = 0;
  let registered = 0;

  const bank = (at: Date): TxContext =>
    memoryContext({ mspId: 'ABHIBankMSP', role: 'gateway', timestamp: at });
  const compliance = (at: Date): TxContext =>
    memoryContext({ mspId: 'ABHIComplianceMSP', role: 'compliance-officer', timestamp: at });

  for (const subject of subjects) {
    try {
      await service.register(bank(subject.verifiedAt), {
        cnic: subject.cnic,
        attributes: {
          ...METHOD_FLAGS[subject.level],
          cnic_expiry: subject.cnicExpiryAt.slice(0, 10),
          fatca_status: 'NON_US',
        },
        originProduct: subject.level === 'A0' ? 'EMPLOYER_BULK' : 'ASA',
        cnicExpiryAt: subject.cnicExpiryAt,
      });
      registered += 1;
      byLevel[subject.level] += 1;

      if (cbs !== undefined) {
        cbs.rememberMask(await service.subjectId(subject.cnic), maskCnic(subject.cnic));
      }

      if (subject.frozen) {
        await service.suspend(
          compliance(now),
          subject.cnic,
          'Sanctions screening match under review',
          `CASE-${String(frozen + 1).padStart(4, '0')}`,
        );
        frozen += 1;
      }
    } catch (e) {
      // A duplicate CNIC from the generator is possible and harmless; anything
      // else is worth seeing rather than swallowing.
      const message = String(e);
      if (!message.includes('ERR_SUBJECT_EXISTS')) log(`seed error for one subject: ${message}`);
    }
  }

  return { registered, frozen, byLevel };
}
