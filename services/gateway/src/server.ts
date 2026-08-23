/**
 * Gateway entry point.
 *
 *   npm run gateway:dev
 *
 * Boots in simulator mode with mocked rails and a software HSM. Every one of
 * those components refuses to initialise when NODE_ENV=production, so this
 * entry point cannot accidentally become a production deployment.
 */
import { MemoryStateStore } from '@abhi/kyc-registry';
import { SimulatedLedger } from './ledger.ts';
import { SoftwareHsm } from './hsm.ts';
import { Vault, MemoryVaultStore } from './vault.ts';
import { MockRails, MockECib } from './rails.ts';
import { KycGatewayService } from './service.ts';
import { createGateway, recordPresentation } from './http.ts';
import { logInfo } from './logging.ts';
import { seedCohort, seedActivity, sampleEmployerList, MAX_SAMPLE_LIST } from './seed-cohort.ts';
import { EmploymentRegister, DEMO_EMPLOYER_ID } from './security.ts';
import { normaliseCnic } from '@abhi/merkle';
import { MockCbs } from './cbs.ts';
import { PresentationStore } from './presentation.ts';

const PORT = Number(process.env['PORT'] ?? 8080);

function assertNotProduction(): void {
  if (process.env['NODE_ENV'] === 'production') {
    console.error(
      [
        'FATAL: this entry point runs the POC configuration:',
        '  - SimulatedLedger  (no endorsement, no ordering, no independent peers)',
        '  - SoftwareHsm      (pepper and KEK in process memory)',
        '  - MockRails        (no real NADRA / e-CIB)',
        '  - header identity  (no mTLS, no client-certificate binding)',
        '',
        'Production requires the Fabric adapter, a PKCS#11 HSM, real rail',
        'contracts and mTLS. See docs/PRODUCTION_READINESS.md.',
      ].join('\n'),
    );
    process.exit(1);
  }
}

assertNotProduction();

const store = new MemoryStateStore();
const ledger = new SimulatedLedger(store);
const hsm = SoftwareHsm.fromSeeds('ABHI-KYC-DEMO-PEPPER-v1', 'ABHI-KYC-DEMO-KEK-v1', 1);
const vault = new Vault(new MemoryVaultStore(), hsm);
const rails = new MockRails();
const ecib = new MockECib();

/**
 * The SEC-05 roster gate, wired and populated.
 *
 * The bulk lookup answers "is this CNIC already verified at ABHI?", which is
 * only ABHI's to answer for people the asking employer actually employs.
 * Without this register the endpoint enumerates the customer base one upload
 * at a time — and until now the bootstrap did not construct one, so the
 * shipped gateway ran with the gate absent.
 *
 * Seeded with the sample file the console offers, under the same employer id
 * the dev header identity presents, so the demo exercises the control instead
 * of routing around it. Upload a CNIC outside the roster and it comes back
 * `NOT_EMPLOYED` — never looked up, so the answer carries no information about
 * whether that person banks with ABHI.
 */
const employment = new EmploymentRegister();
for (const cnic of sampleEmployerList(new Date(), MAX_SAMPLE_LIST)) {
  employment.assert(DEMO_EMPLOYER_ID, normaliseCnic(cnic));
}

const service = new KycGatewayService({ ledger, vault, hsm, rails, ecib, employment });

// One core banking instance, shared: the seeder tells it each customer's
// masked CNIC, and the read endpoints hand that same mask to the screens.
const cbs = new MockCbs();
const presentation = new PresentationStore();

const server = createGateway({ service, cbs, presentation });

/**
 * Seed the synthetic customer base before accepting traffic.
 *
 * State is in memory, so a restart is the reset — `make reset` in the plan,
 * `npm run gateway:dev` here. The cohort is deterministic, so restarting twice
 * produces byte-identical figures, which is what stops the rehearsal and the
 * performance disagreeing.
 *
 * The rail metrics are zeroed afterwards on purpose. These are HISTORICAL
 * verifications — they happened over the past two years, not this morning —
 * and leaving their cost in the counter would make "verification spend today"
 * false on the first screen anybody sees.
 *
 * Set SEED_COHORT=0 to boot empty.
 */
const COHORT_SIZE = Number(process.env['SEED_COHORT'] ?? '1204');
/** Inbound product requests to seed, so the queue is not empty on arrival. */
const ACTIVITY_SIZE = Number(process.env['SEED_ACTIVITY'] ?? '64');

async function seed(): Promise<void> {
  if (COHORT_SIZE <= 0) return;
  const started = performance.now();
  const now = new Date();
  const result = await seedCohort(service, now, (m) => logInfo('seed', { message: m }), cbs);

  // Zero the counters BEFORE seeding today's requests: the cohort's own
  // verifications happened over the past two years, today's did not.
  rails.reset();

  const requests = await seedActivity(service, now, ACTIVITY_SIZE, async (input) => {
    await recordPresentation(
      { service, presentation },
      input.path,
      { mspId: input.mspId, role: input.role, subjectDn: 'CN=seed', source: 'header', employerId: null },
      input.tx,
      input.body,
      input.result,
    );
  });
  logInfo('activity seeded', { requests });
  logInfo('cohort seeded', {
    ...result.byLevel,
    registered: result.registered,
    frozen: result.frozen,
    ms: Math.round(performance.now() - started),
    note: 'historical verifications; rail counters reset to zero',
  });
}

await seed();

server.listen(PORT, () => {
  logInfo('gateway listening', {
    port: PORT,
    ledgerMode: ledger.mode,
    hsm: hsm.kind,
    rails: 'mocked',
    warning: 'POC CONFIGURATION — not production',
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logInfo('shutting down', { signal });
    server.close(() => process.exit(0));
  });
}
