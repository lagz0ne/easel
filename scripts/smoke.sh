#!/usr/bin/env bash
# The browser smoke: the BUILT binary, in a real browser (agent-browser), on the paths that matter most.
# It proves what unit and tests/browser cannot: the build, the embedded client, the server and the
# socket work together. It is the expensive check, so it holds only the critical paths (AGENTS.md,
# "Browser smoke"). Each flow costs seconds; add one only for a path users cannot work without.
#
# Usage: scripts/smoke.sh [dir]   dir = a tree with dist/server (default: this repo; built if missing)
# Output: one line per flow, then "smoke: OK" or "smoke: FAILED <flow>". Screenshot + log on failure
# go to $SMOKE_OUT (default: a temp dir, path printed).
set -euo pipefail
export PATH="$HOME/.bun/bin:$HOME/.npm-global/bin:$PATH"
dir="$(cd "${1:-$(git rev-parse --show-toplevel)}" && pwd)"
out="${SMOKE_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/easel-smoke.XXXXXX")}"
mkdir -p "$out"
command -v agent-browser >/dev/null || { echo "smoke: agent-browser is not installed (npm i -g agent-browser)" >&2; exit 1; }

if [[ ! -x "$dir/dist/server" ]]; then
  echo "smoke: building $dir (no dist/server)"
  (cd "$dir" && bun run build:client >/dev/null && bun run build:server >/dev/null)
fi

port="$(bun -e 'const s=Bun.serve({port:0,fetch:()=>new Response()});console.log(s.port);s.stop(true)')"
base="http://127.0.0.1:$port"
session="easel-smoke-$$"
AB=(agent-browser --session "$session")

# Telemetry goes to a closed port: the smoke judges the app, not the collector.
PORT="$port" PUBLIC_ORIGIN="$base" NODE_ENV=production EASEL_DB="$out/easel.db" OTEL_SERVICE_NAME=easel-smoke \
  VICTORIA_TRACES_URL=http://127.0.0.1:9/ VICTORIA_LOGS_URL=http://127.0.0.1:9/ \
  "$dir/dist/server" >"$out/server.log" 2>&1 &
server=$!
cleanup() {
  "${AB[@]}" close >/dev/null 2>&1 || true
  kill "$server" 2>/dev/null && wait "$server" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 100); do curl -fsS "$base/api/health" >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS "$base/api/health" >/dev/null || { echo "smoke: FAILED boot: no /api/health (log: $out/server.log)"; exit 1; }

flow=""
fail() {
  "${AB[@]}" screenshot "$out/$flow.png" >/dev/null 2>&1 || true
  "${AB[@]}" errors >"$out/$flow.errors.txt" 2>&1 || true
  echo "smoke: FAILED $flow: $1"
  echo "smoke: kept $out (screenshot, page errors, server.log)"
  exit 1
}
no_page_errors() {
  local e; e="$("${AB[@]}" errors --json 2>/dev/null || true)"
  jq -e '.data.errors | length == 0' <<<"$e" >/dev/null 2>&1 || fail "page errors: $e"
}

# 1. Boot: the page loads, hydrates, and its loader's rpc call returns.
flow=boot
t0=$SECONDS
"${AB[@]}" open "$base/" >/dev/null || fail "open /"
"${AB[@]}" wait --text "Hello, world." >/dev/null || fail "the greeting from greet.api never showed"
no_page_errors
echo "smoke: ok   boot ($((SECONDS - t0)) s)"

# 2. Live data: a write over the socket comes back in the live list, and the server keeps it.
flow=live-todo
t0=$SECONDS
title="smoke $$ $RANDOM"
"${AB[@]}" open "$base/todo" >/dev/null || fail "open /todo"
"${AB[@]}" find label "New todo" fill "$title" >/dev/null || fail "no 'New todo' input"
"${AB[@]}" find role button click --name "Add" >/dev/null || fail "no Add button"
"${AB[@]}" wait --text "$title" >/dev/null || fail "the added todo never came back on the live list"
"${AB[@]}" reload >/dev/null
"${AB[@]}" wait --text "$title" >/dev/null || fail "the todo was gone after a reload"
no_page_errors
echo "smoke: ok   live-todo ($((SECONDS - t0)) s)"

echo "smoke: OK"
[[ -n "${SMOKE_OUT:-}" ]] || rm -rf "$out"
