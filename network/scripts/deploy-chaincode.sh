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
# Preflight.
#
# `peer lifecycle chaincode package` will tar almost anything and succeed. The
# failure then lands three steps later, inside the peer's chaincode builder,
# as an npm error in a container whose log nobody is looking at. These are the
# conditions that have to hold for the package to be RUNNABLE, checked where
# they are cheap to check.
#
# All four are currently unmet. The contract itself is written and complete —
# KycRegistryContract in src/contract.ts has every transaction and exports the
# `contracts` array Fabric looks for — but nothing has ever packaged it for a
# real peer, which is the repository's own open item: written is not proven.
# ---------------------------------------------------------------------------
CC_DIR="${ROOT}/${CC_PATH#../}"
[ -d "${CC_DIR}" ] || CC_DIR="$(cd "${ROOT}/${CC_PATH}" && pwd)"
preflight_fail=0
note() { echo "::error::chaincode package is not runnable: $1"; preflight_fail=1; }

grep -q '"fabric-shim"\|"fabric-contract-api"' "${CC_DIR}/package.json" ||
  note "package.json declares neither fabric-shim nor fabric-contract-api. The peer's builder runs npm install inside the package; fabric-contract-api is imported by src/contract.ts and has to be a real dependency."

grep -q '"scripts"' "${CC_DIR}/package.json" ||
  note "package.json has no scripts block, so no start script. The peer launches node chaincode with npm start."

if grep -rqE "from '@abhi/" "${CC_DIR}/src"; then
  note "src/ imports @abhi/canonical, @abhi/merkle and @abhi/types. Only ${CC_PATH} is packaged, those are workspace packages, and they are not published — so they cannot resolve inside the builder. The chaincode needs bundling into a self-contained artefact."
fi

if ls "${CC_DIR}/src"/*.ts >/dev/null 2>&1; then
  note "src/ is TypeScript. hyperledger/fabric-nodeenv:2.5 runs Node 18, which has no --experimental-strip-types, so the sources have to be compiled or bundled to JavaScript before packaging."
fi

if [ "${preflight_fail}" -ne 0 ]; then
  echo "::error::Packaging the chaincode for a real peer is unfinished work, not a broken script. See the README's known limitations."
  exit 1
fi

echo "==> 1/5 packaging"
peer lifecycle chaincode package "${CC_NAME}.tar.gz" \
  --path "${CC_PATH}" --lang node --label "${CC_NAME}_${CC_VERSION}"

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
