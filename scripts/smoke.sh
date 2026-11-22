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

# Pictures draw with the Chromium on this machine: Playwright's headless shell for the browser tests
# (tests/support/chromium.ts finds it). Nothing is downloaded.
chromium="$(cd "$dir" && bun -e 'import { localChromium } from "./tests/support/chromium"; console.log(localChromium() ?? "")')"
[[ -n "$chromium" ]] || { echo "smoke: no local Chromium for pictures (bunx playwright install chromium)" >&2; exit 1; }

port="$(bun -e 'const s=Bun.serve({port:0,fetch:()=>new Response()});console.log(s.port);s.stop(true)')"
base="http://127.0.0.1:$port"
session="easel-smoke-$$"
AB=(agent-browser --session "$session")

# No VICTORIA_* URL: the built server starts without Victoria and exports nothing
# (SPEC-ops.md fact rule 4); the smoke judges the app, not the collector.
BUILD=1 PORT="$port" PUBLIC_ORIGIN="$base" NODE_ENV=production EASEL_DB="$out/easel.db" EASEL_CHROMIUM="$chromium" OTEL_SERVICE_NAME=easel-smoke \
  "$dir/dist/server" serve >"$out/server.log" 2>&1 &
server=$!
cleanup() {
  "${AB[@]}" close >/dev/null 2>&1 || true
  kill "$server" 2>/dev/null && wait "$server" 2>/dev/null || true
}
trap cleanup EXIT

# Up to 30 s: on a busy host (load 20 on 8 cores) the boot has taken over 10 s.
for _ in $(seq 300); do curl -fsS "$base/api/health" >/dev/null 2>&1 && break; sleep 0.1; done
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

# 3. The canvas: an agent's frames, opened by share link, draw as shells with a live, sandboxed
#    document at rest in the look of the kit, Fit works, Zoom in zooms, a drag pans, and a frame
#    the agent puts while the tab is open shows. A shell shows its picture, drawn by Chromium, and
#    `easel shot` writes one.
#    The setup code and the link stay in variables: neither is printed, nor is a picture's key.
flow=canvas
t0=$SECONDS
easel() { HOME="$out/home" "$dir/dist/server" "$@"; }
mkdir -p "$out/home"
code="$(grep -oE 'setup code: [^[:space:]]+' "$out/server.log" | head -1 | cut -d' ' -f3)"
[[ -n "$code" ]] || fail "no setup code in the server log"
easel login "$base" --name smoke --setup "$code" >/dev/null 2>&1 || fail "easel login --setup"
easel canvas new "Smoke" >/dev/null 2>&1 || fail "easel canvas new"
made="$(echo '<p style="background:#c00">first</p>' | easel put smoke - --name "Smoke one" --json 2>/dev/null)" ||
  fail "easel put"
id="$(jq -r .id <<<"$made")"
easel shot smoke "$id" -o "$out/shot.webp" --scale 0.5 >/dev/null 2>&1 || fail "easel shot"
[[ "$(head -c 4 "$out/shot.webp")" == RIFF && "$(tail -c +9 "$out/shot.webp" | head -c 4)" == WEBP ]] ||
  fail "easel shot wrote no WebP"
link="$(easel share smoke 2>/dev/null)" || fail "easel share"
"${AB[@]}" open "$link" >/dev/null || fail "open the share link"
"${AB[@]}" wait --text "Smoke one" >/dev/null || fail "the frame's shell never showed"
"${AB[@]}" wait --fn 'document.querySelector("img.e-pic")?.complete && document.querySelector("img.e-pic").naturalWidth > 0' >/dev/null ||
  fail "the frame's shell never showed its picture"
"${AB[@]}" find role button click --name "Fit" >/dev/null || fail "no Fit button"
"${AB[@]}" wait --fn 'document.querySelector("iframe[sandbox=\"allow-scripts\"]") !== null' >/dev/null ||
  fail "the frame's document never went live at rest"
# The live document is composed with the kit (SPEC-kit.md § compose): the look and the kit's CSS
# came over the socket in the board's cell `kit`, and the frame's made CSS with its document.
"${AB[@]}" wait --fn 'document.querySelector("iframe[sandbox=\"allow-scripts\"]")?.srcdoc.includes("<style id=\"easel-look\">:root {")' >/dev/null ||
  fail "the frame's live document is not in the look of the kit"
zoom='document.querySelector("output[aria-label=Zoom]")?.textContent'
world='document.querySelector(".e-world")?.style.transform'
"${AB[@]}" eval "window.smokeZoom = $zoom" >/dev/null || fail "no Zoom status"
"${AB[@]}" find role button click --name "Zoom in" >/dev/null || fail "no Zoom in button"
"${AB[@]}" wait --fn "$zoom !== window.smokeZoom" >/dev/null || fail "Zoom in did not change the Zoom status"
"${AB[@]}" eval "window.smokeWorld = $world" >/dev/null || fail "no world to move"
"${AB[@]}" mouse move 400 300 >/dev/null && "${AB[@]}" mouse down >/dev/null &&
  "${AB[@]}" mouse move 520 360 >/dev/null && "${AB[@]}" mouse up >/dev/null || fail "the drag"
"${AB[@]}" wait --fn "$world !== window.smokeWorld" >/dev/null || fail "a drag did not pan the canvas"
echo '<p>second</p>' | easel put smoke - --name "Smoke two" >/dev/null 2>&1 || fail "easel put while open"
"${AB[@]}" wait --text "Smoke two" >/dev/null || fail "the agent's new frame never showed"
no_page_errors
echo "smoke: ok   canvas ($((SECONDS - t0)) s)"

echo "smoke: OK"
[[ -n "${SMOKE_OUT:-}" ]] || rm -rf "$out"
