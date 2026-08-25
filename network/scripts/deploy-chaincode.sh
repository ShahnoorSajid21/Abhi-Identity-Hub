#!/usr/bin/env bash
#
# Package, install, approve and commit kyc-registry on all three organizations.
#
# The endorsement policy string must be BYTE-IDENTICAL across all three
# approvals, including quote style. If checkcommitreadiness shows false for an
# organization, that is almost always why.
set -euo pipefail

# See network/scripts/up.sh: `set -e` reports an exit code and nothing else,
# which is unusable in CI. Name the line, the code and the command.
trap 'rc=$?; echo "::error file=network/scripts/deploy-chaincode.sh,line=${LINENO}::deploy-chaincode.sh failed at line ${LINENO} (exit ${rc}): ${BASH_COMMAND}"; exit $rc' ERR

CC_NAME="kyc-registry"
CC_VERSION="${CC_VERSION:-1.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"
CHANNEL="${CHANNEL:-kyc-channel}"
CC_PATH="../chaincode/kyc-registry"

# The line that makes "no unilateral write" real.
ENDORSEMENT_POLICY="AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer','ABHILendingMSP.peer'))"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# up.sh does this and this script did not, which is why `peer lifecycle
# chaincode package` failed: CC_PATH is ../chaincode/kyc-registry, relative,
# and CI invokes the script from the repository root rather than from network/.
# It was therefore resolving to a chaincode directory one level ABOVE the
# repository. Every other relative path in this file has the same assumption.
cd "${ROOT}"

# peer reads core.yaml from FABRIC_CFG_PATH, and core.yaml ships with the
# Fabric binaries rather than living in this repository. ${ROOT}/config named
# a directory that has never existed here — see network/scripts/up.sh.
export FABRIC_CFG_PATH="${FABRIC_BIN_CFG:-${ROOT}/../config}"
ORG_BASE="${ROOT}/organizations/peerOrganizations"
ORDERER_CA="${ROOT}/organizations/ordererOrganizations/abhi.local/tlsca/tlsca.abhi.local-cert.pem"

BANK_TLS="${ORG_BASE}/bank.abhi.local/peers/peer0.bank.abhi.local/tls/ca.crt"
LENDING_TLS="${ORG_BASE}/lending.abhi.local/peers/peer0.lending.abhi.local/tls/ca.crt"
COMPLIANCE_TLS="${ORG_BASE}/compliance.abhi.local/peers/peer0.compliance.abhi.local/tls/ca.crt"

set_org() {
  local org=$1 msp=$2 port=$3 domain=$4
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${msp}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${ORG_BASE}/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${ORG_BASE}/${domain}/users/Admin@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"
  echo "==> context: ${org}"
}

# ---------------------------------------------------------------------------
# Build, then package the BUILT artefact.
#
# Never package chaincode/kyc-registry itself. That directory is TypeScript
# importing three unpublished workspace packages, and the peer's builder — which
# runs npm install and npm start inside whatever it is handed, on Node 18 —
# can do nothing with either. `peer lifecycle chaincode package` would tar it
# quite happily and the failure would surface three steps later as an npm error
# inside a container nobody has the log for.
#
# scripts/build-chaincode.mjs produces dist/: one CommonJS bundle with the
# workspace code inlined, plus a manifest whose only dependencies are the
# Fabric packages npm can actually fetch. See that file for why the build needs
# both tsc and esbuild rather than either alone.
# ---------------------------------------------------------------------------
CC_SRC_DIR="$(cd "${ROOT}/${CC_PATH}" && pwd)"
CC_DIST="${CC_SRC_DIR}/dist"

if [ "${SKIP_CC_BUILD:-0}" != "1" ]; then
  echo "==> 0/5 building the chaincode package"
  ( cd "${ROOT}/.." && npm run chaincode:build )
fi

preflight_fail=0
note() { echo "::error::chaincode package is not runnable: $1"; preflight_fail=1; }

