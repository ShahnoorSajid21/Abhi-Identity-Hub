/**
 * ABHI Identity Hub — user-facing copy
 * ------------------------------------------------------------------
 * Every string a person reads lives here. Nothing in this file is a
 * placeholder; it is the finished wording.
 *
 * Rules, so later additions stay consistent:
 *
 *   1. No jargon in the visible layer. The banned list is in
 *      docs/FRONTEND_PLAN.md §9 and applies to this file absolutely,
 *      including inside glossary definitions.
 *   2. Short declarative sentences. British spelling. Sentence case
 *      for titles, never Title Case.
 *   3. An empty state explains why it is empty and what to do next.
 *      "No results" on its own is a bug, not a state.
 *   4. Distinguish "nothing exists yet" from "your filters excluded
 *      everything". They need different wording and different actions.
 *   5. Never blame the person. "No customers match these filters",
 *      not "You have not selected valid filters".
 *   6. Nothing here may imply the ledger removes CDD, e-CIB or AML
 *      screening.
 *
 * Icon names are lucide-react.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface GlossaryEntry {
  id: string;
  term: string;
  /** Optional second name people also use for this. Rendered smaller. */
  alsoKnownAs?: string;
  /** Two sentences. The first defines it, the second says why it matters here. */
  definition: string;
  /** Ids of related entries, rendered as chips at the foot of the entry. */
  related?: string[];
}

export interface EmptyStateCopy {
  icon: string;
  title: string;
  body: string;
  action?: { label: string; to?: string; intent?: 'primary' | 'secondary' };
  /** Use the positive treatment: mint icon, no muted styling. */
  positive?: boolean;
}

/* ------------------------------------------------------------------ */
/* Glossary — §3.6                                                     */
/* ------------------------------------------------------------------ */

