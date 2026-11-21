#!/usr/bin/env bash
# ship.sh: the one way onto main. Trunk-based: no branches, no PRs. Small commits, many a day.
#
#   scripts/ship.sh -m "feat(todo): msg" -- <paths...>    gate exactly these paths on HEAD, commit, push
#   scripts/ship.sh -r <sha> [-m msg]                       a gated revert of <sha>
#   scripts/ship.sh --fix -m "fix: ..." -- <paths...>       ship while main is red (the fix forward)
#   scripts/ship.sh -p <patch> -m "..." [-- <paths...>]     also ship a patch (repeat -p): for a shared
#       file, ship only your hunks (git diff f > p, cut the others' hunks). The git index is shared by
#       every agent here, so ship never reads or writes it for your change.
#
# Several agents share this checkout, so ship takes only the paths you name, as they are when you run
# it (git objects: later edits don't leak in), on top of HEAD, and never anyone else's WIP.
# The gate runs on that exact tree, in a clean copy under .ship/:
#   install, check:style, check:plain (types, rules, tests), build, scripts/smoke.sh (browser)
#   docs only (*.md): check:style only.
#   a change under docs/statecharts/ or vendor/statechart/, to a SPEC*.md, or to
#   scripts/statecharts.sh or scripts/tlc.sh: also scripts/statecharts.sh --check (easel's own
#   generator in vendor/statechart; Java and TLC from scripts/tlc.sh, cached in ~/.cache/easel/tlc).
# Green: one commit, pushed. Red: nothing committed; the logs stay in ~/.cache/ship/<repo>/<run>/.
# Stop the line: while a `trunk-red` issue is open (CI's trunk-status workflow files it), only --fix
# and -r ship. One ship at a time on this machine (flock on .ship/lock); others wait their turn.
# The pre-push hook (.githooks/pre-push) refuses a push to main that did not come from here.
set -euo pipefail
die() { echo "ship: $*" >&2; exit 1; }
log() { echo "ship: $*" >&2; }
export PATH="$HOME/.bun/bin:$HOME/.npm-global/bin:$PATH"

msg="" revert="" fix=0 patches=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m) msg="$2"; shift 2 ;;
    -r) revert="$2"; shift 2 ;;
    --fix) fix=1; shift ;;
    -p) patches+=("$(realpath -- "$2")"); shift 2 ;;
    --) shift; break ;;
    *) die "unknown arg '$1' (paths go after --)" ;;
  esac
done

