/**
 * The concept, told with dummy data.
 *
 *   npm run demo:scenario
 *
 * One employer payroll, eight fictional workers, nine months of activity.
 * Runs against the real chaincode domain logic, the real Merkle construction,
 * the real policy engine and the real encrypted vault — only the verification
 * rails and the people are simulated.
 *
 * The tally at the end compares what actually happened against what ABHI's
 * current per-product flow would have cost for exactly the same activity.
 */
import { REQUIRED_METHODS, type VerificationMethod } from '@abhi/types';
import { getPolicy } from '@abhi/policy';
import { verifyProofBundle } from '@abhi/merkle';
import { DEFAULT_RAIL_COSTS } from '../services/gateway/src/rails.ts';
import { harness } from '../tests/fixture.ts';
import {
  EMPLOYER,
  WORKFORCE,
  walletAttributes,
  walletAttributesA3,
  assertedAttributes,
  type DummyPerson,
} from './dummy-data.ts';

const PKR = (n: number): string => `PKR ${n.toLocaleString('en-PK')}`;
const W = 78;
const rule = (c = '─'): string => c.repeat(W);

function act(n: number, title: string, when: string): void {
  console.log(`\n${rule()}`);
  console.log(`  ${n}. ${title}`);
  console.log(`     ${when}`);
  console.log(rule());
}

function note(...lines: string[]): void {
  console.log('');
  for (const l of lines) console.log(l === '' ? '' : `  ${l}`);
}

/**
 * Counterfactual: what today's flow costs.
 *
 * Under the current per-product model every origination runs the full method
 * set its product requires — that is exactly what "Full KYC/CDD applies"
 * means in the EWA specification. This function prices that.
 */
function costOfFullJourney(productId: string): number {
  const policy = getPolicy(productId);
  if (policy === null) return 0;
  return REQUIRED_METHODS[policy.minAssurance].reduce(
    (sum, m: VerificationMethod) => sum + DEFAULT_RAIL_COSTS[m].unitCostPkr,
    0,
  );
}

let todayWouldHaveCost = 0;
const chargeToday = (productId: string): void => {
  todayWouldHaveCost += costOfFullJourney(productId);
};

const CNIC_EXPIRY_FAR = '2032-07-19T00:00:00Z';
/** Ghulam's card lapsed in July — before the scenario's "today". */
const CNIC_EXPIRY_LAPSED = '2026-07-15T00:00:00Z';
const CNIC_EXPIRY_RENEWED = '2036-10-01T00:00:00Z';

const byName = (n: string): DummyPerson => {
  const p = WORKFORCE.find((w) => w.name === n);
  if (p === undefined) throw new Error(`no such person: ${n}`);
  return p;
};