export const GLOSSARY_INTRO =
  'Plain explanations of the terms used in this system. Nothing here assumes ' +
  'a technical background.';

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'cnic',
    term: 'CNIC',
    alsoKnownAs: 'Computerised National Identity Card',
    definition:
      'The national identity card issued to every adult citizen of Pakistan, ' +
      'carrying a thirteen-digit number unique to that person. It is how ABHI ' +
      'identifies a customer across every product, and it has an expiry date ' +
      'that has to be kept track of.',
    related: ['nadra-verisys', 'cnic-expiry'],
  },
  {
    id: 'cnic-expiry',
    term: 'CNIC expiry',
    definition:
      'Every CNIC card stops being valid on a set date, after which the holder ' +
      'must renew it with NADRA. A customer whose CNIC has expired cannot be ' +
      'taken through a new product until they renew it — no amount of ' +
      're-checking fixes an expired card, so this system stops rather than ' +
      'asking for another scan.',
    related: ['cnic', 'identity-history'],
  },
  {
    id: 'nadra-verisys',
    term: 'NADRA record check',
    alsoKnownAs: 'Verisys',
    definition:
      'A check that asks NADRA, the government body that issues identity cards, ' +
      'whether the details a customer has given match the ones on their record. ' +
      'It confirms the identity exists and belongs to that person, but it does ' +
      'not on its own prove the person standing in front of you is them.',
    related: ['cnic', 'fingerprint-check', 'confirmation-levels'],
  },
  {
    id: 'document-check',
    term: 'CNIC document check',
    definition:
      'A photograph of the front and back of the physical card is read ' +
      'automatically and checked for signs that it has been altered or forged. ' +
      'It proves the card itself is genuine, which the NADRA record check alone ' +
      'does not.',
    related: ['nadra-verisys', 'confirmation-levels'],
  },
  {
    id: 'fingerprint-check',
    term: 'Fingerprint verification',
    alsoKnownAs: 'biometric check',
    definition:
      "The customer's fingerprints are captured and NADRA confirms they match " +
      'the ones held against that identity card. This is the check that proves ' +
      'the person present is the person the card belongs to, which is why most ' +
      'lending products require it.',
    related: ['nadra-verisys', 'selfie-check', 'confirmation-levels'],
  },
  {
    id: 'selfie-check',
    term: 'Live selfie check',
    alsoKnownAs: 'liveness check',
    definition:
      'The customer takes a photograph of themselves on the spot, and the system ' +
      'confirms it is a live person rather than a held-up photo, and that it is ' +
      'the right person. It is used for higher-value products, on top of the ' +
      'fingerprint check rather than instead of it.',
    related: ['fingerprint-check', 'confirmation-levels'],
  },
  {
    id: 'confirmation-levels',
    term: 'Identity confirmation levels',
    definition:
      'Four steps describing how thoroughly a person’s identity has been ' +
      'confirmed: claimed, ID checked, fingerprint verified, and fingerprint ' +
      'plus selfie. Each product decides which step it needs, which is how a ' +
      'CNIC an employer simply typed into a spreadsheet is kept separate from ' +
      'one NADRA has matched by fingerprint.',
    related: ['fingerprint-check', 'selfie-check', 'reuse'],
  },
  {
    id: 'reuse',
    term: 'Reusing a confirmed identity',
    definition:
      'When a customer has already been confirmed to the standard a product ' +
      'needs, and recently enough, that product can rely on the earlier ' +
      'confirmation instead of putting the customer through the same checks ' +
      'again. The customer still goes through every check the product requires ' +
      'for other reasons — this only avoids repeating identity work already ' +
      'done.',
    related: ['confirmation-levels', 'proof', 'ecib'],
  },
  {
    id: 'one-more-check',
    term: 'One more check needed',
    definition:
      'The customer has been confirmed before, but this particular product needs ' +
      'something the earlier confirmation did not include — usually a fingerprint ' +
      'or a selfie. Only the missing check is run; everything already confirmed ' +
      'is reused, so the customer does not repeat the whole process.',
    related: ['confirmation-levels', 'reuse'],
  },
  {
    id: 'proof',
    term: 'Proof',
    definition:
      'A short piece of evidence that a specific fact about a customer — for ' +
      'example that their fingerprint was matched — was recorded at the time it ' +
      'was checked and has not been altered since. A product can confirm a proof ' +
      'is genuine on its own, without having to trust the system that sent it.',
    related: ['selective-disclosure', 'identity-history'],
  },
  {
    id: 'selective-disclosure',
    term: 'Sharing only what is needed',
    definition:
      'Each product is told only the facts its own rules require, and nothing ' +
      'else. Earned Wage Access can be shown that a fingerprint was matched and ' +
      "when the CNIC expires without ever being shown the customer's address, " +
      'profession or source of funds.',
    related: ['proof', 'consent'],
  },
  {
    id: 'consent',
    term: 'Consent',
    definition:
      'A record of the customer agreeing that a particular part of ABHI may see ' +
      'particular details about them, for a stated purpose and a limited period. ' +
      'Consent can be withdrawn, and every use of a confirmed identity by another ' +
      'product is checked against it first.',
    related: ['selective-disclosure'],
  },
  {
    id: 'ecib',
    term: 'e-CIB check',
    alsoKnownAs: 'credit bureau check',
    definition:
      "A check with the State Bank's credit information bureau covering a " +
      'customer’s borrowing history and current obligations. It is a credit ' +
      'check, not an identity check, so it runs every single time a customer ' +
      'applies for something — this system does not replace it or skip it.',
    related: ['reuse'],
  },
  {
    id: 'freeze',
    term: 'Freeze',
    definition:
      'A Compliance officer can stop a customer from proceeding anywhere in the ' +
      'bank with a single action, and every product refuses them from that moment ' +
      'on. It takes effect immediately and needs no work from any product team.',
    related: ['identity-history', 'signed-off-by'],
  },
  {
    id: 'identity-history',
    term: 'Identity history',
    definition:
      "The full record of every time a customer's identity was confirmed, " +
      'upgraded, renewed, frozen or reinstated, in order, with the date of each. ' +
      'Entries are added but never changed or removed, so the bank can always ' +
      'show what it knew about a customer and when it knew it.',
    related: ['freeze', 'proof', 'erasure'],
  },
  {
    id: 'signed-off-by',
    term: 'Signed off by',
    definition:
      'Every change to a customer’s identity record has to be approved by ' +
      'Compliance together with the part of the bank making the change. No single ' +
      'team, and no single person with database access, can mark a customer as ' +
      'confirmed on their own.',
    related: ['freeze', 'identity-history'],
  },
  {
    id: 'erasure',
    term: 'Erasing personal data',
    definition:
      "A customer's personal details can be permanently destroyed on request, " +
      'while the record that a verification took place is kept, as the bank is ' +
      'separately required to do. Once erased the details cannot be recovered by ' +
      'anyone, including ABHI.',
    related: ['identity-history'],
  },
];

