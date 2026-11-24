#!/usr/bin/env bash
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

chromium="$(cd "$dir" && bun -e 'import { localChromium } from "./tests/support/chromium"; console.log(localChromium() ?? "")')"
[[ -n "$chromium" ]] || { echo "smoke: no local Chromium for pictures (bunx playwright install chromium)" >&2; exit 1; }

port="$(bun -e 'const s=Bun.serve({port:0,fetch:()=>new Response()});console.log(s.port);s.stop(true)')"
base="http://127.0.0.1:$port"
session="easel-smoke-$$"
AB=(agent-browser --session "$session")

BUILD=1 PORT="$port" PUBLIC_ORIGIN="$base" NODE_ENV=production EASEL_DB="$out/easel.db" EASEL_CHROMIUM="$chromium" OTEL_SERVICE_NAME=easel-smoke \
  "$dir/dist/server" serve >"$out/server.log" 2>&1 &
server=$!
cleanup() {
  "${AB[@]}" close >/dev/null 2>&1 || true
  kill "$server" 2>/dev/null && wait "$server" 2>/dev/null || true
}
trap cleanup EXIT

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

flow=boot
t0=$SECONDS
"${AB[@]}" open "$base/" >/dev/null || fail "open /"
"${AB[@]}" wait --text "Sign in to easel" >/dev/null || fail "the sign-in page (users.me refused) never showed"
no_page_errors
echo "smoke: ok   boot ($((SECONDS - t0)) s)"

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

flow=canvas
t0=$SECONDS
easel() { HOME="$out/home" EASEL_CONFIG_HOME="$out/home/.config" XDG_CONFIG_HOME="$out/home/.config" "$dir/dist/server" "$@"; }
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
opened="$(easel open --no-browser --json 2>/dev/null)" || fail "easel open"
"${AB[@]}" open "$(jq -r .url <<<"$opened")" >/dev/null || fail "open the sign-in link"
"${AB[@]}" wait --text "Sign in as smoke" >/dev/null || fail "the sign-in link never named its user"
"${AB[@]}" find role button click --name "Sign in as" >/dev/null || fail "the sign-in link asked for no click"
"${AB[@]}" wait --text "Canvases" >/dev/null || fail "the sign-in link did not open the home page"
"${AB[@]}" wait --fn '[...document.querySelectorAll("a")].some((a) => a.textContent.includes("Smoke"))' >/dev/null ||
  fail "the home page never listed the canvas Smoke"
"${AB[@]}" find role link click --name "Smoke" >/dev/null || fail "no row Smoke on the home page"
"${AB[@]}" wait --text "Smoke one" >/dev/null || fail "the canvas did not open from the home page"
"${AB[@]}" find role link click --name "Back to the canvases" >/dev/null || fail "no back button on the canvas"
"${AB[@]}" wait --text "Canvases" >/dev/null || fail "the back button did not go to the home page"
link="$(easel share smoke 2>/dev/null)" || fail "easel share"
"${AB[@]}" open "$link" >/dev/null || fail "open the share link"
"${AB[@]}" wait --text "Smoke one" >/dev/null || fail "the frame's shell never showed"
"${AB[@]}" wait --fn 'document.querySelector("img.e-pic")?.complete && document.querySelector("img.e-pic").naturalWidth > 0' >/dev/null ||
  fail "the frame's shell never showed its picture"
"${AB[@]}" click ".e-dock-zoom" >/dev/null || fail "no Zoom button"
"${AB[@]}" find text "Zoom to fit" click >/dev/null || fail "no Zoom to fit in the Zoom menu"
"${AB[@]}" wait --fn 'document.querySelector("iframe[sandbox=\"allow-scripts\"]") !== null' >/dev/null ||
  fail "the frame's document never went live at rest"
"${AB[@]}" wait --fn 'document.querySelector("iframe[sandbox=\"allow-scripts\"]")?.srcdoc.includes("<style id=\"easel-look\">@font-face {\n  font-family: \"Geist\";")' >/dev/null ||
  fail "the frame's live document is not in the look of the kit"
zoom='document.querySelector("output[aria-label=Zoom]")?.textContent'
world='document.querySelector(".e-world")?.style.transform'
"${AB[@]}" eval "window.smokeZoom = $zoom" >/dev/null || fail "no Zoom status"
"${AB[@]}" press "Control+=" >/dev/null || fail "no key press"
"${AB[@]}" wait --fn "$zoom !== window.smokeZoom" >/dev/null || fail "Ctrl + did not change the Zoom status"
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
