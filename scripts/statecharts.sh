#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/docs/statecharts"
manifest="$dir/charts.tsv"
tool="${STATECHART:-$root/vendor/statechart/statechart}"
export PATH="$HOME/.bun/bin:$PATH"

usage() {
  cat <<'USAGE'
scripts/statecharts.sh [--check] [<chart-name>...]
  (no flag)  rewrite each chart block in docs/statecharts/<chart>.md that differs from its model.
  --check    change nothing; exit 1 when a block differs or a verdict is not the expected one.
USAGE
}

check=0
declare -A wanted=()
for arg in "$@"; do
  case "$arg" in
    --check) check=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "statecharts: unknown flag $arg" >&2
      usage >&2
      exit 64
      ;;
    *) wanted["$arg"]=1 ;;
  esac
done

if [[ ! -x "$tool" ]]; then
  echo "statecharts: no generator at $tool; run scripts/statechart-sync.sh" >&2
  exit 69
fi
tlc="$(bash "$root/scripts/tlc.sh")" || {
  echo "statecharts: no Java and TLC; scripts/tlc.sh failed" >&2
  exit 69
}
while IFS='=' read -r k v; do export "$k=$v"; done <<<"$tlc"
if [[ ! -f "$manifest" ]]; then
  echo "statecharts: no manifest at ${manifest#"$root"/}" >&2
  exit 66
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

block() { awk '/^```mermaid[[:space:]]*$/ { inside = 1; next } inside && /^```[[:space:]]*$/ { exit } inside' "$1"; }
blocks() { grep -c '^```mermaid[[:space:]]*$' "$1" || true; }

rewrite() {
  CHART="$2" awk '
    /^```mermaid[[:space:]]*$/ && !done { print; while ((getline line < ENVIRON["CHART"]) > 0) print line; skip = 1; next }
    skip && /^```[[:space:]]*$/ { skip = 0; done = 1 }
    !skip { print }
  ' "$1" >"$tmp/page"
  cat "$tmp/page" >"$1"
}

failed=0
count=0
declare -A seen=()

broke() {
  echo "$1 BROKE"
  echo "  $1: $2" >&2
  failed=1
}

while IFS=$'\t' read -r chart tla cfg view expect _ <&3; do
  [[ -z "${chart// /}" || "$chart" == \#* || "$chart" == chart ]] && continue
  if ((${#wanted[@]} > 0)) && [[ -z "${wanted[$chart]:-}" ]]; then continue; fi
  seen["$chart"]=1
  count=$((count + 1))

  if [[ -z "$tla" || -z "$cfg" || -z "$view" ]]; then
    broke "$chart" "charts.tsv: the row needs chart, tla, cfg, view and expect"
    continue
  fi
  case "$expect" in
    holds) want=0 ;;
    breaks) want=1 ;;
    *)
      broke "$chart" "charts.tsv: expect is '$expect', not holds or breaks"
      continue
      ;;
  esac

  page="$dir/$chart.md"
  if [[ ! -f "$page" ]]; then
    broke "$chart" "no page at ${page#"$root"/}"
    continue
  fi
  if [[ "$(blocks "$page")" != 1 ]]; then
    broke "$chart" "${page#"$root"/} needs exactly one \`\`\`mermaid block"
    continue
  fi

  out="$tmp/$chart"
  status=0
  "$tool" "$dir/$tla" --config "$dir/$cfg" --view "$dir/$view" --out "$out" \
    </dev/null >"$tmp/$chart.log" 2>&1 || status=$?
  if [[ "$status" != "$want" ]]; then
    broke "$chart" "the generator exited $status; expected $want ($expect)"
    tail -n 20 "$tmp/$chart.log" | sed 's/^/    /' >&2
    continue
  fi
  if [[ ! -f "$out/chart.mmd" ]]; then
    broke "$chart" "no chart.mmd (over 500 states with no rule broken); make the model smaller"
    continue
  fi

  if [[ "$(block "$page")" == "$(cat "$out/chart.mmd")" ]]; then
    echo "$chart ok"
    continue
  fi

  echo "$chart DIFF"
  if ((check)); then
    diff -u --label "${page#"$root"/}" --label generated <(block "$page") "$out/chart.mmd" |
      head -n 40 | sed 's/^/    /' >&2 || true
    failed=1
  else
    rewrite "$page" "$out/chart.mmd"
    echo "  $chart: rewrote the block in ${page#"$root"/}" >&2
  fi
done 3<"$manifest"

for name in "${!wanted[@]}"; do
  [[ -n "${seen[$name]:-}" ]] || broke "$name" "not in charts.tsv"
done

if ((count == 0)) && ((${#wanted[@]} == 0)); then
  echo "statecharts: charts.tsv lists no charts" >&2
fi

exit "$failed"
