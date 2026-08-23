// FICTIONAL-CNIC-OK: fictional CNICs for the employment register and rate-limit tests. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { KycError } from '@abhi/types';
import { createGateway } from '../../services/gateway/src/http.ts';
import {
  RateLimiter,
  IdempotencyStore,
  NonceCache,
  EmploymentRegister,
  signRequest,
  verifySignature,
  bodyHash,
  canonicalSigningString,
  identityFromHeaders,
  DEFAULT_RATE_RULES,
} from '../../services/gateway/src/security.ts';
import { harness, a2Attributes, CNIC_WALLET, CNIC_FRESH, CNIC_EXPIRY_OK } from '../fixture.ts';

// ===========================================================================
describe('SEC-06 · rate limiting', () => {
  test('blocks once the window allowance is exhausted', () => {
    const rl = new RateLimiter({ test: { windowMs: 1000, max: 3 } });
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) rl.check('test', 'k', now);
    assert.throws(
      () => rl.check('test', 'k', now),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_ATTEMPT_CAP_EXCEEDED',
    );
  });

  test('the window slides — allowance returns', () => {
    const rl = new RateLimiter({ test: { windowMs: 1000, max: 2 } });
    rl.check('test', 'k', 1000);
    rl.check('test', 'k', 1500);
    assert.throws(() => rl.check('test', 'k', 1600), KycError);
    assert.doesNotThrow(() => rl.check('test', 'k', 2600));
  });

  test('keys are isolated per dimension and per value', () => {
    const rl = new RateLimiter({ a: { windowMs: 1000, max: 1 }, b: { windowMs: 1000, max: 1 } });
    rl.check('a', 'x', 100);
    assert.doesNotThrow(() => rl.check('a', 'y', 100));
    assert.doesNotThrow(() => rl.check('b', 'x', 100));
    assert.throws(() => rl.check('a', 'x', 100), KycError);
  });

  test('unknown dimensions are unlimited rather than failing closed', () => {
    const rl = new RateLimiter({});
    assert.equal(rl.check('nope', 'k'), Number.POSITIVE_INFINITY);
  });

  test('the subject dimension is the enumeration control and is tight', () => {
    assert.ok(DEFAULT_RATE_RULES['subject']!.max <= 30);
    assert.ok(DEFAULT_RATE_RULES['employerBulk']!.max <= 10);
  });

  test('sweep releases memory for expired keys', () => {
    const rl = new RateLimiter({ test: { windowMs: 100, max: 5 } });
    rl.check('test', 'k', 1000);
    rl.sweep(10_000);
    assert.doesNotThrow(() => rl.check('test', 'k', 10_000));
  });
});

// ===========================================================================
describe('SEC-06 · idempotency', () => {
  test('an identical replay returns the stored response', () => {
    const store = new IdempotencyStore();
    const h = IdempotencyStore.hashRequest('POST', '/kyc/register', { cnic: 'x' });
    assert.equal(store.lookup('key-1', h), null);
    store.store('key-1', h, 201, { version: 1 });
    assert.deepEqual(store.lookup('key-1', h), { status: 201, body: { version: 1 } });
  });

  test('the SAME key with a DIFFERENT body is a conflict, not a cache hit', () => {
    const store = new IdempotencyStore();
    const h1 = IdempotencyStore.hashRequest('POST', '/kyc/register', { cnic: 'a' });
    const h2 = IdempotencyStore.hashRequest('POST', '/kyc/register', { cnic: 'b' });
    store.store('key-1', h1, 201, {});
    assert.throws(
      () => store.lookup('key-1', h2),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_VERSION_CONFLICT',
    );
  });

  test('entries expire', () => {
    const store = new IdempotencyStore(1000);
    const h = IdempotencyStore.hashRequest('POST', '/p', {});
    store.store('k', h, 200, {}, 1000);
    assert.notEqual(store.lookup('k', h, 1500), null);
    assert.equal(store.lookup('k', h, 5000), null);
  });
});

// ===========================================================================
describe('SEC-06 · replay defence', () => {
  test('a reused nonce is rejected', () => {
    const cache = new NonceCache(60_000);
    const now = Date.parse('2026-08-17T10:00:00Z');
    const ts = '2026-08-17T10:00:00Z';
    cache.assertFresh('n1', ts, now);
    assert.throws(
      () => cache.assertFresh('n1', ts, now),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_VERSION_CONFLICT',
    );
  });

  test('a timestamp outside the skew window is rejected in both directions', () => {
    const cache = new NonceCache(60_000);
    const now = Date.parse('2026-08-17T10:00:00Z');
    assert.throws(() => cache.assertFresh('a', '2026-08-17T09:00:00Z', now), KycError);
    assert.throws(() => cache.assertFresh('b', '2026-08-17T11:00:00Z', now), KycError);
  });

  test('a malformed timestamp is rejected', () => {
    assert.throws(() => new NonceCache().assertFresh('n', 'not-a-date'), KycError);
  });
});

