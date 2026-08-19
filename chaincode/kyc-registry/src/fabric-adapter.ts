/**
 * Fabric adapter — StateStore and TxContext over Hyperledger Fabric.
 *
 * REQUIRES: npm i fabric-contract-api fabric-shim
 * (deliberately not in the root package.json: the POC runs with zero runtime
 * dependencies, and adding a native-ish dep would break that property for
 * everyone who only wants to run the simulator.)
 *
 * This file is the ONLY place Fabric-specific concerns appear. All business
 * logic lives in registry.ts against the ports below, which is what allowed
 * 47 chaincode tests to exist before a network did.
 */
import type { Context } from 'fabric-contract-api';
import type { StateStore, TxContext } from './state.ts';

/**
 * StateStore backed by Fabric's ChaincodeStub.
 *
 * Note on getRange: Fabric's GetStateByRange is [start, end) — inclusive
 * start, exclusive end — which matches the StateStore contract exactly, so the
 * key builders in state.ts need no translation.
 */
export class FabricStateStore implements StateStore {
  readonly #ctx: Context;

  constructor(ctx: Context) {
    this.#ctx = ctx;
  }

  async get(key: string): Promise<string | null> {
    const bytes = await this.#ctx.stub.getState(key);
    if (bytes === undefined || bytes.length === 0) return null;
    return Buffer.from(bytes).toString('utf8');
  }

  async put(key: string, value: string): Promise<void> {
    await this.#ctx.stub.putState(key, Buffer.from(value, 'utf8'));
  }

  async delete(key: string): Promise<void> {
    // Deliberately NOT used by any chaincode function. Deletion would destroy
    // the evidence that a record existed; erasure goes through MarkShredded
    // plus vault crypto-shredding instead. Present only to satisfy the port.
    await this.#ctx.stub.deleteState(key);
  }

  async getRange(startKey: string, endKey: string): Promise<{ key: string; value: string }[]> {
    const out: { key: string; value: string }[] = [];
    const iterator = this.#ctx.stub.getStateByRange(startKey, endKey);
    for await (const res of iterator) {
      out.push({
        key: res.key,
        value: Buffer.from(res.value).toString('utf8'),
      });
    }
    // Fabric returns range results in key order already; sorting is belt and
    // braces, and cheap relative to the I/O that produced them.
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  }
}

/**
 * TxContext over Fabric.
 *
 * Every field here is derived from the transaction or the caller's validated
 * certificate. Nothing is taken from the request payload — a gateway with a
 * manipulated clock or a forged MSP claim must not be able to influence any of
 * these values.
 */
export function fabricContext(ctx: Context): TxContext {
  // Per-transaction ordinal. Chaincode is instantiated per invocation in
  // Fabric's execution model, but binding the counter to this closure makes
  // determinism explicit rather than incidental (SEC-11).
  let ordinal = 0;

  const ts = ctx.stub.getTxTimestamp();
  // Fabric returns seconds + nanos; milliseconds is the resolution we commit to.
  const millis = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);

  return {
    mspId: ctx.clientIdentity.getMSPID(),
    role: ctx.clientIdentity.getAttributeValue('kyc.role'),
    txId: ctx.stub.getTxID(),
    timestamp: new Date(millis),
    setEvent(name: string, payload: unknown): void {
      ctx.stub.setEvent(name, Buffer.from(JSON.stringify(payload), 'utf8'));
    },
    nextOrdinal(): number {
      ordinal += 1;
      return ordinal;
    },
  };
}
