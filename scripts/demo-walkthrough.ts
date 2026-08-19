/**
 * ABHI Unified KYC Ledger — the 20-minute demo, as a runnable script.
 *
 *   npm run demo:walkthrough
 *
 * Nine steps, in the order they should be shown to senior management. Step 9
 * is the one the CFO remembers; everything before it is how it became credible.
 */
// FICTIONAL-CNIC-OK: fictional CNICs for the bulk-upload demonstration. Never real customer data.
import { verifyProofBundle } from '@abhi/merkle';
import { KycError } from '@abhi/types';
import {
  harness,
  a0Attributes,
  a2Attributes,
  a3Attributes,
  CNIC_WALLET,
  CNIC_FRESH,
  CNIC_EMPLOYER,
  CNIC_EXPIRY_OK,
} from '../tests/fixture.ts';

const PKR = (n: number): string => `PKR ${n.toLocaleString('en-PK')}`;
const line = (c = '─'): string => c.repeat(78);

let step = 0;
function heading(title: string): void {
  step += 1;
  console.log(`\n${line()}`);
  console.log(`  STEP ${step} · ${title}`);
  console.log(line());
}

function kv(k: string, v: unknown): void {
  console.log(`    ${String(k).padEnd(26)} ${String(v)}`);
}

async function main(): Promise<void> {
  const h = harness();

  console.log(`\n${line('═')}`);
  console.log('  ABHI UNIFIED KYC LEDGER — PROOF OF CONCEPT');
  console.log(`  Ledger mode: ${h.ledger.mode}   ·   HSM: ${h.hsm.kind}   ·   Rails: mocked`);
  console.log(line('═'));

  // ---------------------------------------------------------------- 1
  heading('New customer — the full Asaan Digital Account journey');
  const reg = await h.svc.register(h.bank(), {
    cnic: CNIC_WALLET,
    attributes: a2Attributes(),
    originProduct: 'WALLET',
    cnicExpiryAt: CNIC_EXPIRY_OK,
  });
  kv('subject_id', `${reg.subjectId.slice(0, 32)}…`);
  kv('merkle_root', `${reg.merkleRoot.slice(0, 32)}…`);
  kv('assurance', reg.assuranceLevel);
  kv('methods', reg.methods.join(', '));
  kv('rail calls made', reg.railCallsMade);
  kv('cost incurred', PKR(reg.costSpentPkr));
  console.log('\n    The journey is exactly what happens in production today.');
  console.log('    The only addition is that the outcome is now remembered.');

  // ---------------------------------------------------------------- 2
  heading('Same customer requests EWA — the reuse path');
  const consent = await h.svc.grantConsent(
    h.bank(),
    CNIC_WALLET,
    'ABHILendingMSP',
    'EWA_ORIGINATION',
    ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
    '2027-01-01T00:00:00Z',
    'tc-accept-ewa-001',
  );
  const before = h.rails.metrics.callsMade;
  const ewa = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', consent.consentId);

  kv('decision', `${ewa.decision.outcome} — ${ewa.decision.reason}`);
  kv('verified', `${ewa.decision.ageDays} days ago`);
  kv('rail calls made', h.rails.metrics.callsMade - before);
  kv('rail calls avoided', ewa.railCallsAvoided);
  kv('cost avoided', PKR(ewa.costAvoidedPkr));
  kv('e-CIB still ran', ewa.eCibCalled);
  console.log('\n    Zero NADRA calls. Zero customer friction.');
  console.log('    e-CIB still runs — it is a credit check, not an identity check.');

  // ---------------------------------------------------------------- 3
  heading('Selective disclosure — 4 of 14 attributes');
  console.log(`    Proof verifies against on-chain root: ${verifyProofBundle(ewa.proof!)}\n`);
  for (const a of ewa.proof!.attributes) {
    console.log(
      `    ${a.name.padEnd(20)} ${a.canonical.padEnd(16)} path = ${a.path.length} steps  ✓`,
    );
  }
  const serialised = JSON.stringify(ewa.proof);
  console.log('\n    What EWA cannot recover from that bundle:');
  for (const w of ['Machine Operator', 'Salary disbursement', '1994-02-17', '486ea46224d1bb4f']) {
    console.log(`      ${JSON.stringify(w).padEnd(26)} present: ${serialised.includes(w)}`);
  }

  // ---------------------------------------------------------------- 4
  heading('Same customer requests SBL — step-up, not re-onboarding');
  const sblBefore = await h.svc.verify(h.lending(), CNIC_WALLET, 'SBL', null);
  kv('decision', `${sblBefore.decision.outcome} — ${sblBefore.decision.reason}`);
  kv('missing methods', sblBefore.decision.missingMethods.join(', '));

  const railsBefore = h.rails.metrics.callsMade;
  const up = await h.svc.stepUp(h.lending(), CNIC_WALLET, 'SBL', a3Attributes(), CNIC_EXPIRY_OK, 'SBL step-up');
  kv('methods actually run', up.methodsRun.join(', '));
  kv('rail calls made', h.rails.metrics.callsMade - railsBefore);
  kv('new assurance', up.assuranceLevel);
  kv('new version', up.version);
  console.log('\n    Today this customer repeats the entire onboarding pack.');
  console.log('    Here: one selfie.');

  // ---------------------------------------------------------------- 5
  heading('CNIC renewal — propagation without integration');
  await h.svc.stepUp(h.bank(), CNIC_WALLET, 'EWA', a3Attributes(), '2036-09-01T00:00:00Z', 'CNIC renewal');
  const chain = await h.svc.versionChain(h.bank(), CNIC_WALLET);
  kv('versions', chain.versionCount);
  kv('chain valid', chain.chainValid);
  for (const v of chain.versions) {
    console.log(
      `      v${v.version}  ${v.status.padEnd(11)} ${v.assuranceLevel}  ` +
        `prevHash: ${v.previousVersionHash ? `${v.previousVersionHash.slice(0, 16)}…` : 'null'}`,
    );
  }
  console.log('\n    Every product resolves to the newest version on its next call.');
  console.log('    No batch job. No per-product migration.');

  // ---------------------------------------------------------------- 6
  heading('Compliance suspends — one action, every product');
  await h.svc.suspend(h.compliance(), CNIC_WALLET, 'AML alert', 'CASE-2026-114');
  for (const p of ['EWA', 'ASA', 'SBL', 'MERCHANT_FINANCING']) {
    const v = await h.svc.verify(h.lending(), CNIC_WALLET, p, null);
    console.log(`      ${p.padEnd(20)} ${v.decision.outcome} — ${v.decision.reason}`);
  }
  try {
    await h.svc.suspend(h.lending(), CNIC_WALLET, 'attempt from a product org', 'X');
    console.log('\n    ✗ UNEXPECTED: a product organization was able to suspend');
  } catch (e) {
    const code = e instanceof KycError ? e.code : 'unknown';
    console.log(`\n    A product organization attempting the same call: ${code}`);
  }
  await h.svc.reinstate(h.compliance(), CNIC_WALLET, 'investigation closed', 'CASE-2026-114');

  // ---------------------------------------------------------------- 7
  heading('Auditor view — tamper detection');
  kv('chain valid before', (await h.svc.versionChain(h.bank(), CNIC_WALLET)).chainValid);

  const subjectId = await h.svc.subjectId(CNIC_WALLET);
  const key = `KYC~${subjectId}~0000000001`;
  const raw = JSON.parse((await h.store.get(key))!);
  h.store.tamper(key, JSON.stringify({ ...raw, assuranceLevel: 'A3' }));
  console.log('\n    [simulating a privileged operator editing state directly]\n');

  const tampered = await h.svc.versionChain(h.bank(), CNIC_WALLET);
  kv('chain valid after', tampered.chainValid);
  kv('broken at version', tampered.brokenAt);
  console.log('\n    Any edit breaks the hash chain. This is a P1 security incident,');
  console.log('    not a data-quality ticket.');

  // ---------------------------------------------------------------- 8
  heading('Employer uploads 1,000 employees');
  const h2 = harness();
  await h2.svc.register(h2.bank(), {
    cnic: CNIC_WALLET,
    attributes: a2Attributes(),
    originProduct: 'WALLET',
    cnicExpiryAt: CNIC_EXPIRY_OK,
  });
  await h2.svc.register(h2.bank(), {
    cnic: CNIC_EMPLOYER,
    attributes: a0Attributes(),
    originProduct: 'EMPLOYER',
    cnicExpiryAt: CNIC_EXPIRY_OK,
  });

  const upload = Array.from({ length: 1000 }, (_, i) => String(3520200000000 + i));
  upload[10] = '6110112345678'; // the wallet customer, dashes stripped by the CSV
  upload[20] = CNIC_EMPLOYER;

  const t0 = performance.now();
  const split = await h2.svc.employerBulkLookup(h2.bank(), upload);
  const ms = performance.now() - t0;

  kv('uploaded', split.total);
  kv('activate now', split.activateNow.length);
  kv('needs onboarding', split.needsOnboarding.length);
  kv('invalid rows', split.invalid.length);
  kv('elapsed', `${ms.toFixed(0)} ms`);
  console.log('\n    Note the CSV strips dashes while the app captures them.');
  console.log('    Shared normalisation is what makes both resolve to one subject.');

  // ---------------------------------------------------------------- 9
  heading('Crypto-shredding — erasure without losing the audit fact');
  const h3 = harness();
  await h3.svc.register(h3.bank(), {
    cnic: CNIC_FRESH,
    attributes: a2Attributes(),
    originProduct: 'WALLET',
    cnicExpiryAt: CNIC_EXPIRY_OK,
  });
  const rootBefore = (await h3.svc.versionChain(h3.bank(), CNIC_FRESH)).versions[0]!.merkleRoot;
  const shred = await h3.svc.shred(h3.compliance(), CNIC_FRESH, 'customer erasure request', 'PDPB right to erasure');
  const after = (await h3.svc.versionChain(h3.bank(), CNIC_FRESH)).versions[0]!;

  kv('vault destroyed', shred.vaultDestroyed);
  kv('vault rows remaining', await h3.vaultStore.count());
  kv('status', after.status);
  kv('merkle root unchanged', after.merkleRoot === rootBefore);
  kv('vault pointer', after.vaultRef === '' ? '(cleared)' : after.vaultRef);
  const auditTrail = await h3.svc.auditTrail(h3.bank(), CNIC_FRESH);
  kv('audit events retained', auditTrail.map((e) => e.action).join(', '));
  console.log('\n    32 bytes whose preimage no longer exists anywhere.');

  // ---------------------------------------------------------------- summary
  console.log(`\n${line('═')}`);
  console.log('  MEASURED THIS SESSION');
  console.log(line('═'));
  const m = h.svc.metrics;
  const total = m.rails.callsMade + m.rails.callsAvoided;
  kv('rail calls made', m.rails.callsMade);
  kv('rail calls avoided', m.rails.callsAvoided);
  kv('cost incurred', PKR(m.rails.costSpentPkr));
  kv('cost avoided', PKR(m.rails.costAvoidedPkr));
  kv('reuse rate (observed)', total === 0 ? 'n/a' : `${((m.rails.callsAvoided / total) * 100).toFixed(1)}%`);
  kv('e-CIB calls', `${m.ecibCalls}  (never avoided, by design)`);
  kv('biometric lockouts', m.rails.capLockouts);

  console.log(`\n${line()}`);
  console.log('  The reuse rate above is from this demo, not from ABHI traffic.');
  console.log('  The real number — [OPEN-3] — comes from the Sprint 0 duplication');
  console.log('  analysis over historical verification logs. That number, not this');
  console.log('  one, decides whether the production programme is worth funding.');
  console.log(`${line()}\n`);
}

main().catch((e: unknown) => {
  console.error('demo failed:', e);
  process.exitCode = 1;
});