// ===========================================================================
describe('SEC-06 · request signing', () => {
  const secret = Buffer.from('a'.repeat(64), 'hex');
  const parts = {
    method: 'POST',
    path: '/kyc/verify',
    bodyHash: bodyHash({ cnic: '61101-1234567-8' }),
    timestamp: '2026-08-17T10:00:00Z',
    nonce: 'n-1',
  };

  test('a valid signature verifies', () => {
    assert.equal(verifySignature(secret, parts, signRequest(secret, parts)), true);
  });

  test('any tampered component invalidates the signature', () => {
    const sig = signRequest(secret, parts);
    for (const mutated of [
      { ...parts, method: 'GET' },
      { ...parts, path: '/kyc/suspend' },
      { ...parts, bodyHash: bodyHash({ cnic: 'other' }) },
      { ...parts, timestamp: '2026-08-17T10:00:01Z' },
      { ...parts, nonce: 'n-2' },
    ]) {
      assert.equal(verifySignature(secret, mutated, sig), false);
    }
  });

  test('a wrong key fails', () => {
    const other = Buffer.from('b'.repeat(64), 'hex');
    assert.equal(verifySignature(other, parts, signRequest(secret, parts)), false);
  });

  test('malformed signatures fail closed rather than throwing', () => {
    assert.equal(verifySignature(secret, parts, 'zz'), false);
    assert.equal(verifySignature(secret, parts, ''), false);
  });

  test('the canonical string binds every component in a fixed order', () => {
    assert.equal(
      canonicalSigningString(parts),
      `POST\n/kyc/verify\n${parts.bodyHash}\n2026-08-17T10:00:00Z\nn-1`,
    );
  });
});

// ===========================================================================
describe('SEC-02 · identity', () => {
  test('header identity throws in production', () => {
    const prev = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      assert.throws(
        () => identityFromHeaders({ headers: {} } as never),
        /not permitted in production/,
      );
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prev;
    }
  });

  test('header identity works outside production and reports its source', () => {
    const id = identityFromHeaders({
      headers: { 'x-abhi-msp': 'ABHILendingMSP', 'x-abhi-role': 'gateway' },
    } as never);
    assert.equal(id.mspId, 'ABHILendingMSP');
    assert.equal(id.source, 'header');
  });
});

// ===========================================================================
describe('SEC-05 · employer relationship gating', () => {
  test('CNICs outside the roster are reported as unauthorised, not as unknown', () => {
    const reg = new EmploymentRegister();
    reg.assert('EMP-1', '6110112345678');

    const split = reg.partition('EMP-1', [
      { raw: '61101-1234567-8', normalised: '6110112345678' },
      { raw: '4220176543211', normalised: '4220176543211' },
      { raw: 'garbage', normalised: null },
    ]);

    assert.deepEqual(split.permitted, ['61101-1234567-8']);
    assert.deepEqual(split.unauthorised, ['4220176543211', 'garbage']);
  });

  test('revocation removes access', () => {
    const reg = new EmploymentRegister();
    reg.assert('EMP-1', '6110112345678');
    assert.equal(reg.has('EMP-1', '6110112345678'), true);
    reg.revoke('EMP-1', '6110112345678');
    assert.equal(reg.has('EMP-1', '6110112345678'), false);
  });

  test('employers are isolated from one another', () => {
    const reg = new EmploymentRegister();
    reg.assert('EMP-1', '6110112345678');
    assert.equal(reg.has('EMP-2', '6110112345678'), false);
  });

  test('the gateway never looks up an unauthorised CNIC', async () => {
    const employment = new EmploymentRegister();
    employment.assert('EMP-1', '6110112345678');

    const h = harness();
    const svc = new (Object.getPrototypeOf(h.svc).constructor as typeof import('../../services/gateway/src/service.ts').KycGatewayService)(
      {
        ledger: h.ledger,
        vault: h.vault,
        hsm: h.hsm,
        rails: h.rails,
        ecib: h.ecib,
        employment,
      },
    );

    await svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });
    await svc.register(h.bank(), {
      cnic: CNIC_FRESH,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const r = await svc.employerBulkLookup(h.bank(), [CNIC_WALLET, CNIC_FRESH], 'EMPLOYER_BULK', 'EMP-1');

    assert.deepEqual(r.activateNow, [CNIC_WALLET]);
    // CNIC_FRESH exists and is A2, but this employer does not employ them —
    // the response must not reveal that.
    assert.deepEqual(r.unauthorised, [CNIC_FRESH]);
    assert.equal(r.needsOnboarding.length, 0);
  });

  test('employerId is required once a register is configured', async () => {
    const h = harness();
    const svc = new (Object.getPrototypeOf(h.svc).constructor as typeof import('../../services/gateway/src/service.ts').KycGatewayService)(
      { ledger: h.ledger, vault: h.vault, hsm: h.hsm, rails: h.rails, ecib: h.ecib, employment: new EmploymentRegister() },
    );
    await assert.rejects(
      () => svc.employerBulkLookup(h.bank(), ['6110112345678']),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_INVALID_SCOPE',
    );
  });
});

