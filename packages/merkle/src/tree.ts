import { canonicalValue, type AttrValue } from '@abhi/canonical';
import { leafHash, nodeHash, hexEqual } from './hash.ts';

export interface Attribute {
  name: string;
  value: AttrValue;
  salt: Buffer;
}

export interface ProofStep {
  /** Sibling hash, hex. */
  hash: string;
  /** Which side the sibling sits on relative to the value being folded. */
  side: 'left' | 'right';
}

export interface AttributeProof {
  name: string;
  /** The canonical, type-tagged form actually committed to — not the raw value. */
  canonical: string;
  salt: string;
  path: ProofStep[];
}

export interface ProofBundle {
  merkleRoot: string;
  attributeSetId: string;
  attributes: AttributeProof[];
}

/**
 * Build the leaf level: sorted by attribute name, so the root is deterministic
 * regardless of the order attributes were supplied in.
 */
export function buildLeaves(attributes: readonly Attribute[]): { names: string[]; leaves: Buffer[] } {
  if (attributes.length === 0) throw new Error('empty attribute set');

  const seen = new Set<string>();
  for (const a of attributes) {
    if (seen.has(a.name)) throw new Error(`duplicate attribute: ${a.name}`);
    seen.add(a.name);
  }

  const sorted = [...attributes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    names: sorted.map((a) => a.name),
    leaves: sorted.map((a) => leafHash(a.salt, a.name, canonicalValue(a.value))),
  };
}

/**
 * Build every level of the tree, bottom-up.
 *
 * Odd nodes are PROMOTED, never duplicated. Duplicating the last node — the
 * Bitcoin approach — admits distinct leaf sets that produce the same root
 * (CVE-2012-2459 in its original form).
 */
export function buildLevels(leaves: readonly Buffer[]): Buffer[][] {
  if (leaves.length === 0) throw new Error('empty attribute set');
  const levels: Buffer[][] = [[...leaves]];

  let level = levels[0]!;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1];
      next.push(right === undefined ? left : nodeHash(left, right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

export function buildRoot(leaves: readonly Buffer[]): Buffer {
  const levels = buildLevels(leaves);
  return levels[levels.length - 1]![0]!;
}

export function merkleRootHex(attributes: readonly Attribute[]): string {
  const { leaves } = buildLeaves(attributes);
  return buildRoot(leaves).toString('hex');
}

/**
 * Sibling path for one leaf index.
 *
 * A promoted node contributes no step — that asymmetry is exactly what
 * verification has to mirror, and getting it wrong produces proofs that fail
 * only for odd-sized trees.
 */
export function buildPath(levels: readonly Buffer[][], leafIndex: number): ProofStep[] {
  const path: ProofStep[] = [];
  let idx = leafIndex;

  for (let l = 0; l < levels.length - 1; l++) {
    const level = levels[l]!;
    const isRightChild = idx % 2 === 1;
    const siblingIdx = isRightChild ? idx - 1 : idx + 1;
    const sibling = level[siblingIdx];

    if (sibling !== undefined) {
      path.push({ hash: sibling.toString('hex'), side: isRightChild ? 'left' : 'right' });
    }
    // else: this node was promoted unchanged to the next level — no step.

    idx = Math.floor(idx / 2);
  }
  return path;
}

/**
 * Fold a leaf back to a root using its sibling path.
 * Returns the computed root as hex.
 */
export function foldPath(leaf: Buffer, path: readonly ProofStep[]): string {
  let acc = leaf;
  for (const step of path) {
    acc = step.side === 'left' ? nodeHash(Buffer.from(step.hash, 'hex'), acc) : nodeHash(acc, Buffer.from(step.hash, 'hex'));
  }
  return acc.toString('hex');
}

/**
 * Verify one attribute proof against a root.
 *
 * Recomputes the leaf from the disclosed salt, name and canonical value — so a
 * proof cannot claim a value it does not actually commit to.
 */
export function verifyAttributeProof(proof: AttributeProof, expectedRoot: string): boolean {
  try {
    const salt = Buffer.from(proof.salt, 'hex');
    const leaf = leafHash(salt, proof.name, proof.canonical);
    return hexEqual(foldPath(leaf, proof.path), expectedRoot);
  } catch {
    return false;
  }
}

/** Verify every attribute in a bundle. All must pass. */
export function verifyProofBundle(bundle: ProofBundle): boolean {
  if (bundle.attributes.length === 0) return false;
  return bundle.attributes.every((a) => verifyAttributeProof(a, bundle.merkleRoot));
}

/**
 * Assemble a selective-disclosure bundle for a named subset of attributes.
 * Self-verifies before returning: a bundle that fails its own check is a defect
 * or an attack, and either way must never reach a consuming product.
 */
export function generateProofBundle(
  attributes: readonly Attribute[],
  disclose: readonly string[],
  attributeSetId: string,
): ProofBundle {
  const { names, leaves } = buildLeaves(attributes);
  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1]![0]!.toString('hex');
  const byName = new Map(attributes.map((a) => [a.name, a]));

  const proofs: AttributeProof[] = [];
  for (const name of disclose) {
    const idx = names.indexOf(name);
    const attr = byName.get(name);
    if (idx < 0 || attr === undefined) throw new Error(`attribute not in set: ${name}`);
    proofs.push({
      name,
      canonical: canonicalValue(attr.value),
      salt: attr.salt.toString('hex'),
      path: buildPath(levels, idx),
    });
  }

  const bundle: ProofBundle = { merkleRoot: root, attributeSetId, attributes: proofs };
  if (!verifyProofBundle(bundle)) {
    throw new Error('ERR_PROOF_ASSEMBLY_FAILED: bundle failed self-verification');
  }
  return bundle;
}
