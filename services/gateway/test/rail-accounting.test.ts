// FICTIONAL-CNIC-OK: fictional CNICs exercising per-call rail accounting. Never real customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RAIL_COSTS } from '../src/rails.ts';
import {
  harness,
  a2Attributes,
  a3Attributes,
  CNIC_WALLET,
  CNIC_FRESH,
  CNIC_EMPLOYER,
  CNIC_EXPIRY_OK,
} from '../../../tests/fixture.ts';

/**
 * Per-call rail accounting.
 *
 * register() reported `this.#d.rails.metrics.callsMade` directly — the running
 * process total — as though it were the calls that registration had just made.
 * On a fresh harness the two are identical, which is why every existing test
 * passed while the number was wrong: a registration running three checks
 * reported seven on a gateway that had done other work.
 *
 * The bug was only visible once the figure reached a screen. The tests below
 * therefore do the one thing that exposes it — perform TWO operations on ONE
 * harness and check the second reports only its own.
 */

const A2_COST =
  DEFAULT_RAIL_COSTS.VERISYS.unitCostPkr +
  DEFAULT_RAIL_COSTS.DOC_AUTH.unitCostPkr +
  DEFAULT_RAIL_COSTS.BIOMETRIC_1TO1.unitCostPkr;

describe('register · rail usage is per call, not cumulative', () => {
  test('a single registration reports its own three checks', async () => {
    const h = harness();
    const r = await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    assert.equal(r.railCallsMade, 3);
    assert.equal(r.costSpentPkr, A2_COST);
  });

  test('the SECOND registration does not inherit the first', async () => {
    const h = harness();

    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    // Four rails this time — the A3 pack.
    const second = await h.svc.register(h.bank(), {
      cnic: CNIC_FRESH,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    // The regression reported 7 here, being 3 + 4 across the whole process.
    assert.equal(second.railCallsMade, 4, 'must not include the first registration');
    assert.equal(
      second.costSpentPkr,
      A2_COST + DEFAULT_RAIL_COSTS.LIVENESS.unitCostPkr,
      'the A3 pack alone',
    );

    // The gateway-wide total still accumulates — that is the metrics endpoint's
    // job, and the two figures mean different things.
    assert.equal(h.rails.metrics.callsMade, 7);
  });

  test('a third registration is unaffected by either predecessor', async () => {
    const h = harness();
    for (const cnic of [CNIC_WALLET, CNIC_FRESH]) {
      await h.svc.register(h.bank(), {
        cnic,
        attributes: a3Attributes(),
        originProduct: 'WALLET',
        cnicExpiryAt: CNIC_EXPIRY_OK,
      });
    }

    const third = await h.svc.register(h.bank(), {
      cnic: CNIC_EMPLOYER,
      attributes: a2Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    assert.equal(third.railCallsMade, 3);
    assert.equal(third.costSpentPkr, A2_COST);
    assert.equal(h.rails.metrics.callsMade, 11, 'the running total keeps counting');
  });

  test('verify reports its avoided calls per call too', async () => {
    const h = harness();
    await h.svc.register(h.bank(), {
      cnic: CNIC_WALLET,
      attributes: a3Attributes(),
      originProduct: 'WALLET',
      cnicExpiryAt: CNIC_EXPIRY_OK,
    });

    const first = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);
    const second = await h.svc.verify(h.lending(), CNIC_WALLET, 'EWA', null);

    assert.ok(first.railCallsAvoided > 0);
    assert.equal(
      second.railCallsAvoided,
      first.railCallsAvoided,
      'the same reuse twice avoids the same amount, not double',
    );
  });
});