/** Which glossary entry a decision banner's "What does this mean?" opens. */
export const DECISION_GLOSSARY_TARGET: Record<string, string> = {
  ALLOW: 'reuse',
  STEP_UP: 'one-more-check',
  FULL_KYC: 'confirmation-levels',
  DENY_SUSPENDED: 'freeze',
  DENY_CNIC_EXPIRED: 'cnic-expiry',
};

/* ------------------------------------------------------------------ */
/* Identity confirmation levels — §3.1                                 */
/* ------------------------------------------------------------------ */

/**
 * The plain label is never omitted. A bare level code on its own is the exact
 * thing this rebuild exists to remove.
 */
export const LEVELS: Record<
  'A0' | 'A1' | 'A2' | 'A3',
  { label: string; meaning: string; short: string }
> = {
  A0: {
    label: 'Claimed',
    short: 'Claimed',
    meaning: 'Someone gave us this CNIC. Nobody has checked it.',
  },
  A1: {
    label: 'ID checked',
    short: 'ID checked',
    meaning: 'The CNIC card was verified as genuine and matched against NADRA records.',
  },
  A2: {
    label: 'Fingerprint verified',
    short: 'Fingerprint',
    meaning: "NADRA matched this person's fingerprint.",
  },
  A3: {
    label: 'Fingerprint + selfie',
    short: '+ Selfie',
    meaning: 'Fingerprint match plus a live selfie check.',
  },
};

/** The checks themselves, in plain words. */
export const METHODS: Record<string, string> = {
  ASSERTED: 'Given to us, not checked',
  VERISYS: 'NADRA record match',
  DOC_AUTH: 'CNIC document check',
  BIOMETRIC_1TO1: 'Fingerprint match',
  LIVENESS: 'Live selfie check',
};

/* ------------------------------------------------------------------ */
/* Decisions — §3.2                                                    */
/* ------------------------------------------------------------------ */

export const DECISIONS: Record<string, { headline: string; supporting: string }> = {
  ALLOW: {
    headline: 'Ready to proceed',
    supporting:
      'Identity already confirmed to the standard this product requires. No new ' +
      'checks needed.',
  },
  STEP_UP: {
    headline: 'One more check needed',
    supporting:
      'We have confirmed this person before, but this product needs {missing}. ' +
      'Everything else can be reused.',
  },
  FULL_KYC: {
    headline: 'New customer — full onboarding',
    supporting: 'We have no confirmed identity for this person yet.',
  },
  DENY: {
    headline: 'Cannot proceed',
    supporting: '{reason}',
  },
};

/**
 * All seven reasons the decision engine can return, in plain words.
 *
 * The original plan wrote only two of these. STALE in particular will be seen
 * during the demo: Salary-Backed Lending and Merchant Financing both cap a
 * confirmation at 180 days.
 */
export const DECISION_REASONS: Record<string, string> = {
  SUFFICIENT: 'This customer has already been confirmed to the standard this product needs.',
  NO_RECORD: 'ABHI has not confirmed who this person is yet.',
  SUSPENDED: 'This customer is frozen by Compliance.',
  SHREDDED: "This customer's personal details were erased at their request.",
  CNIC_EXPIRED:
    "This customer's CNIC expired on {date}. They must renew it with NADRA first.",
  ASSURANCE_LOW: 'This product needs a more thorough check than the one on record.',
  STALE: 'This customer was confirmed too long ago for what this product requires.',
  // Neither of these is a decision — the first never became a subject, the
  // second was never looked up. They appear only on an employer upload.
  INVALID_CNIC: 'This CNIC is not a valid 13-digit number, so no record could be found.',
  NOT_EMPLOYED:
    'This CNIC is not on the employer’s roster, so ABHI did not look it up.',
};

/* ------------------------------------------------------------------ */
/* Attributes — §3.7                                                   */
/* ------------------------------------------------------------------ */

/**
 * Plain names for the 14 attributes. Matches the canonical list in
 * packages/merkle/src/attributes.ts exactly — if that list changes, this one
 * has to change with it.
 */
