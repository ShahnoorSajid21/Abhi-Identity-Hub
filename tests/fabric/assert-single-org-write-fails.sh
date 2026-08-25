#!/usr/bin/env bash
#
# THE test that proves the architectural claim.
#
# Criterion 3 of the POC success criteria is "no unilateral write". That is a
# property of the NETWORK, not of application code — the chaincode's own MSP
# guards are a second line of defence, but the endorsement policy is the
# control that actually carries the governance argument.
#
# This script asserts that a transaction endorsed ONLY by a product
# organization does not commit, and that the same transaction endorsed by
# Compliance plus a product organization does.
#
# Exit 0 = the claim holds. Exit 1 = the central architectural claim is FALSE.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NET="${ROOT}/network"
CHANNEL="${CHANNEL:-kyc-channel}"
CC_NAME="kyc-registry"

# See network/scripts/up.sh: peer wants the core.yaml that ships with the
# Fabric binaries, not a directory in this repository. ROOT is the repo root
# here, which is where install-fabric.sh puts config/.
export FABRIC_CFG_PATH="${FABRIC_BIN_CFG:-${ROOT}/config}"
ORG_BASE="${NET}/organizations/peerOrganizations"
ORDERER_CA="${NET}/organizations/ordererOrganizations/abhi.local/tlsca/tlsca.abhi.local-cert.pem"

BANK_TLS="${ORG_BASE}/bank.abhi.local/peers/peer0.bank.abhi.local/tls/ca.crt"
COMPLIANCE_TLS="${ORG_BASE}/compliance.abhi.local/peers/peer0.compliance.abhi.local/tls/ca.crt"

use_bank() {
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID=ABHIBankMSP
  export CORE_PEER_TLS_ROOTCERT_FILE="${BANK_TLS}"
  export CORE_PEER_MSPCONFIGPATH="${ORG_BASE}/bank.abhi.local/users/Admin@bank.abhi.local/msp"
  export CORE_PEER_ADDRESS=localhost:7051
}

SUBJECT="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
ARGS="{\"function\":\"RegisterKYC\",\"Args\":[\"${SUBJECT}\",\"$(printf 'a%.0s' {1..64})\",\"ABHI-KYC-ATTRS-v1\",\"A2\",\"[\\\"BIOMETRIC_1TO1\\\",\\\"DOC_AUTH\\\",\\\"VERISYS\\\"]\",\"2027-08-17T10:00:00Z\",\"2031-04-11T00:00:00Z\",\"3f2504e0-4f89-41d3-9a0c-0305e82c3301\",\"1\",\"WALLET\"]}"

echo "==============================================================="
echo " Asserting: a single-organization write MUST NOT commit"
echo "==============================================================="
echo "subject: ${SUBJECT:0:16}…"
echo ""

use_bank

# ---------------------------------------------------------------- negative
echo "--> [1/2] attempting RegisterKYC endorsed by ABHIBankMSP ONLY"
set +e
OUT_SINGLE=$(peer chaincode invoke \
  -o localhost:7050 --ordererTLSHostnameOverride orderer0.abhi.local \
  --tls --cafile "${ORDERER_CA}" \
  -C "${CHANNEL}" -n "${CC_NAME}" \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${BANK_TLS}" \
  -c "${ARGS}" --waitForEvent 2>&1)
RC_SINGLE=$?
set -e

echo "${OUT_SINGLE}" | sed 's/^/    /'

if [ ${RC_SINGLE} -eq 0 ] && ! echo "${OUT_SINGLE}" | grep -qiE 'ENDORSEMENT_POLICY_FAILURE|failed|error'; then
  echo ""
  echo "  ✘ FAIL — a single-organization write COMMITTED."
  echo ""
  echo "  The endorsement policy is not enforcing 'Compliance AND a product org'."
  echo "  The central architectural claim of this programme is FALSE as deployed."
  echo "  Check the --signature-policy used at approve and commit time: it must"
  echo "  be byte-identical across all three organizations."
  exit 1
fi

echo "  ✔ rejected, as required"
echo ""

# ---------------------------------------------------------------- positive
echo "--> [2/2] the same write endorsed by Compliance AND Bank"
set +e
OUT_BOTH=$(peer chaincode invoke \
  -o localhost:7050 --ordererTLSHostnameOverride orderer0.abhi.local \
  --tls --cafile "${ORDERER_CA}" \
  -C "${CHANNEL}" -n "${CC_NAME}" \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${BANK_TLS}" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "${COMPLIANCE_TLS}" \
  -c "${ARGS}" --waitForEvent 2>&1)
RC_BOTH=$?
set -e

echo "${OUT_BOTH}" | sed 's/^/    /'

if [ ${RC_BOTH} -ne 0 ]; then
  echo ""
  echo "  ✘ FAIL — the correctly-endorsed write did NOT commit."
  echo "  The policy may be over-restrictive, or a peer is unreachable."
  exit 1
fi

echo "  ✔ committed, as required"
echo ""
echo "==============================================================="
echo " PASS — no unilateral write. Compliance co-endorsement enforced"
echo " by the network, not by application code."
echo "==============================================================="
