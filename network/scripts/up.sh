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
export FABRIC_CFG_PATH="${ROOT}/config"
export PATH="${ROOT}/../bin:${PATH}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1"; exit 1; }; }
need docker
need cryptogen
need configtxgen
need peer
need osnadmin

echo "==> 1/6 crypto material"
if [ ! -d organizations/peerOrganizations ]; then
  cryptogen generate --config=./crypto-config.yaml --output=organizations
else
  echo "    (already generated — delete network/organizations to regenerate)"
fi
[ -d organizations/peerOrganizations/bank.abhi.local ] || { echo "FAILED"; exit 1; }

echo "==> 2/6 channel genesis block"
mkdir -p channel-artifacts
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
# Skipping this is the single most common Fabric setup omission. Without anchor
# peers, cross-organization gossip never establishes and endorsement fails
# later with errors that look like network faults.
echo "    (configure via configtxlator; see docs/POC_BUILD_GUIDE.md step 14)"

echo ""
echo "Network up. Next:  npm run network:deploy-cc"
