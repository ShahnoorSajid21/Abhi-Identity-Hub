export {
  LEAF_PREFIX,
  NODE_PREFIX,
  SALT_BYTES,
  newSalt,
  leafHash,
  nodeHash,
  sha256Hex,
  hmacSha256Hex,
  hexEqual,
} from './hash.ts';

export {
  type Attribute,
  type ProofStep,
  type AttributeProof,
  type ProofBundle,
  buildLeaves,
  buildLevels,
  buildRoot,
  merkleRootHex,
  buildPath,
  foldPath,
  verifyAttributeProof,
  verifyProofBundle,
  generateProofBundle,
} from './tree.ts';

export {
  normaliseCnic,
  type PepperProvider,
  SoftwarePepperProvider,
  deriveSubjectId,
} from './subject.ts';

export {
  ATTRIBUTE_SET_ID,
  ATTRIBUTE_NAMES,
  ATTRIBUTE_SENSITIVITY,
  type AttributeName,
  isKnownAttribute,
  DEMO_PEPPER,
  DEMO_CNIC,
  DEMO_ATTRIBUTE_VALUES,
  demoSalt,
  demoAttributes,
  buildAttributeSet,
} from './attributes.ts';
