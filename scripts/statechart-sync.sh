#!/usr/bin/env bash
# Vendor the statechart generator into vendor/statechart/, at one pinned commit.
#
#   scripts/statechart-sync.sh
#
# The generator is skills/statechart/scripts of github.com/backnotprop/pstack (MIT, Lauren Tan).
# It runs TLC on a TLA+ model and draws its state graph as Mermaid. scripts/statecharts.sh runs it.
# easel keeps its own copy because the hub removed the machine's statechart tool on 2026-11-21
# (the user's decision: easel owns its model check). Only the generator comes in: no skill, no
# tests. Do not edit vendor/statechart/. To upgrade, change PSTACK_SHA, run this script, read the
# diff, and ship it.
set -euo pipefail

PSTACK_SHA=74bcc61bd216687b1d6d480c28f109adfc9824ec

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/vendor/statechart"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git init -q "$tmp/pstack"
git -C "$tmp/pstack" fetch -q --depth 1 https://github.com/backnotprop/pstack "$PSTACK_SHA"
git -C "$tmp/pstack" checkout -q --detach FETCH_HEAD
if [[ "$(git -C "$tmp/pstack" rev-parse HEAD)" != "$PSTACK_SHA" ]]; then
  echo "statechart-sync: HEAD is not $PSTACK_SHA" >&2
  exit 1
fi

src="$tmp/pstack/skills/statechart/scripts"
rm -rf "$out"
mkdir -p "$out"
cp -R "$src"/. "$out"/
rm -rf "$out/test" "$out/package.json"
cp "$tmp/pstack/LICENSE" "$out/LICENSE"
cat >"$out/VENDORED.md" <<EOF
# vendor/statechart

A copy of \`skills/statechart/scripts\` from https://github.com/backnotprop/pstack at commit
\`$PSTACK_SHA\` (MIT, see LICENSE), without its tests. \`scripts/statechart-sync.sh\` writes it.
Do not edit these files. \`scripts/statecharts.sh\` runs \`statechart\` with the Java and TLC that
\`scripts/tlc.sh\` gets.
EOF
echo "statechart-sync: vendor/statechart at $PSTACK_SHA"
