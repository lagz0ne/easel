#!/usr/bin/env bash
# Check the statecharts (the oracle) and keep their pages in step with their models.
#
#   scripts/statecharts.sh [--check] [<chart-name>...]
#
# For each row of docs/statecharts/charts.tsv (or only the charts named), it runs the statechart
# generator on the chart's TLA+ model, checks that TLC's verdict is the row's `expect`
# (holds: exit 0, breaks: exit 1), and compares the generated chart.mmd with the ```mermaid block
# in docs/statecharts/<chart>.md.
#
#   (no flag)  rewrite a block that differs, in place.
#   --check    change nothing; exit 1 when a block differs or a verdict is not the expected one.
#
# It prints one line per chart: `<chart> ok`, `<chart> DIFF` or `<chart> BROKE`. Details go to
# stderr.
#
# charts.tsv: tab-separated `chart  tla  cfg  view  expect`, with paths relative to
# docs/statecharts. Blank lines, lines starting with `#`, and the header row are skipped.
#
# Needs the statechart skill from the hub (~/.claude/skills/statechart, or $STATECHART pointing
# at its scripts/statechart), and Bun or Node on PATH. Its first run installs TLC and Java with
# mise, so it needs the network once. scripts/ship.sh runs --check as a gate, on this host, for a
# ship that changes docs/statecharts/, a SPEC*.md or this script. CI does not: CI has no skill.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$root/docs/statecharts"
manifest="$dir/charts.tsv"
tool="${STATECHART:-$HOME/.claude/skills/statechart/scripts/statechart}"
export PATH="$HOME/.bun/bin:$PATH"

usage() { sed -n '4,4s/^#   //p' "${BASH_SOURCE[0]}"; }

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
  echo "statecharts: no generator at $tool; it comes from the hub's statechart skill" >&2
  exit 69
fi
if [[ ! -f "$manifest" ]]; then
  echo "statecharts: no manifest at ${manifest#"$root"/}" >&2
  exit 66
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The lines of the one ```mermaid block in a page, without its fences.
block() { awk '/^```mermaid[[:space:]]*$/ { inside = 1; next } inside && /^```[[:space:]]*$/ { exit } inside' "$1"; }
blocks() { grep -c '^```mermaid[[:space:]]*$' "$1" || true; }

# Replace the lines of the ```mermaid block in page $1 with the file $2.
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
