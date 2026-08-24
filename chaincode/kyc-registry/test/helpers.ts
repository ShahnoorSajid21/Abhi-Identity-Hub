import { canonicalJSON } from '@abhi/canonical';
import { demoAttributes, merkleRootHex, ATTRIBUTE_SET_ID, ATTRIBUTE_NAMES } from '@abhi/merkle';
import type { AssuranceLevel, VerificationMethod, KYCRecord } from '@abhi/types';
import { MemoryStateStore, memoryContext } from '../src/memory-state.ts';
import { registerKYC, type RegisterKYCInput } from '../src/registry.ts';
import { KEY } from '../src/state.ts';

export const SUBJECT_A = 'a'.repeat(64);
export const SUBJECT_B = 'b'.repeat(64);
export const VAULT_REF = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
export const VAULT_REF_2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

export const METHODS: Record<AssuranceLevel, VerificationMethod[]> = {
  A0: ['ASSERTED'],
  A1: ['DOC_AUTH', 'VERISYS'],
  A2: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'VERISYS'],
  A3: ['BIOMETRIC_1TO1', 'DOC_AUTH', 'LIVENESS', 'VERISYS'],
};

export const KNOWN_ATTRIBUTES = [...ATTRIBUTE_NAMES];

export function demoRoot(): string {
  return merkleRootHex(demoAttributes());
}

export function registerInput(over: Partial<RegisterKYCInput> = {}): RegisterKYCInput {
  const level = over.assuranceLevel ?? 'A2';
  return {
    subjectId: SUBJECT_A,
    merkleRoot: demoRoot(),
    attributeSetId: ATTRIBUTE_SET_ID,
    assuranceLevel: level,
    methods: METHODS[level],
    expiresAt: '2027-08-17T10:00:00Z',
    cnicExpiryAt: '2031-04-11T00:00:00Z',
    vaultRef: VAULT_REF,
    pepperEpoch: 1,
    originProduct: 'WALLET',
    ...over,
  };
}

/** A fresh store with one registered A2 subject. */
export async function storeWithSubject(
  over: Partial<RegisterKYCInput> = {},
): Promise<{ store: MemoryStateStore; ctx: ReturnType<typeof memoryContext> }> {
  const store = new MemoryStateStore();
  const ctx = memoryContext();
  await registerKYC(store, ctx, registerInput(over));
  return { store, ctx };
}

export const compliance = (over: Parameters<typeof memoryContext>[0] = {}) =>
  memoryContext({ mspId: 'ABHIComplianceMSP', role: 'compliance-officer', ...over });

export const lending = (over: Parameters<typeof memoryContext>[0] = {}) =>
  memoryContext({ mspId: 'ABHILendingMSP', role: 'gateway', ...over });

export const bank = (over: Parameters<typeof memoryContext>[0] = {}) =>
  memoryContext({ mspId: 'ABHIBankMSP', role: 'gateway', ...over });

/** Read a stored record straight out of state. */
export async function readRecord(
  store: MemoryStateStore,
  subjectId: string,
  version: number,
): Promise<KYCRecord> {
  const raw = await store.get(KEY.kycRecord(subjectId, version));
  if (raw === null) throw new Error(`no record v${version}`);
  return JSON.parse(raw) as KYCRecord;
}

/** Simulate a malicious DBA editing state directly, bypassing chaincode. */
export async function tamperRecord(
  store: MemoryStateStore,
  subjectId: string,
  version: number,
  mutate: (r: KYCRecord) => KYCRecord,
): Promise<void> {
  const record = await readRecord(store, subjectId, version);
  store.tamper(KEY.kycRecord(subjectId, version), canonicalJSON(mutate(record)));
}