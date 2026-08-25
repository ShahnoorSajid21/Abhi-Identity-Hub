#!/usr/bin/env bash
#
# Bring up the local Fabric network: crypto material, genesis, containers,
# channel, joins, anchor peers.
#
# Idempotent — safe to re-run. Verify at each step; a Fabric network that comes
# up half-configured fails later with errors that look like network faults.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

CHANNEL="${CHANNEL:-kyc-channel}"
export PATH="${ROOT}/../bin:${PATH}"

# Two tools want two different FABRIC_CFG_PATHs, and pointing one at the
# other's directory is why this script never got past step 2:
#
#   configtxgen reads configtx.yaml — that lives here, in network/.
#   peer reads core.yaml — that ships with the Fabric binaries; install-fabric
#     .sh drops it in a config/ directory beside bin/.
#
# The previous value, ${ROOT}/config, was neither. No such directory has ever
# existed in this repository, so configtxgen failed on every run — including
# the CI job, which is how it stayed unnoticed while the job never ran.
CONFIGTX_CFG="${ROOT}"
FABRIC_BIN_CFG="${FABRIC_BIN_CFG:-${ROOT}/../config}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need docker
need cryptogen
need configtxgen
need peer
need osnadmin

[ -f "${CONFIGTX_CFG}/configtx.yaml" ] || {
  echo "missing: ${CONFIGTX_CFG}/configtx.yaml"; exit 1; }
[ -f "${FABRIC_BIN_CFG}/core.yaml" ] || {
  echo "missing: ${FABRIC_BIN_CFG}/core.yaml"
  echo "  peer reads core.yaml from FABRIC_CFG_PATH. It ships with the Fabric"
  echo "  binaries — run install-fabric.sh, or set FABRIC_BIN_CFG to wherever"
  echo "  its config/ directory landed."
  exit 1; }
[ -f "${ROOT}/.env" ] || {
  echo "missing: ${ROOT}/.env  (cp network/.env.example network/.env)"; exit 1; }

echo "==> 1/6 crypto material"
if [ ! -d organizations/peerOrganizations ]; then
  cryptogen generate --config=./crypto-config.yaml --output=organizations
else
  echo "    (already generated — delete network/organizations to regenerate)"
fi
[ -d organizations/peerOrganizations/bank.abhi.local ] || { echo "FAILED"; exit 1; }

echo "==> 2/6 channel genesis block"
mkdir -p channel-artifacts
FABRIC_CFG_PATH="${CONFIGTX_CFG}" \
  configtxgen -profile KycChannel -outputBlock "./channel-artifacts/${CHANNEL}.block" -channelID "${CHANNEL}"

echo "==> 3/6 starting containers"
docker compose -f docker-compose.yaml up -d
echo "    waiting for orderers…"
sleep 8

echo "==> 4/6 creating the channel"
ORDERER_ADMIN_TLS="organizations/ordererOrganizations/abhi.local/orderers/orderer0.abhi.local/tls"
osnadmin channel join --channelID "${CHANNEL}" \
  --config-block "./channel-artifacts/${CHANNEL}.block" \
  -o localhost:7053 \
  --ca-file "${ORDERER_ADMIN_TLS}/ca.crt" \
  --client-cert "${ORDERER_ADMIN_TLS}/server.crt" \
  --client-key "${ORDERER_ADMIN_TLS}/server.key" || echo "    (channel may already exist)"

echo "==> 5/6 joining peers"
ORG_BASE="${ROOT}/organizations/peerOrganizations"
join_peer() {
  local msp=$1 port=$2 domain=$3
  export FABRIC_CFG_PATH="${FABRIC_BIN_CFG}"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${msp}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${ORG_BASE}/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${ORG_BASE}/${domain}/users/Admin@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"
  peer channel join -b "./channel-artifacts/${CHANNEL}.block" 2>/dev/null || echo "    ${msp} already joined"
  echo "    ${msp}: $(peer channel list 2>/dev/null | tail -1)"
}
join_peer ABHIBankMSP       7051 bank.abhi.local
join_peer ABHILendingMSP    8051 lending.abhi.local
join_peer ABHIComplianceMSP 9051 compliance.abhi.local

echo "==> 6/6 anchor peers"
# Skipping this is the single most common Fabric setup omission: without anchor
# peers, cross-organization gossip never establishes and endorsement fails
# later with errors that look like network faults.
#
# It is not skipped here. Each organization declares its AnchorPeers in
# configtx.yaml and the KycChannel profile includes all three, so configtxgen
# baked them into the block joined in step 4. The configtxlator dance is for
# networks whose profile omits them; this one does not. Verified rather than
# assumed, because assuming is how the omission happens.
BLOCK_JSON="$(FABRIC_CFG_PATH="${CONFIGTX_CFG}" configtxgen -inspectBlock \
  "./channel-artifacts/${CHANNEL}.block" 2>/dev/null || true)"
for domain in bank lending compliance; do
  if printf '%s' "${BLOCK_JSON}" | grep -q "peer0.${domain}.abhi.local"; then
    echo "    ${domain}: anchor peer present in the channel block"
  else
    echo "::warning::${domain} has no anchor peer in the channel block"
  fi
done

echo ""
echo "Network up. Next:  npm run network:deploy-cc"