export const ATTRIBUTES: Record<string, string> = {
  cnic_number_hash: 'CNIC number',
  full_name_hash: 'Full name',
  date_of_birth: 'Date of birth',
  cnic_expiry: 'CNIC expiry date',
  father_or_husband_name_hash: 'Father / husband name',
  address_hash: 'Address',
  purpose_of_account: 'Purpose of account',
  profession: 'Profession',
  source_of_funds: 'Source of funds',
  fatca_status: 'FATCA declaration',
  verisys_match: 'NADRA record match',
  document_authenticity_pass: 'CNIC document genuine',
  biometric_match: 'Fingerprint match',
  liveness_pass: 'Live selfie match',
};

export const DISCLOSURE = {
  sharedHeading: 'Shared with this product',
  notSharedHeading: 'Not shared',
  provenChip: 'Proven',
  notDisclosedLabel: 'Not disclosed',
};

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

/**
 * Display names. The list of products is read from GET /policies and never
 * hardcoded — this map only supplies the wording for whatever comes back.
 */
export const PRODUCTS: Record<string, string> = {
  EWA: 'Earned Wage Access',
  ASA: 'Asaan Digital Account',
  SBL: 'Salary-Backed Lending',
  MERCHANT_FINANCING: 'Merchant Financing',
  EMPLOYER_BULK: 'Employer onboarding',
  PARTNER_READ: 'Partner access',
  WALLET: 'Wallet',
};

/**
 * The four products a customer is offered. The policy table also carries
 * internal ones — employer onboarding, partner access, the wallet — which are
 * real policies but not things a branch offers somebody, and showing them on a
 * customer's profile reads as noise.
 */
export const CUSTOMER_FACING_PRODUCTS = ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING'];

/* ------------------------------------------------------------------ */
/* Record status                                                       */
/* ------------------------------------------------------------------ */

export const RECORD_STATUS: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Frozen',
  SUPERSEDED: 'Replaced by a newer version',
  SHREDDED: 'Erased',
};

/** The compact form, for a table cell where the full phrase will not fit. */
export const RECORD_STATUS_SHORT: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Frozen',
  SUPERSEDED: 'Superseded',
  SHREDDED: 'Erased',
};

/* ------------------------------------------------------------------ */
/* Navigation and page titles                                          */
/* ------------------------------------------------------------------ */

export const APP_NAME = 'ABHI';
export const APP_SUBTITLE = 'Identity Hub';

export const NAV = {
  dashboard: 'Dashboard',
  customers: 'Customers',
  queue: 'Verification Queue',
  onboarding: 'Employer Onboarding',
  compliance: 'Compliance',
  audit: 'Audit Trail',
  settings: 'Settings',
};

export const PAGE_TITLES = {
  dashboard: 'Dashboard',
  customers: 'Customers',
  customerProfile: 'Customer',
  newCustomer: 'New customer',
  queue: 'Verification queue',
  queueRequest: 'Verification request',
  onboarding: 'Employer onboarding',
  compliance: 'Compliance',
  audit: 'Audit trail',
  policies: 'Product policies',
};

export const TOP_BAR = {
  searchPlaceholder: 'Search by name, CNIC or employee code',
  searchGroupCustomers: 'Customers',
  searchGroupRequests: 'Requests',
  environmentBadge: 'POC ENVIRONMENT · SYNTHETIC DATA',
  spendLabel: 'Verification spend today',
  helpLabel: 'What do these terms mean?',
};

export const ROLE_SWITCHER = {
  heading: 'Signed in as',
  hint: 'Switching changes what the ledger will let you do, not just this screen.',
};

/* ------------------------------------------------------------------ */
/* Table columns and filters                                           */
/* ------------------------------------------------------------------ */

export const COLUMNS = {
  customer: 'Customer',
  employer: 'Employer',
  identityStatus: 'Identity status',
  lastVerified: 'Last verified',
  cnicExpiry: 'CNIC expiry',
  recordStatus: 'Record status',
  product: 'Product',
  requested: 'Requested',
  outcome: 'Outcome',
  action: 'Action',
  when: 'When',
  who: 'Who',
  whatHappened: 'What happened',
  minimumLevel: 'Minimum identity level',
  maximumAge: 'Maximum age of confirmation',
  attributesDisclosed: 'Details shared',
};