repo="$(git rev-parse --show-toplevel)"
paths=()
for p in "$@"; do
  abs="$(realpath -m -- "$p")"
  [[ "$abs" == "$repo"/* ]] || die "path is outside the repo, or is the whole repo: $p"
  paths+=("${abs#"$repo"/}")
done
cd "$repo"
[[ "$(git symbolic-ref --short HEAD)" == main ]] || die "trunk-based: work on main"
if [[ -n "$revert" ]]; then
  [[ ${#paths[@]} -eq 0 ]] || die "-r takes no paths"
  revert="$(git rev-parse --verify -q "$revert^{commit}")" || die "no such commit"
  [[ -n "$msg" ]] || msg="revert: $(git log -1 --format=%s "$revert") (${revert:0:7})"
  fix=1
else
  [[ ${#paths[@]} -gt 0 || ${#patches[@]} -gt 0 ]] || die "name the paths you changed after --  (never the whole tree)"
fi
[[ -n "$msg" ]] || die "-m <message> is required"

if [[ $fix -eq 0 ]] && command -v gh >/dev/null; then
  red="$(gh issue list --label trunk-red --state open --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null || true)"
  [[ -z "$red" ]] || die "main is red: the line is stopped ($red).
  Fix it forward (--fix) or revert the culprit (-r <sha>). Do not stack other work on a red main."
fi

mkdir -p .ship
exec 9>>.ship/lock
flock -n 9 || { log "another ship is running; waiting for it"; flock 9; }

# The tree to ship: HEAD + your paths (or HEAD with <sha> undone). Prints the tree id.
make_tree() {
  if [[ -n "$revert" ]]; then
    git merge-tree --write-tree --merge-base="$revert" HEAD "$revert^" 2>/dev/null | head -n1 \
      || { echo "cannot revert ${revert:0:7} cleanly on HEAD" >&2; return 1; }
    return
  fi
  local idx; idx="$(mktemp)"
  GIT_INDEX_FILE="$idx" git read-tree HEAD
  [[ ${#paths[@]} -eq 0 ]] || GIT_INDEX_FILE="$idx" git add -A -- "${paths[@]}"
  local p
  for p in ${patches[@]+"${patches[@]}"}; do
    GIT_INDEX_FILE="$idx" git apply --cached "$p" || { echo "patch does not apply on HEAD: $p" >&2; rm -f "$idx"; return 1; }
  done
  GIT_INDEX_FILE="$idx" git write-tree
  rm -f "$idx"
}

gate() {  # <tree> <run dir>; sets $stage on failure
  local tree="$1" run="$2" docs=1 charts=0 f
  for f in $(git diff-tree -r --name-only HEAD "$tree"); do
    [[ "$f" == *.md ]] || docs=0
    case "$f" in docs/statecharts/* | SPEC*.md | scripts/statecharts.sh | scripts/tlc.sh | vendor/statechart/*) charts=1 ;; esac
  done
  mkdir -p "$run/tree"
  git archive "$tree" | tar -x -C "$run/tree"
  if [[ $charts -eq 1 ]]; then  # the charts are the oracle: a spec or chart ships only as its models say
    stage=statecharts; bash "$run/tree/scripts/statecharts.sh" --check >"$run/statecharts.log" 2>&1 || return 1
  fi
  stage=install; (cd "$run/tree" && bun install --frozen-lockfile) >"$run/install.log" 2>&1 || return 1
  stage=check:style; (cd "$run/tree" && bun run check:style) >"$run/style.log" 2>&1 || return 1
  [[ $docs -eq 0 ]] || { log "docs only: style checked, rest skipped"; return 0; }
  stage=check:plain; (cd "$run/tree" && bun run check:plain) >"$run/plain.log" 2>&1 || return 1
  stage=build; (cd "$run/tree" && bun run build) >"$run/build.log" 2>&1 || return 1
  stage=smoke; SMOKE_OUT="$run/smoke" bash "$run/tree/scripts/smoke.sh" "$run/tree" 2>&1 | tee "$run/smoke.log" >&2
  [[ ${PIPESTATUS[0]} -eq 0 ]] || return 1
}

for attempt in 1 2 3; do
  if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
    git fetch -q origin main
    git merge -q --ff-only origin/main 2>/dev/null \
      || die "cannot fast-forward main to origin/main (local commits, or dirty files that origin changed). Reconcile first."
  fi
  base="$(git rev-parse HEAD)"
  tree="$(make_tree)" || die "nothing shipped"
  [[ "$tree" != "$(git rev-parse HEAD^{tree})" ]] || die "nothing to ship: HEAD already has these paths as they are"
  # Outside the repo (vp skips gitignored trees), on the same disk as bun's cache (install hardlinks).
  run="${SHIP_RUNS:-$HOME/.cache/ship/$(basename "$repo")}/$(date -u +%Y%m%dT%H%M%SZ)-${tree:0:7}"
  log "gating ${tree:0:7} on ${base:0:7} (try $attempt; logs in $run)"
  t0=$SECONDS stage=""
  if ! gate "$tree" "$run"; then
    f="$run/$(case $stage in check:style) echo style ;; check:plain) echo plain ;; *) echo "$stage" ;; esac).log"
    grep -E '^ FAIL |Error:' "$f" >&2 2>/dev/null || tail -n 30 "$f" >&2
    log "RED at $stage. Nothing committed. Log: $f"
    log "Run the failing test on clean trunk. Fails there too: trunk is red, tell its owner. Passes: it is your change. A test that fails only sometimes is a bug: report it, do not re-run until green."
    rm -rf "$run/tree"
    exit 1
  fi
  rm -rf "$run"
  commit="$(printf '%s\n' "$msg" | git commit-tree "$tree" -p "$base")"
  git update-ref -m "ship: $msg" HEAD "$commit" "$base" || { log "HEAD moved while gating; again"; continue; }
  if [[ -n "$revert" ]]; then
    # bring the reverted files to the new HEAD, except where someone has uncommitted work in them
    for f in $(git diff --name-only "$base" "$commit"); do
      git diff --quiet "$base" -- "$f" 2>/dev/null || continue
      if git cat-file -e "$commit:$f" 2>/dev/null; then git checkout "$commit" -- "$f"
      else git rm -q -f -- "$f" 2>/dev/null || true; fi
    done
  else
    [[ ${#paths[@]} -eq 0 ]] || git reset -q -- "${paths[@]}"   # your patches' files: the index stays theirs
  fi
  if SHIP_GATED=1 git push -q origin main 2>/dev/null; then
    log "shipped ${commit:0:7} to origin/main (gate $((SECONDS - t0)) s). CI gates run next; a red one opens a trunk-red issue."
    find "$(dirname "$run")" -maxdepth 1 -name '2*' -mtime +3 -exec rm -rf {} + 2>/dev/null || true
    exit 0
  fi
  git update-ref HEAD "$base" "$commit"
  [[ -n "$revert" || ${#paths[@]} -eq 0 ]] || git reset -q -- "${paths[@]}"
  log "origin moved while gating; re-gating on the new trunk"
done
die "trunk kept moving; gave up after 3 tries (nothing committed)"
