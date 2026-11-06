#!/usr/bin/env bash
# Pulls the live scanner's code (v2, main branch) into vendor/v2, so the lab always scores
# tokens exactly the way the live scanner does. Nothing here talks to the live server.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${V2_REPO:-https://github.com/hoodadman/blockfisher-token-scanner-v2}"
BRANCH="${V2_BRANCH:-main}"
rm -rf vendor/v2
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" vendor/v2
git -C vendor/v2 rev-parse --short HEAD > vendor/v2-version.txt
echo "v2 scoring code: $(cat vendor/v2-version.txt)"