export const FILTERS = {
  search: 'Search',
  identityLevel: 'Identity level',
  recordStatus: 'Record status',
  employer: 'Employer',
  expiringSoon: 'CNIC expiring within 90 days',
  dateRange: 'Date range',
  actor: 'Person',
  actionType: 'Action',
  clearAll: 'Clear all filters',
};

export const ACTIONS = {
  viewProfile: 'View profile',
  // The profile header's own action. It opens the application rather than
  // running anything: the checks a customer still owes belong to the customer,
  // and the operator's job from this screen is to send them and then watch
  // them land. The 'Run missing checks' button that used to sit beside it was
  // the operator standing in for the customer, and has been removed.
  checkEligibility: 'Check eligibility',
  freeze: 'Freeze',
  releaseHold: 'Release hold',
  freezeCustomer: 'Freeze customer',
  reinstate: 'Reinstate customer',
  erase: 'Erase personal data',
  exportRow: 'Export row',
  exportCsv: 'Export CSV',
  newCustomer: 'New customer',
  downloadTemplate: 'Download the template',
  chooseFile: 'Choose another file',
  tryAgain: 'Try again',
  copy: 'Copy',
  technicalDetail: 'Technical detail',
  whatDoesThisMean: 'What does this mean?',
  revokeConsent: 'Withdraw consent',
  attemptAnyway: 'Attempt anyway',
};

export const TABS = {
  identity: 'Identity',
  identityHistory: 'Identity history',
  productAccess: 'Product access',
  activity: 'Activity',
  freezeReinstate: 'Freeze and reinstate',
  erasureRequests: 'Erasure requests',
  queueReady: 'Ready to proceed',
  queueStepUp: 'Needs one more check',
  queueFullKyc: 'Needs full onboarding',
  queueBlocked: 'Blocked',
};

/* ------------------------------------------------------------------ */
/* Wizard steps                                                        */
/* ------------------------------------------------------------------ */

export const ONBOARDING_STEPS = ['Upload', 'Review', 'Activate'];

export const KYC_STEPS = [
  'CNIC and date of birth',
  'NADRA record check',
  'CNIC document check',
  'Fingerprint',
  'Confirmation',
];

/* ------------------------------------------------------------------ */
/* Empty states — every list in the app                                */
/* ------------------------------------------------------------------ */

