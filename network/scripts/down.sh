#!/usr/bin/env bash
#
# Tear the local network down completely, including volumes and chaincode
# containers. A demo that cannot be reset in 90 seconds will be demoed once.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

echo "==> stopping containers"
docker compose -f docker-compose.yaml down --volumes --remove-orphans || true

echo "==> removing chaincode containers and images"
docker ps -aq --filter "name=dev-peer" | xargs -r docker rm -f
docker images -q --filter "reference=dev-peer*" | xargs -r docker rmi -f

if [ "${PURGE_CRYPTO:-no}" = "yes" ]; then
  echo "==> purging crypto material and channel artifacts"
  rm -rf organizations channel-artifacts system-genesis-block
else
  echo "==> keeping crypto material (PURGE_CRYPTO=yes to remove)"
fi

rm -f ./*.tar.gz
echo "Network down."
