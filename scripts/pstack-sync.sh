#!/usr/bin/env bash
# Vendor the pstack skills (github.com/backnotprop/pstack, MIT) into .claude/skills/ at one pinned commit.
# The hub reviewed 74bcc61 (hq-bjq). Upgrade: change PSTACK_SHA, re-run, read the diff, commit.
# statechart is left out: the hub installs it globally (~/.claude/skills/statechart) with its Java and TLC.
# Idempotent: it replaces only the folders it owns, listed in .claude/skills/pstack.lock.
set -euo pipefail
PSTACK_SHA=74bcc61bd216687b1d6d480c28f109adfc9824ec
SKIP="statechart"
repo="$(git rev-parse --show-toplevel)"
dest="$repo/.claude/skills"
lock="$dest/pstack.lock"
src="$HOME/.local/opt/pstack/$PSTACK_SHA"
tmp=""
if [ "$(git -C "$src" rev-parse HEAD 2>/dev/null)" != "$PSTACK_SHA" ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  git init -q "$tmp/p"
  git -C "$tmp/p" fetch -q --depth 1 https://github.com/backnotprop/pstack "$PSTACK_SHA"
  git -C "$tmp/p" checkout -q --detach FETCH_HEAD
  src="$tmp/p"
fi
[ "$(git -C "$src" rev-parse HEAD)" = "$PSTACK_SHA" ] || { echo "pstack: HEAD is not $PSTACK_SHA" >&2; exit 1; }

mkdir -p "$dest"
if [ -f "$lock" ]; then
  grep -vE '^(#|$)' "$lock" | while read -r name; do rm -rf "${dest:?}/$name"; done
fi
names=()
for d in "$src"/skills/*/; do
  n="$(basename "$d")"
  case " $SKIP " in *" $n "*) continue ;; esac
  cp -R "$d" "$dest/$n"
  names+=("$n")
done
cp "$src/LICENSE" "$dest/PSTACK-LICENSE"
{ echo "# pstack $PSTACK_SHA (github.com/backnotprop/pstack, MIT). Written by scripts/pstack-sync.sh: do not edit."
  printf '%s\n' "${names[@]}"; } >"$lock"
echo "pstack: ${#names[@]} skills at ${PSTACK_SHA:0:7} in .claude/skills/"
