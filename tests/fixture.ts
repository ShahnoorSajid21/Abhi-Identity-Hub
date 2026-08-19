// FICTIONAL-CNIC-OK: fictional CNICs shared by every test suite. Never real customer data.
import { MemoryStateStore, memoryContext, type TxContext } from '@abhi/kyc-registry';
import { DEMO_ATTRIBUTE_VALUES } from '@abhi/merkle';
import { SimulatedLedger } from '../services/gateway/src/ledger.ts';
import { SoftwareHsm } from '../services/gateway/src/hsm.ts';
import { Vault, MemoryVaultStore } from '../services/gateway/src/vault.ts';
import { MockRails, MockECib } from '../services/gateway/src/rails.ts';
import { KycGatewayService } from '../services/gateway/src/service.ts';

export interface Harness {
  svc: KycGatewayService;
  store: MemoryStateStore;
  ledger: SimulatedLedger;
  vault: Vault;
  vaultStore: MemoryVaultStore;
  rails: MockRails;
  ecib: MockECib;
  hsm: SoftwareHsm;
  bank: (o?: Parameters<typeof memoryContext>[0]) => TxContext;
  lending: (o?: Parameters<typeof memoryContext>[0]) => TxContext;
  compliance: (o?: Parameters<typeof memoryContext>[0]) => TxContext;
}

export const NOW = new Date('2026-08-17T10:00:00Z');
export const CNIC_WALLET = '61101-1234567-8';
export const CNIC_FRESH = '42201-7654321-1';
export const CNIC_EMPLOYER = '35202-1122334-5';

export function harness(): Harness {
  const store = new MemoryStateStore();
  const ledger = new SimulatedLedger(store);
  const hsm = SoftwareHsm.fromSeeds('ABHI-KYC-DEMO-PEPPER-v1', 'ABHI-KYC-DEMO-KEK-v1', 1);
  const vaultStore = new MemoryVaultStore();
  const vault = new Vault(vaultStore, hsm);
  const rails = new MockRails();
  const ecib = new MockECib();

  const svc = new KycGatewayService({ ledger, vault, hsm, rails, ecib });

  return {
    svc,
    store,
    ledger,
    vault,
    vaultStore,
    rails,
    ecib,
    hsm,
    bank: (o = {}) => memoryContext({ mspId: 'ABHIBankMSP', role: 'gateway', timestamp: NOW, ...o }),
    lending: (o = {}) =>
      memoryContext({ mspId: 'ABHILendingMSP', role: 'gateway', timestamp: NOW, ...o }),
    compliance: (o = {}) =>
      memoryContext({ mspId: 'ABHIComplianceMSP', role: 'compliance-officer', timestamp: NOW, ...o }),
  };
}

/** Attribute payload for a completed Asaan Digital Account journey (A2). */
export function a2Attributes(): Record<string, string | boolean | number> {
  return { ...DEMO_ATTRIBUTE_VALUES, liveness_pass: false };
}

/** Attribute payload including a passed liveness check (A3). */
export function a3Attributes(): Record<string, string | boolean | number> {
  return { ...DEMO_ATTRIBUTE_VALUES, liveness_pass: true };
}

/** Employer-asserted record: a CNIC and nothing else. */
export function a0Attributes(): Record<string, string | boolean | number> {
  return {
    cnic_number_hash: 'aa11bb22cc33dd44',
    full_name_hash: 'ee55ff66aa77bb88',
    verisys_match: false,
    document_authenticity_pass: false,
    biometric_match: false,
    liveness_pass: false,
  };
}

export const CNIC_EXPIRY_OK = '2031-04-11T00:00:00Z';
export const CNIC_EXPIRY_PAST = '2025-01-01T00:00:00Z';
