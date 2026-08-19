import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KycError, type ProductPolicy } from '@abhi/types';
import {
  isApproved,
  assertPolicyUsable,
  validateApprovals,
  classifyChange,
  approve,
  PRODUCT_POLICIES,
  type ApprovalRecord,
} from '../src/index.ts';

const policy = (over: Partial<ProductPolicy> = {}): ProductPolicy => ({
  docType: 'ProductPolicy',
  productId: 'EWA',
  policyVersion: 1,
  minAssurance: 'A2',
  maxAgeDays: 365,
  disclosableAttributes: ['verisys_match', 'biometric_match'],
  requireConsent: true,
  denyOnCnicExpiry: true,
  effectiveFrom: '2026-09-01T00:00:00Z',
  effectiveTo: null,
  approvedBy: ['ABHIComplianceMSP:asma.k', 'ABHILendingMSP:bilal.r'],
  createdTxId: 'tx',
  ...over,
});

const complianceApproval: ApprovalRecord = {
  approver: 'ABHIComplianceMSP:asma.k',
  mspId: 'ABHIComplianceMSP',
  role: 'compliance',
  approvedAt: '2026-08-17T10:00:00Z',
  rationale: 'Reviewed against BPRD Circular 01 of 2025 category mapping.',
};

const productApproval: ApprovalRecord = {
  approver: 'ABHILendingMSP:bilal.r',
  mspId: 'ABHILendingMSP',
  role: 'product-owner',
  approvedAt: '2026-08-17T10:05:00Z',
  rationale: 'Product accepts the friction implication.',
};

const riskApproval: ApprovalRecord = {
  approver: 'ABHIComplianceMSP:danish.s',
  mspId: 'ABHIComplianceMSP',
  role: 'risk',
  approvedAt: '2026-08-17T10:10:00Z',
  rationale: 'Risk accepts the widened reliance population.',
};

describe('C-11 · approval state', () => {
  test('shipped POC policies are NOT approved', () => {
    for (const [name, p] of Object.entries(PRODUCT_POLICIES)) {
      assert.equal(isApproved(p), false, `${name} must ship unapproved`);
      assert.ok(p.approvedBy.some((a) => a.startsWith('PENDING:')));
    }
  });

  test('a fully-approved policy passes', () => {
    assert.equal(isApproved(policy()), true);
  });

  test('one approver is not enough', () => {
    assert.equal(isApproved(policy({ approvedBy: ['ABHIComplianceMSP:asma.k'] })), false);
  });
});

describe('C-11 · unapproved policies are refused in production', () => {
  const withEnv = (value: string | undefined, fn: () => void): void => {
    const prev = process.env['NODE_ENV'];
    if (value === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = value;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = prev;
    }
  };

  test('production refuses an unapproved policy', () => {
    withEnv('production', () => {
      assert.throws(
        () => assertPolicyUsable(PRODUCT_POLICIES['EWA']!),
        (e: unknown) => e instanceof KycError && e.code === 'ERR_INVALID_SCOPE',
      );
    });
  });

  test('production accepts an approved policy', () => {
    withEnv('production', () => {
      assert.doesNotThrow(() => assertPolicyUsable(policy()));
    });
  });

  test('outside production the POC defaults still work', () => {
    withEnv('test', () => {
      assert.doesNotThrow(() => assertPolicyUsable(PRODUCT_POLICIES['EWA']!));
    });
  });
});

describe('C-11 · four-eyes validation', () => {
  test('two approvals are required', () => {
    assert.throws(() => validateApprovals([complianceApproval]), KycError);
  });

  test('the same identity approving twice is still one person', () => {
    assert.throws(
      () => validateApprovals([complianceApproval, { ...complianceApproval, approvedAt: 'later' }]),
      (e: unknown) => e instanceof KycError && (e.detail ?? '').includes('distinct'),
    );
  });

  test('Compliance approval is mandatory', () => {
    assert.throws(
      () =>
        validateApprovals([
          productApproval,
          { ...productApproval, approver: 'ABHIBankMSP:sara.m', mspId: 'ABHIBankMSP' },
        ]),
      (e: unknown) => e instanceof KycError && (e.detail ?? '').includes('Compliance'),
    );
  });

  test('every approver must give a rationale', () => {
    assert.throws(
      () => validateApprovals([complianceApproval, { ...productApproval, rationale: '  ' }]),
      (e: unknown) => e instanceof KycError && e.code === 'ERR_REASON_REQUIRED',
    );
  });

  test('a valid pair passes', () => {
    assert.doesNotThrow(() => validateApprovals([complianceApproval, productApproval]));
  });
});

describe('C-11 · change classification', () => {
  test('lowering minAssurance is a LOOSENING', () => {
    const c = classifyChange(policy(), policy({ minAssurance: 'A1' }));
    assert.equal(c.direction, 'LOOSENING');
    assert.ok(c.reasons[0]!.includes('A2 -> A1'));
  });

  test('extending maxAgeDays is a LOOSENING', () => {
    assert.equal(classifyChange(policy(), policy({ maxAgeDays: 730 })).direction, 'LOOSENING');
  });

  test('widening disclosure is a LOOSENING', () => {
    const c = classifyChange(
      policy(),
      policy({ disclosableAttributes: ['verisys_match', 'biometric_match', 'date_of_birth'] }),
    );
    assert.equal(c.direction, 'LOOSENING');
  });

  test('removing the CNIC-expiry block is a LOOSENING', () => {
    assert.equal(classifyChange(policy(), policy({ denyOnCnicExpiry: false })).direction, 'LOOSENING');
  });

  test('raising minAssurance is a TIGHTENING', () => {
    assert.equal(classifyChange(policy(), policy({ minAssurance: 'A3' })).direction, 'TIGHTENING');
  });

  test('no policy in force is NEW', () => {
    assert.equal(classifyChange(null, policy()).direction, 'NEW');
  });
});

describe('C-11 · approval routing', () => {
  const request = {
    requestId: 'req-1',
    productId: 'EWA',
    current: policy(),
    requestedBy: 'ABHILendingMSP:bilal.r',
    requestedAt: '2026-08-17T09:00:00Z',
    approvals: [],
    status: 'PENDING' as const,
  };

  test('a loosening change REQUIRES Risk approval', () => {
    assert.throws(
      () =>
        approve(
          { ...request, proposed: policy({ minAssurance: 'A1' }) },
          [complianceApproval, productApproval],
          '2026-09-01T00:00:00Z',
        ),
      (e: unknown) => e instanceof KycError && (e.detail ?? '').includes('Risk approval'),
    );
  });

  test('a loosening change with Risk approval succeeds and bumps the version', () => {
    const result = approve(
      { ...request, proposed: policy({ minAssurance: 'A1' }) },
      [complianceApproval, productApproval, riskApproval],
      '2026-09-01T00:00:00Z',
    );
    assert.equal(result.policyVersion, 2);
    assert.equal(result.minAssurance, 'A1');
    assert.equal(isApproved(result), true);
    assert.equal(result.approvedBy.length, 3);
  });

  test('a tightening change needs only Compliance plus the product owner', () => {
    const result = approve(
      { ...request, proposed: policy({ minAssurance: 'A3' }) },
      [complianceApproval, productApproval],
      '2026-09-01T00:00:00Z',
    );
    assert.equal(result.minAssurance, 'A3');
    assert.equal(isApproved(result), true);
  });
});