// ===========================================================================
describe('SEC-06 · controls applied end to end over HTTP', () => {
  const start = async (enableRateLimit: boolean): Promise<{ server: Server; base: string; h: ReturnType<typeof harness> }> => {
    const h = harness();
    const server = createGateway({ service: h.svc, logRequests: false, enableRateLimit });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no address');
    return { server, base: `http://127.0.0.1:${addr.port}`, h };
  };

  test('per-subject rate limiting kicks in', async () => {
    const { server, base } = await start(true);
    try {
      let limited = false;
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`${base}/kyc/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-abhi-msp': 'ABHILendingMSP' },
          body: JSON.stringify({ cnic: CNIC_WALLET, productId: 'EWA' }),
        });
        if (res.status === 429) {
          limited = true;
          break;
        }
      }
      assert.equal(limited, true, 'expected a 429 within 40 requests for one subject');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test('an idempotent replay returns the original response', async () => {
    const { server, base } = await start(false);
    try {
      const key = randomUUID();
      const body = JSON.stringify({
        cnic: CNIC_WALLET,
        attributes: a2Attributes(),
        originProduct: 'WALLET',
        cnicExpiryAt: CNIC_EXPIRY_OK,
      });
      const headers = { 'content-type': 'application/json', 'idempotency-key': key };

      const first = await fetch(`${base}/kyc/register`, { method: 'POST', headers, body });
      const second = await fetch(`${base}/kyc/register`, { method: 'POST', headers, body });

      assert.equal(first.status, 201);
      assert.equal(second.status, 201, 'replay must not 409 as a duplicate subject');
      assert.equal(second.headers.get('idempotent-replay'), 'true');
      assert.deepEqual(await second.json(), await first.json());
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test('the same idempotency key with a different body conflicts', async () => {
    const { server, base } = await start(false);
    try {
      const key = randomUUID();
      const headers = { 'content-type': 'application/json', 'idempotency-key': key };
      const mk = (cnic: string) =>
        JSON.stringify({ cnic, attributes: a2Attributes(), originProduct: 'WALLET', cnicExpiryAt: CNIC_EXPIRY_OK });

      await fetch(`${base}/kyc/register`, { method: 'POST', headers, body: mk(CNIC_WALLET) });
      const conflict = await fetch(`${base}/kyc/register`, { method: 'POST', headers, body: mk(CNIC_FRESH) });

      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json() as { error: string }).error, 'ERR_VERSION_CONFLICT');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test('a replayed nonce is rejected', async () => {
    const { server, base } = await start(false);
    try {
      const headers = {
        'content-type': 'application/json',
        'x-abhi-nonce': 'nonce-fixed',
        'x-abhi-timestamp': new Date().toISOString(),
      };
      const body = JSON.stringify({ cnic: CNIC_WALLET, productId: 'EWA' });

      const first = await fetch(`${base}/kyc/verify`, { method: 'POST', headers, body });
      const second = await fetch(`${base}/kyc/verify`, { method: 'POST', headers, body });

      assert.notEqual(first.status, 409);
      assert.equal(second.status, 409);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ===========================================================================
describe('SEC-16 · the roster gate is reachable over HTTP', () => {
  /*
   * The gate was written, unit-tested and reported IMPLEMENTED by the
   * conformance audit — and could not engage on the only surface a caller can
   * reach. POST /employer/bulk-lookup called the service with no employerId at
   * all, so with a register configured every request failed, and without one
   * (the configuration the bootstrap actually shipped) the endpoint answered
   * "is this CNIC known to ABHI?" for any CNIC submitted.
   *
   * These tests drive real HTTP, because that is where the defect lived. The
   * service-level tests above passed throughout.
   */
  const startWithRoster = async (): Promise<{
    server: Server;
    base: string;
    h: ReturnType<typeof harness>;
  }> => {
    const employment = new EmploymentRegister();
    // The employer employs CNIC_WALLET. It does NOT employ CNIC_FRESH.
    employment.assert('EMP-1', '6110112345678');

    const h = harness({ employment });
    for (const cnic of [CNIC_WALLET, CNIC_FRESH]) {
      await h.svc.register(h.bank(), {
        cnic,
        attributes: a2Attributes(),
        originProduct: 'WALLET',
        cnicExpiryAt: CNIC_EXPIRY_OK,
      });
    }

    const server = createGateway({ service: h.svc, logRequests: false, enableRateLimit: false });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no address');
    return { server, base: `http://127.0.0.1:${addr.port}`, h };
  };

  const lookup = (base: string, cnics: string[], employerId?: string) =>
    fetch(`${base}/employer/bulk-lookup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(employerId === undefined ? {} : { 'x-abhi-employer': employerId }),
      },
      body: JSON.stringify({ cnics }),
    });

  test('an employer cannot read a CNIC it does not employ', async () => {
    const { server, base } = await startWithRoster();
    try {
      const res = await lookup(base, [CNIC_WALLET, CNIC_FRESH], 'EMP-1');
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        activateNow: string[];
        unauthorised: string[];
        needsOnboarding: string[];
      };

      assert.deepEqual(body.activateNow, [CNIC_WALLET]);
      // CNIC_FRESH is a real, verified A2 customer. The employer must not be
      // able to learn that, so it comes back unauthorised rather than ready.
      assert.deepEqual(body.unauthorised, [CNIC_FRESH]);
      assert.equal(body.needsOnboarding.length, 0);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test('an unauthorised CNIC is indistinguishable from an unknown one', async () => {
    const { server, base } = await startWithRoster();
    try {
      // CNIC_FRESH exists at ABHI; this one does not. Both are outside the
      // roster, and both must produce exactly the same shape of answer.
      const known = (await (await lookup(base, [CNIC_FRESH], 'EMP-1')).json()) as {
        rows: { bucket: string; reason: string; currentAssurance: string | null }[];
      };
      const absent = (await (await lookup(base, ['42101-9999999-9'], 'EMP-1')).json()) as {
        rows: { bucket: string; reason: string; currentAssurance: string | null }[];
      };

      assert.deepEqual(
        known.rows.map((r) => [r.bucket, r.reason, r.currentAssurance]),
        absent.rows.map((r) => [r.bucket, r.reason, r.currentAssurance]),
        'a verified customer outside the roster must look identical to a stranger',
      );
      assert.equal(known.rows[0]?.reason, 'NOT_EMPLOYED');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test('the employer id comes from the caller, never from the body', async () => {
    const { server, base } = await startWithRoster();
    try {
      // Present as EMP-2 but claim EMP-1 in the payload. The claim must not
      // be honoured — otherwise the roster check is a formality any employer
      // can step around by naming another.
      const res = await fetch(`${base}/employer/bulk-lookup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-abhi-employer': 'EMP-2' },
        body: JSON.stringify({ cnics: [CNIC_WALLET], employerId: 'EMP-1' }),
      });

      const body = (await res.json()) as { activateNow: string[]; unauthorised: string[] };
      assert.deepEqual(body.activateNow, [], 'EMP-2 must not inherit EMP-1 roster');
      assert.deepEqual(body.unauthorised, [CNIC_WALLET]);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ===========================================================================
describe('SEC-17 · per-subject rate limiting covers every identifier', () => {
  /*
   * The limiter keyed on `cnic` alone. But /kyc/verify accepts `subjectId` and
   * PREFERS it, the operations console sends nothing else, and the customer
   * read routes are /customers/{subjectId}/... — so enumeration by subject id,
   * the form an attacker would actually use, was unlimited.
   */
  test('a subjectId-keyed verify loop is rate limited', async () => {
    const h = harness();
    const r = await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const server = createGateway({ service: h.svc, logRequests: false, enableRateLimit: true });
    await new Promise<void>((res) => server.listen(0, res));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      let limited = false;
      for (let i = 0; i < 40; i += 1) {
        const res = await fetch(`${base}/kyc/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-abhi-msp': 'ABHILendingMSP' },
          body: JSON.stringify({ subjectId: r.subjectId, productId: 'EWA' }),
        });
        if (res.status === 429) {
          limited = true;
          break;
        }
      }
      assert.equal(limited, true, 'subjectId enumeration must hit the subject limit');
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});