async function main(): Promise<void> {
  const h = harness();

  console.log(`\n${rule('═')}`);
  console.log('  ABHI UNIFIED KYC LEDGER — the concept, with dummy data');
  console.log(rule('═'));
  console.log(`  Employer   ${EMPLOYER.name}, ${EMPLOYER.city}`);
  console.log(`  Payroll    ${EMPLOYER.headcount} workers`);
  console.log(`  Ledger     ${h.ledger.mode}   ·   rails: mocked and cost-metered`);
  console.log('\n  All names, CNICs and accounts below are FICTIONAL.');

  // =====================================================================
  act(1, 'The employer uploads its payroll', 'January — via the corporate portal');

  console.log('\n  The CSV carries a CNIC and a name per worker. Nothing verifies either.\n');
  for (const p of WORKFORCE) {
    console.log(`    ${p.name.padEnd(20)} ${p.cnicAsUploadedByEmployer}  ${p.profession}`);
  }

  for (const p of WORKFORCE) {
    h.rails.recordAvoided([]); // no rails run — nothing is verified
    await h.svc.register(h.bank(), {
      cnic: p.cnic,
      attributes: assertedAttributes(p),
      originProduct: 'EMPLOYER',
      cnicExpiryAt: CNIC_EXPIRY_FAR,
    });
  }

  note('All eight land at assurance A0 — asserted, verified by nothing.', 'Today ABHI stores these identically to a biometrically-verified CNIC.', 'Here they are explicitly A0, and A0 grants access to nothing at all.');

  // =====================================================================
  act(2, 'Four workers open ABHI wallets independently', 'February to May — the Asaan Digital Account journey');

  const walletHolders = WORKFORCE.filter((p) => p.hasWallet);
  console.log('');
  for (const p of walletHolders) {
    const expiry = p.name === 'Ghulam Murtaza' ? CNIC_EXPIRY_LAPSED : CNIC_EXPIRY_FAR;
    const before = h.rails.metrics.costSpentPkr;

    await h.svc.stepUp(h.bank(), p.cnic, 'EWA', walletAttributes(p, expiry), expiry, 'Asaan Digital Account onboarding');
    chargeToday('EWA'); // today this journey is run per product too

    const spent = h.rails.metrics.costSpentPkr - before;
    console.log(`    ${p.name.padEnd(20)} A0 -> A2   Verisys + doc auth + biometric   ${PKR(spent)}`);
  }

  note('This is exactly the journey ABHI runs in production today.', 'The only change: the outcome is now remembered and provable.');

  // =====================================================================
  act(3, 'The employer asks: who can I activate now?', 'June — the same CSV, re-checked');

  const uploaded = WORKFORCE.map((p) => p.cnicAsUploadedByEmployer);
  const split = await h.svc.employerBulkLookup(h.bank(), uploaded);

  console.log(`\n    uploaded            ${split.total}`);
  console.log(`    activate now        ${split.activateNow.length}`);
  console.log(`    needs onboarding    ${split.needsOnboarding.length}\n`);

  for (const p of WORKFORCE) {
    const ready = split.activateNow.includes(p.cnicAsUploadedByEmployer);
    console.log(`    ${ready ? '✓ activate now  ' : '· needs onboard '} ${p.name}`);
  }

  note(
    'The CSV strips the dashes; the app captures them. Both resolve to one',
    'subject because normalisation is shared. Without that, this whole',
    'screen would show eight strangers.',
    '',
    'ABHI cannot produce this screen today.',
  );

  // =====================================================================
  act(4, 'The verified workers request Earned Wage Access', 'July — payday minus nine days');

  console.log('');
  for (const p of walletHolders.filter((x) => x.name !== 'Ghulam Murtaza')) {
    const consent = await h.svc.grantConsent(
      h.bank(), p.cnic, 'ABHILendingMSP', 'EWA_ORIGINATION',
      ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
      '2027-06-30T00:00:00Z', `tc-accept-${p.cnic.slice(-4)}`,
    );

    const before = h.rails.metrics.callsMade;
    const v = await h.svc.verify(h.lending(), p.cnic, 'EWA', consent.consentId);
    chargeToday('EWA');

    console.log(
      `    ${p.name.padEnd(20)} ${v.decision.outcome.padEnd(6)} ` +
        `rails: ${h.rails.metrics.callsMade - before}   ` +
        `avoided: ${PKR(v.costAvoidedPkr)}   e-CIB: ${v.eCibCalled ? 'ran' : 'skipped'}`,
    );
  }

  const sample = await h.svc.verify(
    h.lending(), byName('Muhammad Aslam').cnic, 'EWA',
    (await h.svc.grantConsent(
      h.bank(), byName('Muhammad Aslam').cnic, 'ABHILendingMSP', 'EWA_ORIGINATION',
      ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
      '2027-06-30T00:00:00Z', 'tc-sample',
    )).consentId,
  );

  note('Zero NADRA calls. The customer scans nothing.', 'e-CIB still runs every time — a credit check, not an identity check.');

  if (sample.proof !== null) {
    console.log('\n    What the lending platform actually receives — 4 of 14 attributes:\n');
    for (const a of sample.proof.attributes) {
      console.log(`      ${a.name.padEnd(22)} ${a.canonical.padEnd(14)} proof: ${a.path.length} steps ✓`);
    }
    const serialised = JSON.stringify(sample.proof);
    console.log(`\n    verified against the on-chain root: ${verifyProofBundle(sample.proof)}`);
    console.log('\n    What it cannot see, checked in bytes:\n');
    for (const [label, value] of [
      ['profession', 'Loom Operator'],
      ['date of birth', '1988-06-14'],
      ['address', 'Faisalabad'],
      ['account purpose', 'Salary disbursement'],
    ] as const) {
      console.log(`      ${label.padEnd(18)} present in bundle: ${serialised.includes(value)}`);
    }
  }

  // =====================================================================
  act(5, 'Ayesha needs a larger, longer advance', 'August — Salary-Backed Lending requires A3');

  const ayesha = byName('Ayesha Bibi');
  const pre = await h.svc.verify(h.lending(), ayesha.cnic, 'SBL', null);
  console.log(`\n    decision          ${pre.decision.outcome} — ${pre.decision.reason}`);
  console.log(`    already holds     ${pre.decision.currentAssurance}`);
  console.log(`    still needs       ${pre.decision.missingMethods.join(', ')}`);

  const beforeSbl = h.rails.metrics.costSpentPkr;
  const up = await h.svc.stepUp(
    h.lending(), ayesha.cnic, 'SBL',
    walletAttributesA3(ayesha, CNIC_EXPIRY_FAR), CNIC_EXPIRY_FAR, 'SBL step-up',
  );
  chargeToday('SBL');

  console.log(`\n    methods run       ${up.methodsRun.join(', ')}`);
  console.log(`    cost             ${PKR(h.rails.metrics.costSpentPkr - beforeSbl)}`);
  console.log(`    now at            ${up.assuranceLevel}, version ${up.version}`);
  console.log(`    today would cost  ${PKR(costOfFullJourney('SBL'))} — the entire pack, again`);

  note('One selfie instead of fingerprints, documents and a Verisys call.', 'And she never touches the three-attempts-per-day cap.');

  // =====================================================================
  act(6, "Ghulam's CNIC has lapsed", 'September — he renews it at a NADRA centre, not at ABHI');

  const ghulam = byName('Ghulam Murtaza');
  console.log('\n    He is verified to A2. His identity document is expired.\n');
  for (const product of ['EWA', 'ASA', 'SBL']) {
    const d = await h.svc.verify(h.lending(), ghulam.cnic, product, null);
    console.log(`      ${product.padEnd(6)} ${d.decision.outcome} — ${d.decision.reason}`);
  }
  note(
    'A hard stop, never a step-up. No amount of re-scanning fixes an expired',
    'identity document — the customer must renew with NADRA first.',
    '',
    'Today this flags in whichever product happens to notice. A card that',
    'lapses mid-facility flags nowhere at all.',
  );

  await h.svc.stepUp(
    h.bank(), ghulam.cnic, 'EWA',
    walletAttributes(ghulam, CNIC_EXPIRY_RENEWED), CNIC_EXPIRY_RENEWED, 'CNIC renewal',
  );

  console.log('\n    after renewal, every product on its next call:\n');
  for (const product of ['EWA', 'ASA', 'SBL']) {
    const d = await h.svc.verify(h.lending(), ghulam.cnic, product, null);
    console.log(`      ${product.padEnd(6)} ${d.decision.outcome} — ${d.decision.reason}`);
  }

  const chain = await h.svc.versionChain(h.bank(), ghulam.cnic);
  console.log(`\n    version chain     ${chain.versionCount} versions, integrity ${chain.chainValid ? 'VALID' : 'BROKEN'}`);
  for (const v of chain.versions) {
    console.log(
      `      v${v.version}  ${v.status.padEnd(11)} ${v.assuranceLevel}  ` +
        `prev: ${v.previousVersionHash === null ? 'null' : `${v.previousVersionHash.slice(0, 12)}…`}`,
    );
  }

  note('No batch job. No message to the lending team. No per-product migration.');

  // =====================================================================
  act(7, 'Compliance flags Abdul Rehman', 'September — an AML alert from transaction monitoring');

  const abdul = byName('Abdul Rehman');
  await h.svc.suspend(h.compliance(), abdul.cnic, 'AML alert — unusual counterparty', 'CASE-2026-2291');

  console.log('');
  for (const product of ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING']) {
    const d = await h.svc.verify(h.lending(), abdul.cnic, product, null);
    console.log(`    ${product.padEnd(20)} ${d.decision.outcome} — ${d.decision.reason}`);
  }

  let refused = 'unexpectedly succeeded';
  try {
    await h.svc.suspend(h.lending(), abdul.cnic, 'attempt from a product org', 'X');
  } catch (e) {
    refused = e instanceof Error && 'code' in e ? String((e as { code: string }).code) : 'rejected';
  }
  console.log(`\n    the lending org attempting the same call: ${refused}`);

  note('One action. Every product, immediately. No tickets with five teams.', 'And no product team can do this — or undo it.');

  // =====================================================================
  act(8, 'Shazia leaves the mill and asks to be erased', 'October — a data subject request');

  const shazia = byName('Shazia Kanwal');
  const rootBefore = (await h.svc.versionChain(h.bank(), shazia.cnic)).versions[0]!.merkleRoot;
  const vaultBefore = await h.vaultStore.count();

  const shred = await h.svc.shred(h.compliance(), shazia.cnic, 'Data subject erasure request', 'PDPB right to erasure');
  const after = (await h.svc.versionChain(h.bank(), shazia.cnic)).versions[0]!;
  const trail = await h.svc.auditTrail(h.bank(), shazia.cnic);

  console.log(`\n    vault records     ${vaultBefore} -> ${await h.vaultStore.count()}`);
  console.log(`    ciphertext, DEK and salts   destroyed: ${shred.vaultDestroyed}`);
  console.log(`    ledger status     ${after.status}`);
  console.log(`    merkle root       unchanged: ${after.merkleRoot === rootBefore}`);
  console.log(`    audit retained    ${trail.map((e) => e.action).join(', ')}`);

  note('32 bytes whose preimage no longer exists anywhere.', 'The bank can still prove a verification happened, and when.', 'It can no longer say anything about who.');

  // =====================================================================
  const m = h.svc.metrics;
  const actuallySpent = m.rails.costSpentPkr;
  const saved = todayWouldHaveCost - actuallySpent;

  console.log(`\n${rule('═')}`);
  console.log('  THE TALLY — one employer, eight workers, nine months');
  console.log(rule('═'));
  console.log(`\n    Rail calls made                 ${m.rails.callsMade}`);
  console.log(`    Rail calls avoided by reuse     ${m.rails.callsAvoided}`);
  console.log(`    e-CIB checks                    ${m.ecibCalls}  (never avoided, by design)`);
  console.log(`    Biometric lockouts              ${m.rails.capLockouts}`);
  console.log('');
  console.log(`    Spent on this ledger            ${PKR(actuallySpent)}`);
  console.log(`    Today's per-product flow        ${PKR(todayWouldHaveCost)}`);
  console.log(`    Difference                      ${PKR(saved)}` +
    (todayWouldHaveCost > 0 ? `   (${((saved / todayWouldHaveCost) * 100).toFixed(0)}% less)` : ''));

  console.log(`\n${rule()}`);
  console.log('  Scale that honestly.');
  console.log(rule());
  console.log(`
  This is EIGHT fictional workers at ONE employer. The rail unit costs are
  placeholder grid points, not ABHI's contracted NADRA rates.

  What this run does demonstrate is the MECHANISM: which calls disappear,
  which shrink to a single step, and which — e-CIB — never move at all.

  What it cannot tell you is the number that decides the programme: the
  proportion of ABHI's real verification traffic that re-verifies an
  already-verified customer. No system in the bank measures that today.

  That figure comes from the Sprint 0 duplication analysis over historical
  verification logs. Multiply it by real per-call costs and real volumes,
  and you have the business case. Multiply THIS demo by anything and you
  have a demo.
`);
  console.log(rule());
  console.log('');
}

main().catch((e: unknown) => {
  console.error('scenario failed:', e);
  process.exitCode = 1;
});
