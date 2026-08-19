/**
 * Dummy dataset for the concept demonstration.
 *
 * EVERY PERSON, CNIC, EMPLOYER AND ACCOUNT BELOW IS FICTIONAL.
 *
 * The CNICs are format-valid (13 digits, area-code prefix) so they exercise
 * normalisation and the checks, but they are invented. They must never be used
 * against a real NADRA endpoint.
 *
 * The scenario models one employer payroll — a textile mill in Faisalabad,
 * which is the shape of ABHI's actual EWA book: salaried manual workers,
 * modest amounts, high frequency.
 */
// FICTIONAL-CNIC-OK: the fictional Sitara Textile Mills payroll. Never real customer data.

export interface DummyPerson {
  name: string;
  /** Fictional CNIC. Area codes are real prefixes; the rest is invented. */
  cnic: string;
  /** How the employer's CSV renders it — note it strips the dashes. */
  cnicAsUploadedByEmployer: string;
  dob: string;
  profession: string;
  monthlySalaryPkr: number;
  /** Whether this person independently opened an ABHI wallet. */
  hasWallet: boolean;
  story: string;
}

export const EMPLOYER = {
  id: 'EMP-SITARA-001',
  name: 'Sitara Textile Mills (Pvt) Ltd',
  city: 'Faisalabad',
  payrollAccount: 'ABHI-CORP-448120',
  headcount: 8,
};

export const WORKFORCE: DummyPerson[] = [
  {
    name: 'Muhammad Aslam',
    cnic: '33100-4521896-3',
    cnicAsUploadedByEmployer: '3310045218963',
    dob: '1988-06-14',
    profession: 'Loom Operator',
    monthlySalaryPkr: 42_000,
    hasWallet: true,
    story: 'Opened an ABHI wallet last year. The one who proves the whole point.',
  },
  {
    name: 'Ayesha Bibi',
    cnic: '33100-7789234-8',
    cnicAsUploadedByEmployer: '3310077892348',
    dob: '1994-02-17',
    profession: 'Quality Inspector',
    monthlySalaryPkr: 38_500,
    hasWallet: true,
    story: 'Wallet customer. Will later need a larger advance, so A2 -> A3.',
  },
  {
    name: 'Ghulam Murtaza',
    cnic: '33100-2214567-1',
    cnicAsUploadedByEmployer: '3310022145671',
    dob: '1979-11-03',
    profession: 'Dyeing Supervisor',
    monthlySalaryPkr: 55_000,
    hasWallet: true,
    story: 'Wallet customer whose CNIC expires soon — the renewal case.',
  },
  {
    name: 'Nasreen Akhtar',
    cnic: '33100-8834521-6',
    cnicAsUploadedByEmployer: '3310088345216',
    dob: '1991-08-22',
    profession: 'Packing Assistant',
    monthlySalaryPkr: 33_000,
    hasWallet: false,
    story: 'No prior ABHI relationship. Must onboard from scratch.',
  },
  {
    name: 'Imran Haider',
    cnic: '33100-5567890-4',
    cnicAsUploadedByEmployer: '3310055678904',
    dob: '1996-04-09',
    profession: 'Machine Operator',
    monthlySalaryPkr: 36_000,
    hasWallet: false,
    story: 'No prior relationship.',
  },
  {
    name: 'Rukhsana Parveen',
    cnic: '33100-3345678-2',
    cnicAsUploadedByEmployer: '3310033456782',
    dob: '1985-12-30',
    profession: 'Line Supervisor',
    monthlySalaryPkr: 47_500,
    hasWallet: false,
    story: 'No prior relationship.',
  },
  {
    name: 'Abdul Rehman',
    cnic: '33100-9912345-7',
    cnicAsUploadedByEmployer: '3310099123457',
    dob: '1982-03-18',
    profession: 'Warehouse Hand',
    monthlySalaryPkr: 31_000,
    hasWallet: true,
    story: 'Wallet customer who will later be flagged by Compliance.',
  },
  {
    name: 'Shazia Kanwal',
    cnic: '33100-6678901-5',
    cnicAsUploadedByEmployer: '3310066789015',
    dob: '1998-09-25',
    profession: 'Trainee Operator',
    monthlySalaryPkr: 28_000,
    hasWallet: false,
    story: 'Leaves the mill mid-scenario and requests erasure.',
  },
];

/** Attribute payload for a completed Asaan Digital Account journey (A2). */
export function walletAttributes(p: DummyPerson, cnicExpiry: string) {
  return {
    cnic_number_hash: fakeHash(p.cnic),
    full_name_hash: fakeHash(p.name),
    date_of_birth: p.dob,
    cnic_expiry: cnicExpiry.slice(0, 10),
    father_or_husband_name_hash: fakeHash(`father-of-${p.name}`),
    address_hash: fakeHash(`${EMPLOYER.city}-${p.cnic}`),
    purpose_of_account: 'Salary disbursement',
    profession: p.profession,
    source_of_funds: 'Salary',
    fatca_status: false,
    verisys_match: true,
    document_authenticity_pass: true,
    biometric_match: true,
    liveness_pass: false,
  };
}

/** As above plus a passed liveness check (A3). */
export function walletAttributesA3(p: DummyPerson, cnicExpiry: string) {
  return { ...walletAttributes(p, cnicExpiry), liveness_pass: true };
}

/**
 * Employer-asserted record: a CNIC and a name, verified by nothing.
 * This is assurance level A0 and it grants access to precisely nothing.
 */
export function assertedAttributes(p: DummyPerson) {
  return {
    cnic_number_hash: fakeHash(p.cnic),
    full_name_hash: fakeHash(p.name),
    verisys_match: false,
    document_authenticity_pass: false,
    biometric_match: false,
    liveness_pass: false,
  };
}

/**
 * Stand-in for the one-way hashes a real gateway would compute over PII before
 * it ever reaches the attribute set. Deterministic so the demo is repeatable.
 */
function fakeHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').repeat(2);
}
