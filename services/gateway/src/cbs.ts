/**
 * Mocked core banking system.
 *
 * WHY THIS EXISTS, and why it is a separate module.
 *
 * No personal data is on the ledger. Names, employers and job titles are not
 * on-chain and must never appear to be — the ledger holds proof of a
 * verification, never the person. In production these fields come from ABHI's
 * core banking system; here they come from this mock, which is exactly where
 * they would come from in production.
 *
 * A profile is derived deterministically from the subject id, so the same
 * customer is the same person on every run and across every rehearsal. Nothing
 * is stored: there is no table here to leak, and the ledger is not asked to
 * hold a name it should not have.
 *
 * COST: a CBS lookup is an internal read, not a rail call. This class has no
 * reference to MockRails and therefore cannot move the spend counter — that is
 * a structural guarantee rather than a promise, which matters because the
 * "PKR 0" claim on a reuse is wrong the moment an internal read starts
 * charging. Asserted in services/gateway/test/cbs.test.ts.
 *
 * Every name and employer below is invented. None corresponds to a real
 * person or a real company.
 */

const MALE_FIRST = [
  'Muhammad',
  'Ahmed',
  'Ali',
  'Hassan',
  'Usman',
  'Bilal',
  'Imran',
  'Faisal',
  'Kashif',
  'Naveed',
  'Zubair',
  'Tariq',
  'Adnan',
  'Rizwan',
  'Shahid',
  'Waqas',
];

const FEMALE_FIRST = [
  'Ayesha',
  'Fatima',
  'Sana',
  'Hina',
  'Maryam',
  'Nadia',
  'Saima',
  'Rabia',
  'Zainab',
  'Farah',
  'Sadia',
  'Nasreen',
  'Uzma',
  'Shazia',
  'Bushra',
  'Amna',
];

const MALE_LAST = [
  'Khan',
  'Ahmed',
  'Shah',
  'Iqbal',
  'Hussain',
  'Malik',
  'Javed',
  'Aslam',
  'Raza',
  'Siddiqui',
  'Butt',
  'Chaudhry',
];

const FEMALE_LAST = [
  'Khan',
  'Bibi',
  'Begum',
  'Iqbal',
  'Hussain',
  'Malik',
  'Parveen',
  'Akhtar',
  'Raza',
  'Siddiqui',
];

/** Middle names, used by both genders. Widens the name space considerably. */
const MIDDLE = [
  'Ahmed',
  'Ali',
  'Hussain',
  'Khan',
  'Nawaz',
  'Abbas',
  'Yousaf',
  'Anwar',
  'Farooq',
  'Latif',
  'Mehmood',
  'Rasheed',
  'Sattar',
  'Zaman',
];

/** Invented employers. Deliberately not real companies. */
export const EMPLOYERS = [
  'Ravi Textile Mills',
  'Indus Packaging Works',
  'Karakoram Logistics',
  'Sahiwal Foods Limited',
  'Meraj Garments',
  'Clifton Facilities Services',
] as const;

/** Designations drawn from ABHI's actual customer profile. */
const DESIGNATIONS = [
  'Machine operator',
  'Stitcher',
  'Security guard',
  'Driver',
  'Packer',
  'Line supervisor',
  'Helper',
  'Quality checker',
] as const;

export interface CbsProfile {
  subjectId: string;
  displayName: string;
  employer: string;
  designation: string;
  employeeCode: string;
  joinedAt: string;
  /** Seed for a generated initials avatar. Never a photograph. */
  avatarSeed: string;
  /**
   * The customer's CNIC in masked form, e.g. `61101-*****-8`, or null when
   * this environment never saw one.
   *
   * A real core banking system holds the full number; this mock deliberately
   * does not. The seeder hands over the mask and nothing else, so there is no
   * CNIC in this process to leak, and the masked string cannot be reversed
   * into one. The screens only ever needed the mask.
   */
  cnicMasked: string | null;
}