export const EMPTY: Record<string, EmptyStateCopy> = {
  /* --- Dashboard --------------------------------------------------- */

  dashboardNeedsAttention: {
    icon: 'CheckCircle2',
    title: 'Nothing needs attention',
    body:
      'No customers are frozen, and no CNICs are due to expire in the next ' +
      '90 days.',
    positive: true,
  },

  dashboardRecentActivity: {
    icon: 'Activity',
    title: 'No activity yet today',
    body:
      'Verifications, onboarding and Compliance actions will appear here as ' +
      'they happen.',
  },

  /* --- Customer directory ------------------------------------------ */

  customersNone: {
    icon: 'Users',
    title: 'No customers yet',
    body:
      'Once customers are onboarded, they will be listed here with their ' +
      'identity status.',
    action: { label: 'Add a customer', to: '/customers/new', intent: 'primary' },
  },

  customersNoMatch: {
    icon: 'SearchX',
    title: 'No customers match these filters',
    body: 'Try widening the identity level or clearing the employer filter.',
    action: { label: 'Clear all filters', intent: 'secondary' },
  },

  customersNoSearchResult: {
    icon: 'SearchX',
    title: 'Nothing found for that search',
    body:
      'Check the spelling, or search by CNIC or employee code instead of by ' +
      'name.',
    action: { label: 'Clear search', intent: 'secondary' },
  },

  /* --- Customer profile -------------------------------------------- */

  profileHistorySingle: {
    icon: 'GitCommitHorizontal',
    title: 'Only the first entry so far',
    body:
      "This customer's identity has been confirmed once and not changed since. " +
      'Renewals, upgrades and Compliance actions will be added here.',
  },

  profileNoIdentity: {
    icon: 'ShieldQuestion',
    title: 'Identity not confirmed yet',
    body:
      'This person has been added to ABHI’s records, but nobody has checked ' +
      'who they are. No product can lend to them until that happens.',
    action: { label: 'Start identity confirmation', intent: 'primary' },
  },

  profileNoConsent: {
    icon: 'FileCheck',
    title: 'No consent on record',
    body:
      'This customer has not yet agreed to their confirmed identity being used ' +
      'by another product.',
  },

  profileNoActivity: {
    icon: 'Activity',
    title: 'No activity for this customer',
    body:
      'Verifications, updates and Compliance actions involving this customer ' +
      'will be listed here.',
  },

  /* --- Verification queue ------------------------------------------ */

  queueNone: {
    icon: 'Inbox',
    title: 'No requests waiting',
    body:
      'When a product asks whether a customer can proceed, the request will ' +
      'appear here.',
    positive: true,
  },

  queueReady: {
    icon: 'Inbox',
    title: 'Nothing ready to proceed',
    body:
      'No waiting request has an identity confirmation that already meets its ' +
      "product's requirements.",
  },

  queueStepUp: {
    icon: 'Inbox',
    title: 'No requests need a further check',
    body:
      'Every waiting request either has everything it needs, or needs full ' +
      'onboarding.',
    positive: true,
  },

  queueFullKyc: {
    icon: 'Inbox',
    title: 'No requests need full onboarding',
    body: 'Every waiting request belongs to somebody ABHI has confirmed before.',
    positive: true,
  },

  queueBlocked: {
    icon: 'ShieldCheck',
    title: 'Nothing is blocked',
    body: 'No waiting request involves a frozen customer or an expired CNIC.',
    positive: true,
  },

  queueNoMatch: {
    icon: 'SearchX',
    title: 'No requests match these filters',
    body: 'Try a different product, or widen the date range.',
    action: { label: 'Clear all filters', intent: 'secondary' },
  },

  /* --- Employer onboarding ----------------------------------------- */

  onboardingStart: {
    icon: 'Upload',
    title: 'Upload an employee list',
    body:
      "Drop the employer's spreadsheet here and ABHI will check each employee " +
      'against its records, so you can see who can be activated straight away.',
    action: { label: 'Download the template', intent: 'secondary' },
  },

  onboardingNoRows: {
    icon: 'FileWarning',
    title: 'That file has no employee rows',
    body:
      'The file was read successfully but contained only a header. Check that ' +
      'the right sheet was exported.',
    action: { label: 'Choose another file', intent: 'primary' },
  },

  onboardingSegmentEmpty: {
    icon: 'ListFilter',
    title: 'No employees in this group',
    body: 'Select one of the other groups above to see those employees.',
    action: { label: 'Show all employees', intent: 'secondary' },
  },

  /* --- Compliance --------------------------------------------------- */

  complianceNoSelection: {
    icon: 'UserSearch',
    title: 'Choose a customer',
    body:
      'Search by name or CNIC above to see their identity record and the ' +
      'actions available.',
  },

  complianceNoFrozen: {
    icon: 'ShieldCheck',
    title: 'No customers are frozen',
    body: 'Frozen customers will be listed here, with who froze them and why.',
    positive: true,
  },

  complianceNoErasures: {
    icon: 'Trash2',
    title: 'No erasure requests',
    body:
      'When a customer asks for their personal details to be erased, the ' +
      'request will appear here.',
  },

  /* --- Audit trail --------------------------------------------------- */

  auditNone: {
    icon: 'ScrollText',
    title: 'No entries yet',
    body:
      'Every identity confirmation, update and Compliance action is recorded ' +
      'here as it happens.',
  },

  auditNoMatch: {
    icon: 'SearchX',
    title: 'No entries match these filters',
    body: 'Try a wider date range, or clear the person and action filters.',
    action: { label: 'Clear all filters', intent: 'secondary' },
  },

  /* --- Global search ------------------------------------------------- */

  searchIdle: {
    icon: 'Search',
    title: 'Search by name, CNIC or employee code',
    body: 'Start typing to find a customer or a waiting request.',
  },

  searchNoResult: {
    icon: 'SearchX',
    title: 'Nothing found',
    body:
      'No customer or request matches that. CNICs can be entered with or ' +
      'without dashes.',
  },

  /* --- Settings ------------------------------------------------------ */

  policiesNone: {
    icon: 'SlidersHorizontal',
    title: 'No product policies configured',
    body:
      'Each product needs a policy setting how thoroughly a customer must be ' +
      'confirmed before it can rely on that confirmation.',
  },
};

