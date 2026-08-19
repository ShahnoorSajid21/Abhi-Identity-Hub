#!/usr/bin/env bash
#
# Package, install, approve and commit kyc-registry on all three organizations.
#
# The endorsement policy string must be BYTE-IDENTICAL across all three
# approvals, including quote style. If checkcommitreadiness shows false for an
# organization, that is almost always why.
set -euo pipefail

CC_NAME="kyc-registry"
CC_VERSION="${CC_VERSION:-1.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"
CHANNEL="${CHANNEL:-kyc-channel}"
CC_PATH="../chaincode/kyc-registry"

# The line that makes "no unilateral write" real.
ENDORSEMENT_POLICY="AND('ABHIComplianceMSP.peer', OR('ABHIBankMSP.peer','ABHILendingMSP.peer'))"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FABRIC_CFG_PATH="${ROOT}/config"
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
