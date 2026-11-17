#!/usr/bin/env bash
# Vendor Addy Osmani's agent-skills (github.com/addyosmani/agent-skills, MIT) at one pinned commit.
# Reviewed 39b723c: markdown skills, two local scripts (idea-refine.sh makes docs/ideas;
# quality-gate.mjs is an example gate), no hooks wired. Upgrade: change AS_SHA, re-run, read the
# diff, ship it.
#
# What lands where, so the skills' own relative links (../../references/...) still resolve:
#   skills/<name>/            -> .claude/skills/<name>/
#   references/               -> .claude/references/
#   agents/<name>.md          -> .claude/agents/<name>.md
#   .claude/commands/<c>.md   -> .claude/commands/addy-<c>.md   (/addy-spec, /addy-plan, ...)
# The commands are renamed: /review and /plan are Claude Code's own. Their body names the plugin
# skill (`agent-skills:spec-driven-development`); here the skill is plain `spec-driven-development`,
# so that prefix is cut. Nothing else is changed.
# Left out (SKIP): two skills that trigger on their own and contradict AGENTS.md.
#   git-workflow-and-versioning fires on any code change and teaches feature branches and PRs;
#   easel is one trunk, landed by scripts/ship.sh.
#   browser-testing-with-devtools wants the Chrome DevTools MCP in .mcp.json; easel tests the
#   browser with agent-browser (scripts/smoke.sh).
# A few vendored files still name them; AGENTS.md says what to use instead.
# Idempotent: it replaces only the paths it owns, listed in .claude/skills/agent-skills.lock.
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