/* ------------------------------------------------------------------ */
/* Error states                                                        */
/* ------------------------------------------------------------------ */

export const ERRORS: Record<string, EmptyStateCopy> = {
  generic: {
    icon: 'AlertCircle',
    title: 'Something went wrong',
    body: 'This did not load. Try again, and if it keeps happening tell the team.',
    action: { label: 'Try again', intent: 'primary' },
  },

  gatewayUnreachable: {
    icon: 'PlugZap',
    title: 'Cannot reach the identity service',
    body:
      'The service is not responding. Nothing has been changed — it is safe to ' +
      'try again.',
    action: { label: 'Try again', intent: 'primary' },
  },

  ledgerUnreachable: {
    icon: 'DatabaseZap',
    title: 'Cannot reach the identity records',
    body:
      'Identity records are temporarily unavailable, so verifications cannot ' +
      'run. Existing customer details are unaffected.',
    action: { label: 'Try again', intent: 'primary' },
  },

  vaultUnavailable: {
    icon: 'Lock',
    title: 'Cannot open the secure store',
    body:
      "This customer's confirmed identity can still be checked, but the " +
      'supporting evidence cannot be shown right now.',
    action: { label: 'Try again', intent: 'secondary' },
  },

  notAuthorised: {
    icon: 'ShieldX',
    title: 'You cannot take this action',
    body:
      'This action is reserved for Compliance. Switch to a Compliance sign-in, ' +
      'or ask a Compliance officer to do it.',
  },

  writeRejected: {
    icon: 'ShieldX',
    title: 'The record refused this change',
    body:
      'A change to a customer’s identity has to be approved by Compliance ' +
      'together with the team making it. This one was not, so nothing was ' +
      'recorded.',
  },

  railUnavailable: {
    icon: 'WifiOff',
    title: 'NADRA is not responding',
    body:
      'The identity check could not be completed. Nothing has been charged and ' +
      'nothing has been recorded.',
    action: { label: 'Try again', intent: 'primary' },
  },

  csvUnreadable: {
    icon: 'FileWarning',
    title: 'That file could not be read',
    body:
      'The file must be a CSV with the fifteen standard columns. Download the ' +
      'template to check the format.',
    action: { label: 'Download the template', intent: 'secondary' },
  },

  notFound: {
    icon: 'FileQuestion',
    title: 'Not found',
    body: 'That customer or request does not exist, or has been removed.',
    action: { label: 'Back to customers', to: '/customers', intent: 'secondary' },
  },

  /**
   * Shown where a screen depends on something not yet built. Honest about it
   * rather than rendering a zero, which would be a claim.
   */
  notBuiltYet: {
    icon: 'Construction',
    title: 'Not available yet',
    body: 'This part of the system is still being built.',
  },
};

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export const TOASTS = {
  identityConfirmed: (name: string) =>
    `${name}’s identity confirmed and recorded.`,
  identityUpdated: (name: string) => `${name}’s identity record updated.`,
  stepUpComplete: (name: string, check: string) =>
    `${check} completed. ${name} can now proceed.`,
  customerFrozen: (name: string) =>
    `${name} is frozen. Every product will now refuse them.`,
  customerReinstated: (name: string) =>
    `${name} is reinstated and can proceed again.`,
  dataErased: (name: string) =>
    `${name}’s personal details have been erased. The verification record remains.`,
  consentRevoked: 'Consent withdrawn.',
  csvProcessed: (n: number) => `${n.toLocaleString('en-PK')} employees checked.`,
  employeesActivated: (n: number) =>
    `${n.toLocaleString('en-PK')} employees activated.`,
  employeesQueued: (n: number) =>
    `${n.toLocaleString('en-PK')} employees sent for onboarding.`,
  copied: 'Copied.',
  exported: 'Exported.',
};

/* ------------------------------------------------------------------ */
/* Tooltips and inline notes                                           */
/* ------------------------------------------------------------------ */

