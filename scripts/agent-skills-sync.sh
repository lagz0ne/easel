#!/usr/bin/env bash
set -euo pipefail
AS_SHA=39b723ceebf81474d0557c1fecd01eddab585563
SKIP="git-workflow-and-versioning browser-testing-with-devtools"
repo="$(git rev-parse --show-toplevel)"
claude="$repo/.claude"
lock="$claude/skills/agent-skills.lock"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
git init -q "$tmp/a"
git -C "$tmp/a" fetch -q --depth 1 https://github.com/addyosmani/agent-skills "$AS_SHA"
git -C "$tmp/a" checkout -q --detach FETCH_HEAD
src="$tmp/a"
[ "$(git -C "$src" rev-parse HEAD)" = "$AS_SHA" ] || { echo "agent-skills: HEAD is not $AS_SHA" >&2; exit 1; }

mkdir -p "$claude/skills" "$claude/agents" "$claude/commands"
if [ -f "$lock" ]; then
  grep -vE '^(#|$)' "$lock" | while read -r path; do rm -rf "${claude:?}/$path"; done
fi
owned=()
for d in "$src"/skills/*/; do
  n="$(basename "$d")"
  case " $SKIP " in *" $n "*) continue ;; esac
  [ ! -e "$claude/skills/$n" ] || { echo "agent-skills: .claude/skills/$n exists (another vendored skill?)" >&2; exit 1; }
  cp -R "$d" "$claude/skills/$n"
  owned+=("skills/$n")
done
cp -R "$src/references" "$claude/references"
owned+=("references")
for f in "$src"/agents/*.md; do
  cp "$f" "$claude/agents/"
  owned+=("agents/$(basename "$f")")
done
for f in "$src"/.claude/commands/*.md; do
  out="addy-$(basename "$f")"
  sed 's/agent-skills:\([a-z-]*\)/\1/g' "$f" >"$claude/commands/$out"
  owned+=("commands/$out")
done
cp "$src/LICENSE" "$claude/skills/AGENT-SKILLS-LICENSE"
owned+=("skills/AGENT-SKILLS-LICENSE")
{ echo "# agent-skills $AS_SHA (github.com/addyosmani/agent-skills, MIT). Written by scripts/agent-skills-sync.sh: do not edit."
  echo "# Paths under .claude/:"
  printf '%s\n' "${owned[@]}"; } >"$lock"
echo "agent-skills: ${#owned[@]} paths at ${AS_SHA:0:7} in .claude/"