[ -f "${CC_DIST}/index.js" ] ||
  note "no built bundle at ${CC_DIST}/index.js — run npm run chaincode:build"
[ -f "${CC_DIST}/package.json" ] ||
  note "no manifest at ${CC_DIST}/package.json — run npm run chaincode:build"

if [ -f "${CC_DIST}/package.json" ]; then
  grep -q '"fabric-shim"' "${CC_DIST}/package.json" ||
    note "the built manifest does not depend on fabric-shim, which provides the fabric-chaincode-node binary the start script invokes"
  grep -q '"start"' "${CC_DIST}/package.json" ||
    note "the built manifest has no start script; the peer launches node chaincode with npm start"
fi

# A bare @abhi require in the bundle means the inlining silently failed and the
# builder's npm install will go looking for a package that was never published.
if [ -f "${CC_DIST}/index.js" ] && grep -q 'require("@abhi/' "${CC_DIST}/index.js"; then
  note "the bundle still requires @abhi/* at runtime — those are unpublished workspace packages and will not resolve inside the builder"
fi

if [ "${preflight_fail}" -ne 0 ]; then
  exit 1
fi

echo "==> 1/5 packaging"
peer lifecycle chaincode package "${CC_NAME}.tar.gz" \
  --path "${CC_DIST}" --lang node --label "${CC_NAME}_${CC_VERSION}"

echo "==> 2/5 installing on all three peers"
for spec in "Bank ABHIBankMSP 7051 bank.abhi.local" \
            "Lending ABHILendingMSP 8051 lending.abhi.local" \
            "Compliance ABHIComplianceMSP 9051 compliance.abhi.local"; do
  # shellcheck disable=SC2086
  set_org ${spec}
  peer lifecycle chaincode install "${CC_NAME}.tar.gz" || echo "    (already installed)"
done

PACKAGE_ID=$(peer lifecycle chaincode queryinstalled \
  | sed -n "s/^Package ID: \(${CC_NAME}_${CC_VERSION}:[a-f0-9]*\).*/\1/p" | head -1)
echo "==> package id: ${PACKAGE_ID}"

echo "==> 3/5 approving for each organization"
for spec in "Bank ABHIBankMSP 7051 bank.abhi.local" \
            "Lending ABHILendingMSP 8051 lending.abhi.local" \
            "Compliance ABHIComplianceMSP 9051 compliance.abhi.local"; do
  # shellcheck disable=SC2086
  set_org ${spec}
  peer lifecycle chaincode approveformyorg \
    -o localhost:7050 --ordererTLSHostnameOverride orderer0.abhi.local \
    --tls --cafile "${ORDERER_CA}" \
    --channelID "${CHANNEL}" --name "${CC_NAME}" --version "${CC_VERSION}" \
    --package-id "${PACKAGE_ID}" --sequence "${CC_SEQUENCE}" \
    --signature-policy "${ENDORSEMENT_POLICY}"
done

echo "==> 4/5 commit readiness (all three must be true)"
peer lifecycle chaincode checkcommitreadiness \
  --channelID "${CHANNEL}" --name "${CC_NAME}" --version "${CC_VERSION}" \
  --sequence "${CC_SEQUENCE}" --signature-policy "${ENDORSEMENT_POLICY}" --output json

echo "==> 5/5 committing"
peer lifecycle chaincode commit \
  -o localhost:7050 --ordererTLSHostnameOverride orderer0.abhi.local \
  --tls --cafile "${ORDERER_CA}" \
  --channelID "${CHANNEL}" --name "${CC_NAME}" --version "${CC_VERSION}" \
  --sequence "${CC_SEQUENCE}" --signature-policy "${ENDORSEMENT_POLICY}" \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${BANK_TLS}" \
  --peerAddresses localhost:8051 --tlsRootCertFiles "${LENDING_TLS}" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "${COMPLIANCE_TLS}"

echo ""
echo "kyc-registry ${CC_VERSION} committed to ${CHANNEL}"
echo "endorsement: ${ENDORSEMENT_POLICY}"
