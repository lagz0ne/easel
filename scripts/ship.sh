#!/usr/bin/env bash
set -euo pipefail
die() { echo "ship: $*" >&2; exit 1; }
log() { echo "ship: $*" >&2; }
usage() {
  cat <<'USAGE'
scripts/ship.sh -m "feat(todo): msg" -- <paths...>   gate these paths on HEAD, commit, push
scripts/ship.sh --full -m "..." -- <paths...>          add check:plain, build, smoke (and charts) to the gate
scripts/ship.sh -r <sha> [-m msg]                      a gated revert of <sha>
scripts/ship.sh --fix -m "fix: ..." -- <paths...>      ship while main is red (fix forward)
scripts/ship.sh -p <patch> -m "..." [-- <paths...>]    also ship a patch (repeat -p): your hunks of a shared file

Before the gate, ship waits for a low load, then formats the named files (not the files of a patch).
Each run adds one JSON line to <SHIP_RUNS>/runs.jsonl: time, agent, mode, stage, result, seconds, load.

Environment:
  SHIP_MAX_LOAD=10                  wait while the 1-minute load is this value or more
  SHIP_LOAD_POLL_S=15               seconds between two load checks
  SHIP_LOAD_WAIT_S=600              wait this number of seconds at most, then refuse
  SHIP_LOADAVG_FILE=/proc/loadavg   the file that gives the load
  SHIP_FORMAT="bun --bun vp fmt --write --no-error-on-unmatched-pattern"
                                    the format command; ship adds the named files
  SHIP_RUNS=~/.cache/ship/<repo>    the logs of red gates, and runs.jsonl
  PASEO_AGENT_ID                    the agent of the run, in runs.jsonl
USAGE
}
export PATH="$HOME/.bun/bin:$HOME/.npm-global/bin:$PATH"

msg="" revert="" fix=0 full=0 patches=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m) msg="$2"; shift 2 ;;
    -r) revert="$2"; shift 2 ;;
    --fix) fix=1; shift ;;
    --full) full=1; shift ;;
    -p) patches+=("$(realpath -- "$2")"); shift 2 ;;
    -h | --help) usage; exit 0 ;;
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

