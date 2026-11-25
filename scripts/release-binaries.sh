#!/usr/bin/env bash
set -euo pipefail

out="${1:?usage: scripts/release-binaries.sh <dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ -s dist/client/index.html ]] || { echo "release-binaries: no client: run bun run build:client first" >&2; exit 1; }
mkdir -p "$out"
bun install --frozen-lockfile --os='*' --cpu='*'

for pair in darwin-arm64:bun-darwin-arm64 linux-x64:bun-linux-x64-baseline linux-arm64:bun-linux-arm64; do
  name="easel-${pair%%:*}"
  bun cmds/build-binary.ts --target "${pair#*:}" --outfile "$out/$name"
done

cd "$out"
sha256sum easel-darwin-arm64 easel-linux-x64 easel-linux-arm64 > SHA256SUMS
cat SHA256SUMS