export const NOTES = {
  /** Sits under the Identity card on every customer profile. Required. */
  ledgerHoldsNoData:
    'Names and employment details come from core banking. The ledger holds ' +
    'only proof of verification — never personal data.',

  /**
   * Under the eligibility panel on a customer profile.
   *
   * The panel answers from the record the profile already loaded, so it can
   * answer instantly for all four products at once. That is a preview of the
   * gateway's decision, not the decision — say so, because an operator who
   * mistakes one for the other will quote it to a customer.
   */
  eligibilityPreview:
    'Worked out from the record on this page, so nothing is written and no ' +
    'checks are run. The product itself asks the ledger again when the ' +
    'application is opened, and that answer is the one that counts.',

  /* The two step-up panel notes that lived here described a control the
     customer profile no longer has. The operator does not run a customer's
     checks on their behalf; the customer app does, and the profile monitors
     it. Copy for a removed control is copy waiting to be pasted back. */

  /** Tooltip on a disabled Freeze button. Required. */
  freezeRestricted:
    'Only Compliance can freeze a customer. This is enforced by the ledger, ' +
    'not by this screen.',

  /** Caption under the erasure result panel. Required. */
  erasureResult:
    'The personal data is gone. The record that a verification happened ' +
    'remains, as the bank is required to keep it.',

  /** Caption under the identity history timeline. */
  historyImmutable:
    'Each entry is cryptographically linked to the one before it. Nothing ' +
    'here can be edited or removed.',

  /** Caption under the freeze result panel. */
  freezePropagation:
    'One action. Every product, immediately. No integration work in any of them.',

  /** Callout at the top of the audit trail. */
  auditVerifiable:
    'Every entry here corresponds to a transaction on the ledger and can be ' +
    'independently verified. Nothing in this list can be edited or deleted.',

  /** Shown beside any reuse result, so nobody mishears the claim. */
  reuseScope:
    'Credit and sanctions checks still run on every application. Only the ' +
    'identity checks were reused.',

  /**
   * Employer upload — what a bulk upload does NOT do.
   *
   * Consolidated Product Manual v2 §8.2: the bulk template carries fifteen
   * columns and verifies none of them. An employee uploaded this way is an
   * assertion by their employer, which is exactly the A0 rung of the ladder.
   * Saying so on the screen is the difference between the console reporting
   * a fact and the console flattering the programme.
   */
  employerUploadIsAsserted:
    'An employer upload is a claim, not a check. Employees who arrive this ' +
    'way and are not already known to ABHI are recorded as Claimed (A0) — ' +
    'nobody has verified them.',

  /**
   * The regulatory position, stated where it is relevant.
   *
   * Product Manual §6.1 puts full KYC/CDD on the employee at disbursement,
   * and §6.3a puts CNIC screening and the e-CIB check with ABHI Bank at the
   * same point. Neither attaches to the employer upload, and reuse cannot
   * displace either.
   */
  employerUploadCompliance:
    'Full KYC/CDD applies to the employee at disbursement, not at upload ' +
    '(Product Manual §6.1). CNIC screening and the e-CIB check are performed ' +
    'by ABHI Bank on every origination (§6.3a) and are never reused.',

  /** The lending ceiling these employees will draw against, once activated. */
  employerExposureCeiling:
    'EWA and ASA are capped at PKR 500,000 per employee under SBP Prudential ' +
    'Regulation R-6 for Microfinance Banks. Identity assurance does not ' +
    'change that ceiling.',

  /** Why the CNIC column is normalised before anything else happens. */
  employerCnicNormalised:
    'The employer template issues CNICs without dashes (§8.2) while the app ' +
    'captures them with. Both are normalised to the same subject before ' +
    'lookup — otherwise one person becomes two records.',

  /** Dashboard sub-line beside the record count. */
  syntheticData:
    'Synthetic dataset — no real identities. CNIC check digits are ' +
    'deliberately invalid.',

  /** Settings page note. */
  policyGovernance:
    'Changing what a product requires is a governed decision, not a setting. ' +
    'These values are shown here for reference.',

  /**
   * Required wherever money is shown. The unit costs in the system are
   * modelled grid points awaiting Finance; presenting them as ABHI's rates
   * would be an overclaim, and one overclaim costs more than ten
   * underclaims.
   */
  costsAreModelled:
    "Unit costs are modelled placeholders, not ABHI's contracted rates. " +
    'Volumes and repeat-verification rates are not yet measured.',

  /** Shown wherever the identity records are served by the simulator. */
  simulatedLedger:
    'Identity records are being served by the simulator, not a live network.',
};