runs_dir="${SHIP_RUNS:-$HOME/.cache/ship/$(basename "$repo")}"
mode=ship
[[ $full -eq 0 ]] || mode=full
[[ $fix -eq 0 ]] || mode=fix
[[ -z "$revert" ]] || mode=revert
docs=0
if [[ ${#paths[@]} -gt 0 && ${#patches[@]} -eq 0 ]]; then
  docs=1
  for p in "${paths[@]}"; do [[ "$p" == *.md ]] || docs=0; done
fi
tree="" stage="" result=red t0="" load0=""

json_str() {
  if [[ "$1" =~ ^[A-Za-z0-9._:-]{1,128}$ ]]; then printf '"%s"' "$1"; else printf null; fi
}
json_num() {
  if [[ "$1" =~ ^(0|[1-9][0-9]*)(\.[0-9]+)?$ ]]; then printf '%s' "$1"; else printf null; fi
}
record() {
  local code=$? seconds=0 docs_json=false
  [[ -z "$t0" ]] || seconds=$((SECONDS - t0))
  [[ $docs -eq 0 ]] || docs_json=true
  [[ "$result" == red ]] || stage=""
  {
    mkdir -p "$runs_dir"
    printf '{"at":%s,"agent":%s,"mode":%s,"docs":%s,"tree":%s,"stage":%s,"result":%s,"seconds":%s,"load":%s,"paths":%s}\n' \
      "$(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" "$(json_str "${PASEO_AGENT_ID:-}")" "$(json_str "$mode")" \
      "$docs_json" "$(json_str "${tree:0:7}")" "$(json_str "$stage")" "$(json_str "$result")" \
      "$seconds" "$(json_num "$load0")" "$((${#paths[@]} + ${#patches[@]}))" >>"$runs_dir/runs.jsonl"
  } 2>/dev/null || true
  exit "$code"
}

load_now() { awk '{ print $1; exit }' "${SHIP_LOADAVG_FILE:-/proc/loadavg}" 2>/dev/null || true; }
load_over() { awk -v now="$1" -v limit="$2" 'BEGIN { exit !(now + 0 >= limit + 0) }'; }

wait_for_load() {
  local max="${SHIP_MAX_LOAD:-10}" poll="${SHIP_LOAD_POLL_S:-15}" most="${SHIP_LOAD_WAIT_S:-600}"
  local load="$load0" w0=$SECONDS told=0
  while load_over "$load" "$max"; do
    if ((SECONDS - w0 >= most)); then
      result=load
      die "load stays at $load; nothing shipped. Run it again later."
    fi
    [[ $told -eq 1 ]] || log "load $load: waiting for a load below $max"
    told=1
    sleep "$poll"
    load="$(load_now)"
  done
}

format_named() {
  local -a files=() fmt before after changed=()
  local -A patched=()
  local p f i
  for p in ${patches[@]+"${patches[@]}"}; do
    while IFS=$'\t' read -r _ _ f; do patched["$f"]=1; done < <(git apply --numstat "$p" 2>/dev/null || true)
  done
  for p in ${paths[@]+"${paths[@]}"}; do
    [[ -f "$p" && -z "${patched["$p"]:-}" ]] && files+=("$p")
  done
  [[ ${#files[@]} -gt 0 ]] || return 0
  read -ra fmt <<<"${SHIP_FORMAT:-bun --bun vp fmt --write --no-error-on-unmatched-pattern}"
  mapfile -t before < <(git hash-object -- "${files[@]}")
  "${fmt[@]}" "${files[@]}" >/dev/null 2>&1 || log "the format command failed; the gate shows the error"
  mapfile -t after < <(git hash-object -- "${files[@]}" 2>/dev/null || true)
  for i in "${!files[@]}"; do
    [[ "${before[i]}" == "${after[i]:-}" ]] || changed+=("${files[i]}")
  done
  [[ ${#changed[@]} -eq 0 ]] || log "formatted: ${changed[*]}"
}

mkdir -p .ship
exec 9>>.ship/lock
flock -n 9 || { log "another ship is running; waiting for it"; flock 9; }
trap record EXIT
load0="$(load_now)"
stage=load
wait_for_load
if [[ -z "$revert" ]]; then
  stage=format
  format_named
fi

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

gate() {
  local tree="$1" run="$2" charts=0 f
  docs=1
  for f in $(git diff-tree -r --name-only HEAD "$tree"); do
    [[ "$f" == *.md ]] || docs=0
    case "$f" in docs/statecharts/* | SPEC*.md | scripts/statecharts.sh | scripts/tlc.sh | vendor/statechart/*) charts=1 ;; esac
  done
  mkdir -p "$run/tree"
  git archive "$tree" | tar -x -C "$run/tree"
  if [[ $full -eq 1 && $charts -eq 1 ]]; then
    stage=statecharts; bash "$run/tree/scripts/statecharts.sh" --check >"$run/statecharts.log" 2>&1 || return 1
  fi
  stage=install; (cd "$run/tree" && bun install --frozen-lockfile) >"$run/install.log" 2>&1 || return 1
  if [[ $full -eq 0 && $docs -eq 0 ]]; then
    local sp tp
    (cd "$run/tree" && bun run check:style) >"$run/style.log" 2>&1 & sp=$!
    (cd "$run/tree" && bun run typecheck) >"$run/typecheck.log" 2>&1 & tp=$!
    stage=check:style; wait "$sp" || { wait "$tp" || true; return 1; }
    stage=typecheck; wait "$tp" || return 1
    return 0
  fi
  stage=check:style; (cd "$run/tree" && bun run check:style) >"$run/style.log" 2>&1 || return 1
  [[ $docs -eq 0 ]] || { log "docs only: style checked, rest skipped"; return 0; }
  stage=check:plain; (cd "$run/tree" && bun run check:plain) >"$run/plain.log" 2>&1 || return 1
  stage=build; (cd "$run/tree" && bun run build) >"$run/build.log" 2>&1 || return 1
  stage=smoke; SMOKE_OUT="$run/smoke" bash "$run/tree/scripts/smoke.sh" "$run/tree" 2>&1 | tee "$run/smoke.log" >&2
  [[ ${PIPESTATUS[0]} -eq 0 ]] || return 1
}

for attempt in 1 2 3; do
  stage=sync
  if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
    git fetch -q origin main
    git merge -q --ff-only origin/main 2>/dev/null \
      || die "cannot fast-forward main to origin/main (local commits, or dirty files that origin changed). Reconcile first."
  fi
  base="$(git rev-parse HEAD)"
  stage=tree
  tree="$(make_tree)" || die "nothing shipped"
  [[ "$tree" != "$(git rev-parse HEAD^{tree})" ]] || { result=empty; die "nothing to ship: HEAD already has these paths as they are"; }
  run="$runs_dir/$(date -u +%Y%m%dT%H%M%SZ)-${tree:0:7}"
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
  stage=commit
  commit="$(printf '%s\n' "$msg" | git commit-tree "$tree" -p "$base")"
  git update-ref -m "ship: $msg" HEAD "$commit" "$base" || { log "HEAD moved while gating; again"; continue; }
  if [[ -n "$revert" ]]; then
    for f in $(git diff --name-only "$base" "$commit"); do
      git diff --quiet "$base" -- "$f" 2>/dev/null || continue
      if git cat-file -e "$commit:$f" 2>/dev/null; then git checkout "$commit" -- "$f"
      else git rm -q -f -- "$f" 2>/dev/null || true; fi
    done
  else
    git diff --name-only -z "$base" "$commit" | xargs -0 -r git reset -q --
  fi
  stage=push
  if SHIP_GATED=1 git push -q origin main 2>/dev/null; then
    result=green
    log "shipped ${commit:0:7} to origin/main (gate $((SECONDS - t0)) s). It deploys now (deploy.yml, ~45 s); CI gates run after it, and a red one rolls the site back and opens a trunk-red issue."
    find "$(dirname "$run")" -maxdepth 1 -name '2*' -mtime +3 -exec rm -rf {} + 2>/dev/null || true
    exit 0
  fi
  git update-ref HEAD "$base" "$commit"
  [[ -n "$revert" || ${#paths[@]} -eq 0 ]] || git reset -q -- "${paths[@]}"
  log "origin moved while gating; re-gating on the new trunk"
done
result=push
die "trunk kept moving; gave up after 3 tries (nothing committed)"
