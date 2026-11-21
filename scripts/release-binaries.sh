#!/usr/bin/env bash
# The command line of one build, for the GitHub release `build-<n>` (SPEC-cli.md § Get the command
# line): one binary per system, and their SHA-256 sums. GET /install.sh downloads them.
#
#   scripts/release-binaries.sh <dir>
#
# It needs the embedded client first (`bun run build:client`), as `build:server` does. Each binary
# is the same program as dist/server (`easel serve` and the CLI), cross-compiled by
# `bun build --compile --target`. In <dir>: easel-darwin-arm64, easel-linux-x64, easel-linux-arm64
# and SHA256SUMS, in the format of `sha256sum`, which `sha256sum -c` and `shasum -a 256 -c` read.
# linux-x64 is Bun's baseline build: it runs on a CPU with no AVX2 too (Bun's own installer picks
# it for such a CPU). The CLI does not need the speed of the other build.
set -euo pipefail

out="${1:?usage: scripts/release-binaries.sh <dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
[[ -s dist/client/index.html ]] || { echo "release-binaries: no client: run bun run build:client first" >&2; exit 1; }
mkdir -p "$out"

for pair in darwin-arm64:bun-darwin-arm64 linux-x64:bun-linux-x64-baseline linux-arm64:bun-linux-arm64; do
  name="easel-${pair%%:*}"
  bun build cmds/easel.ts cmds/telemetry-worker.ts --compile --target="${pair#*:}" --bytecode \
    --format=esm --minify --define process.env.NODE_ENV='"production"' --outfile "$out/$name"
done

cd "$out"
sha256sum easel-darwin-arm64 easel-linux-x64 easel-linux-arm64 > SHA256SUMS
cat SHA256SUMS