/** `61101-*****-8` — first block and final digit, which is all a screen shows. */
export function maskCnic(cnic: string): string {
  const digits = cnic.replace(/\D/g, '');
  if (digits.length !== 13) return '';
  return `${digits.slice(0, 5)}-*****-${digits.slice(12)}`;
}

/**
 * A stable 32-bit value from a subject id and a field name.
 *
 * The field name is mixed in so that two fields of the same profile do not
 * move together — without it, every customer with a low-numbered name would
 * also land at the first employer, and the directory would look generated
 * because it would be.
 */
function hashOf(subjectId: string, field: string): number {
  let h = 2166136261;
  const input = `${field}:${subjectId}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  // Avalanche the result (murmur3's fmix32) before anyone takes a modulo of
  // it. FNV-1a's low bits are weakly mixed, and `pick` selects with `% n`
  // where n is 10-16 — so it reads exactly the weakest bits. Without this the
  // fields correlate: 1,204 customers collapsed to 599 distinct names, half
  // of them landing next to their duplicate once the directory sorted by name.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;

  return h >>> 0;
}

function pick<T>(list: readonly T[], subjectId: string, field: string): T {
  return list[hashOf(subjectId, field) % list.length]!;
}

export class MockCbs {
  /**
   * Masked CNICs, by subject id.
   *
   * The only state in this class, and it holds no CNIC — just the display
   * mask, which is not reversible into one. Populated by the seeder, because
   * a masked number cannot be derived from a subject id: the subject id is an
   * HMAC, and being unable to work backwards from it is the point.
   */
  readonly #masks = new Map<string, string>();

  rememberMask(subjectId: string, cnicMasked: string): void {
    this.#masks.set(subjectId, cnicMasked);
  }

  /**
   * Look up one customer's display details.
   *
   * In production this is a network call to core banking; the async signature
   * is kept so callers do not have to change when it becomes one.
   */
  profile(subjectId: string): Promise<CbsProfile> {
    const female = hashOf(subjectId, 'gender') % 100 < 38;

    const first = female
      ? pick(FEMALE_FIRST, subjectId, 'first')
      : pick(MALE_FIRST, subjectId, 'first');
    const last = female
      ? pick(FEMALE_LAST, subjectId, 'last')
      : pick(MALE_LAST, subjectId, 'last');

    // A middle name on most records, which is both usual in Pakistan and
    // necessary: sixteen first names against twelve surnames is under two
    // hundred combinations, and in a base of twelve hundred sorted by name
    // the duplicates land next to each other and read as a bug.
    const candidate =
      hashOf(subjectId, 'hasMiddle') % 100 < 62 ? pick(MIDDLE, subjectId, 'middle') : null;
    // "Adnan Ahmed Ahmed" happens in life but reads as a generator artefact.
    const middle = candidate === last || candidate === first ? null : candidate;

    const joinedYear = 2019 + (hashOf(subjectId, 'joinedYear') % 7);
    const joinedMonth = 1 + (hashOf(subjectId, 'joinedMonth') % 12);
    const joinedDay = 1 + (hashOf(subjectId, 'joinedDay') % 28);

    return Promise.resolve({
      subjectId,
      displayName: middle === null ? `${first} ${last}` : `${first} ${middle} ${last}`,
      employer: pick(EMPLOYERS, subjectId, 'employer'),
      designation: pick(DESIGNATIONS, subjectId, 'designation'),
      employeeCode: `E${String(hashOf(subjectId, 'employeeCode') % 100000).padStart(5, '0')}`,
      joinedAt: `${joinedYear}-${String(joinedMonth).padStart(2, '0')}-${String(joinedDay).padStart(2, '0')}`,
      avatarSeed: subjectId.slice(0, 8),
      cnicMasked: this.#masks.get(subjectId) ?? null,
    });
  }

  /** Bulk form. Same determinism, one call. */
  async profiles(subjectIds: readonly string[]): Promise<CbsProfile[]> {
    return Promise.all(subjectIds.map((id) => this.profile(id)));
  }
}
