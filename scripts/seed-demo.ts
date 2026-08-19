/**
 * Seed the demo dataset.
 *
 *   npm run demo:seed
 *
 * Six personas that between them exercise every decision path. Writes a
 * summary to stdout and, when the gateway is running, seeds it over HTTP so
 * the console has data immediately.
 *
 * A demo that cannot be reset in 90 seconds will be demoed once.
 */
import { harness, a0Attributes, a2Attributes, a3Attributes, CNIC_EXPIRY_OK, CNIC_EXPIRY_PAST } from '../tests/fixture.ts';

export interface Persona {
  label: string;
  cnic: string;
  attributes: Record<string, string | boolean | number>;
  cnicExpiryAt: string;
  originProduct: string;
  suspend?: { reason: string; ref: string };
  demonstrates: string;
}

export const PERSONAS: Persona[] = [
  {
    label: 'Fresh customer',
    cnic: '42101-9988776-3',
    attributes: a2Attributes(),
    cnicExpiryAt: CNIC_EXPIRY_OK,
    originProduct: 'WALLET',
    demonstrates: 'FULL_KYC — nothing on the ledger yet (seeded only as a control)',
  },
  {
    label: 'Wallet customer, A2, 71 days old',
    cnic: '61101-1234567-8',
    attributes: a2Attributes(),
    cnicExpiryAt: CNIC_EXPIRY_OK,
    originProduct: 'WALLET',
    demonstrates: 'ALLOW for EWA with ZERO rail calls — the headline',
  },
  {
    label: 'A2 customer wanting SBL',
    cnic: '35202-4455667-9',
    attributes: a2Attributes(),
    cnicExpiryAt: CNIC_EXPIRY_OK,
    originProduct: 'WALLET',
    demonstrates: 'STEP_UP naming LIVENESS only — one selfie, not the full pack',
  },
  {
    label: 'Employer-asserted, A0',
    cnic: '35202-1122334-5',
    attributes: a0Attributes(),
    cnicExpiryAt: CNIC_EXPIRY_OK,
    originProduct: 'EMPLOYER',
    demonstrates: 'A0 grants nothing — no product accepts it',
  },
  {
    label: 'Expired CNIC',
    cnic: '17301-5566778-2',
    attributes: a3Attributes(),
    cnicExpiryAt: CNIC_EXPIRY_PAST,
    originProduct: 'WALLET',
    demonstrates: 'Hard DENY — no amount of re-scanning fixes an expired document',
  },
  {
    label: 'Suspended by Compliance',
    cnic: '42201-7654321-1',
    attributes: a3Attributes(),
    cnicExpiryAt: CNIC_EXPIRY_OK,
    originProduct: 'WALLET',
    suspend: { reason: 'AML alert', ref: 'CASE-2026-114' },
    demonstrates: 'DENY — suspension outranks every other consideration',
  },
];

const API = process.env['GATEWAY_URL'] ?? 'http://localhost:8080';

async function seedOverHttp(): Promise<boolean> {
  try {
    const health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1500) });
    if (!health.ok) return false;
  } catch {
    return false;
  }

  const post = async (path: string, body: unknown, who: 'bank' | 'compliance' = 'bank') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'compliance') {
      headers['x-abhi-msp'] = 'ABHIComplianceMSP';
      headers['x-abhi-role'] = 'compliance-officer';
    } else {
      headers['x-abhi-msp'] = 'ABHIBankMSP';
      headers['x-abhi-role'] = 'gateway';
    }
    const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  console.log(`Seeding live gateway at ${API}\n`);

  for (const p of PERSONAS.slice(1)) {
    const r = await post('/kyc/register', {
      cnic: p.cnic,
      attributes: p.attributes,
      originProduct: p.originProduct,
      cnicExpiryAt: p.cnicExpiryAt,
    });

    const level = r.json['assuranceLevel'] ?? r.json['error'];
    console.log(`  ${p.label.padEnd(34)} ${String(level).padEnd(6)} ${p.cnic}`);

    if (p.suspend !== undefined && r.status === 201) {
      await post(
        '/kyc/suspend',
        { cnic: p.cnic, reason: p.suspend.reason, referenceId: p.suspend.ref },
        'compliance',
      );
      console.log(`  ${''.padEnd(34)} → suspended (${p.suspend.ref})`);
    }
  }

  // A consent for the headline persona so the console can show a proof.
  const consent = await post('/consent/create', {
    cnic: PERSONAS[1]!.cnic,
    grantedTo: 'ABHILendingMSP',
    purpose: 'EWA_ORIGINATION',
    scope: ['verisys_match', 'biometric_match', 'cnic_expiry', 'fatca_status'],
    expiresAt: '2027-01-01T00:00:00Z',
    evidenceRef: 'tc-accept-seed-001',
  });
  console.log(`\n  consent for EWA: ${String(consent.json['consentId'] ?? consent.json['error'])}`);
  return true;
}

async function seedInProcess(): Promise<void> {
  console.log('Gateway not reachable — seeding an in-process ledger instead.\n');
  const h = harness();

  for (const p of PERSONAS.slice(1)) {
    const r = await h.svc.register(h.bank(), {
      cnic: p.cnic,
      attributes: p.attributes,
      originProduct: p.originProduct,
      cnicExpiryAt: p.cnicExpiryAt,
    });
    console.log(`  ${p.label.padEnd(34)} ${r.assuranceLevel.padEnd(6)} v${r.version}`);
    if (p.suspend !== undefined) {
      await h.svc.suspend(h.compliance(), p.cnic, p.suspend.reason, p.suspend.ref);
      console.log(`  ${''.padEnd(34)} → suspended`);
    }
  }

  console.log('\n  Decision matrix:');
  for (const p of PERSONAS) {
    for (const product of ['EWA', 'SBL']) {
      const v = await h.svc.verify(h.lending(), p.cnic, product, null);
      console.log(
        `    ${p.label.padEnd(34)} ${product.padEnd(4)} ` +
          `${v.decision.outcome.padEnd(9)} ${v.decision.reason}` +
          (v.decision.missingMethods.length > 0 ? ` (${v.decision.missingMethods.join(',')})` : ''),
      );
    }
  }
}

async function main(): Promise<void> {
  console.log('\nABHI Unified KYC Ledger — demo seed');
  console.log('='.repeat(66));

  const seeded = await seedOverHttp();
  if (!seeded) await seedInProcess();

  console.log(`\n${'='.repeat(66)}`);
  console.log('Personas and what each demonstrates:\n');
  for (const p of PERSONAS) {
    console.log(`  ${p.label}`);
    console.log(`    ${p.cnic}  ·  ${p.demonstrates}\n`);
  }
  console.log('Next:  npm run gateway:dev   then open apps/console/index.html');
}

main().catch((e: unknown) => {
  console.error('seed failed:', e);
  process.exitCode = 1;
});
