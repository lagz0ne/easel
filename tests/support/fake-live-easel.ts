import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const [command, first, second] = process.argv.slice(2);
const hostsFile = join(process.env.XDG_CONFIG_HOME ?? "", "easel/hosts.json");
const hosts = z.object({ hosts: z.record(z.string(), z.object({ token: z.string() })) });

if (command === "login") {
  mkdirSync(join(process.env.XDG_CONFIG_HOME ?? "", "easel"), { recursive: true });
  writeFileSync(hostsFile, JSON.stringify({ hosts: { [first ?? ""]: { token: "fake-token" } } }));
  process.exit(0);
}

if (command === "agree") {
  const [url = ""] = Object.keys(hosts.parse(JSON.parse(readFileSync(hostsFile, "utf8"))).hosts);
  const agreed = await fetch(`${url}/agree/${second}`, { method: "POST" });
  process.exit(agreed.ok ? 0 : 1);
}

type Ask = {
  n: number;
  frame: string;
  text: string;
  name: string;
  x: number;
  y: number;
  state: "open" | "agreed" | "answered" | "accepted" | "reopened";
  answer: string;
  note: string;
};

const frames: Array<{ name: string; w: number; h: number }> = [];
const asks: Ask[] = [];

const call = z.object({
  id: z.number(),
  params: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
});

const putFrame = z.object({ name: z.string(), size: z.object({ w: z.number(), h: z.number() }) });
const resolved = z.object({ claim: z.string(), text: z.string() });

const asked = z.object({
  frame: z.string(),
  text: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
});

const noted = z.object({ note: z.string() });

const tools: Record<string, (args: Record<string, unknown>) => unknown> = {
  create_canvas: () => ({ key: "shop" }),
  put_frame: (args) => {
    const { name, size } = putFrame.parse(args);
    frames.push({ name, ...size });
    return { id: `f${frames.length}`, version: 1 };
  },
  share_canvas: () => ({ path: "/s/shop" }),
  next_request: (args) => ({ claim: `claim-${Number(args.n)}` }),
  resolve_request: (args) => {
    const { claim, text } = resolved.parse(args);
    const ask = asks.find((each) => `claim-${each.n}` === claim);
    if (ask) Object.assign(ask, { state: "answered", answer: text });
    return { resolved: true };
  },
};

const page = () => `<!doctype html><html><head><meta charset="utf-8"><title>Shop redesign</title>
<style>
body{margin:0;font:14px sans-serif;color:#1f1f1d;background:#fafaf9}
header{display:flex;gap:8px;padding:8px}
.frames{display:flex;gap:16px;padding:16px;align-items:flex-start}
[role=group]{position:relative;border:1px solid #d4d4d0;background:#fff}
.e-pin{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:0;border:0;padding:0;background:#2563eb;color:#fff;font-size:10px}
#panel{padding:16px;display:grid;gap:8px;max-width:360px}
</style></head><body>
<header><button id="ask">Request</button><button id="list">Requests (${asks.length})</button></header>
<div class="frames" id="frames"></div>
<div id="panel"></div>
<script>
let asks = ${JSON.stringify(asks)};
const frames = ${JSON.stringify(frames)};
const ui = { mode: "idle", spot: null, text: "", listed: false, open: location.hash.startsWith("#request-") ? Number(location.hash.slice(9)) : null, noting: false };
const post = async (path, body) => {
  const answer = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  asks = await answer.json();
  draw();
};
const pins = (f) => asks.filter((a) => a.frame === f.name).map((a) => '<button class="e-pin" aria-label="Request #' + a.n + '" style="left:' + Math.round((a.x * f.w) / 2) + "px;top:" + Math.round((a.y * f.h) / 2) + 'px">' + a.n + "</button>").join("");
const card = (a) => {
  const lines = ['<p class="e-when">just now</p>', "<p>" + a.name + ": " + a.text + "</p>"];
  if (a.answer) lines.push("<p>" + a.answer + "</p>");
  if (a.state === "answered") lines.push('<button data-do="accept">Accept</button>');
  if (a.state === "accepted" || a.state === "reopened") lines.push("<p>" + a.name + " accepted the result</p>");
  if (a.state === "accepted" && !ui.noting) lines.push('<button data-do="again">Open again</button>');
  if (a.state === "accepted" && ui.noting) lines.push('<textarea aria-label="Note"></textarea><button data-do="note">Send</button>');
  if (a.state === "reopened") lines.push("<p>" + a.name + " opened it again</p><p>" + a.note + "</p>");
  return '<section role="region" aria-label="Request #' + a.n + '">' + lines.join("") + "</section>";
};
const draw = () => {
  document.getElementById("list").textContent = "Requests (" + asks.length + ")";
  document.getElementById("frames").innerHTML = frames.map((f) => '<div role="group" aria-label="' + f.name + '" style="width:' + f.w / 2 + "px;height:" + f.h / 2 + 'px">' + pins(f) + "</div>").join("");
  const parts = [];
  if (ui.mode === "compose") parts.push('<textarea aria-label="Request"></textarea><button data-do="send">Send</button>');
  if (ui.mode === "name") parts.push('<input aria-label="Your name"><button data-do="named">Send</button>');
  if (ui.listed) parts.push("<h2>Requests</h2>" + asks.map((a) => '<button data-open="' + a.n + '">#' + a.n + " " + a.text + "</button>").join(""));
  const open = asks.find((a) => a.n === ui.open);
  if (open) parts.push(card(open));
  document.getElementById("panel").innerHTML = parts.join("");
};
document.getElementById("ask").addEventListener("click", () => { ui.mode = "pick"; });
const fresh = async () => { asks = await (await fetch("/state")).json(); };
document.getElementById("list").addEventListener("click", async () => { await fresh(); ui.listed = true; draw(); });
document.getElementById("frames").addEventListener("click", (event) => {
  const shell = event.target.closest("[role=group]");
  if (ui.mode !== "pick" || !shell) return;
  const box = shell.getBoundingClientRect();
  ui.spot = { frame: shell.getAttribute("aria-label"), x: Math.round(((event.clientX - box.left) / box.width) * 100) / 100, y: Math.round(((event.clientY - box.top) / box.height) * 100) / 100 };
  ui.mode = "compose";
  draw();
});
const ask = async () => {
  ui.mode = "idle";
  await post("/ask", { ...ui.spot, text: ui.text, name: localStorage.getItem("name") });
};
document.getElementById("panel").addEventListener("click", async (event) => {
  const opened = event.target.getAttribute("data-open");
  if (opened) { await fresh(); ui.open = Number(opened); ui.noting = false; draw(); return; }
  const act = event.target.getAttribute("data-do");
  if (act === "send") {
    ui.text = document.querySelector("[aria-label=Request]").value;
    if (localStorage.getItem("name")) await ask(); else { ui.mode = "name"; draw(); }
  }
  if (act === "named") { localStorage.setItem("name", document.querySelector("[aria-label='Your name']").value); await ask(); }
  if (act === "accept") await post("/accept/" + ui.open);
  if (act === "again") { ui.noting = true; draw(); }
  if (act === "note") { const note = document.querySelector("[aria-label=Note]").value; ui.noting = false; await post("/reopen/" + ui.open, { note }); }
});
draw();
performance.mark("easel:open");
</script></body></html>`;

const moves: Record<string, (ask: Ask, body: unknown) => Partial<Ask>> = {
  agree: () => ({ state: "agreed" }),
  accept: () => ({ state: "accepted" }),
  reopen: (_, body) => ({ state: "reopened", note: noted.parse(body).note }),
};

process.stdout.write("setup code: fake-code\n");

Bun.serve({
  port: Number(process.env.PORT),
  routes: {
    "/api/health": new Response("ok"),
    "/state": () => Response.json(asks),
    "/s/:key": () => new Response(page(), { headers: { "content-type": "text/html" } }),
    "/ask": async (request) => {
      const told = asked.parse(await request.json());
      asks.push({ ...told, n: asks.length + 1, state: "open", answer: "", note: "" });
      return Response.json(asks);
    },
    "/:move/:n": async (request) => {
      const ask = asks.find((each) => each.n === Number(request.params.n));
      const step = moves[request.params.move];
      if (!ask || !step) return new Response("no such request", { status: 404 });

      Object.assign(ask, step(ask, await request.json().catch(() => ({}))));
      return Response.json(asks);
    },
    "/mcp": async (request) => {
      const { id, params } = call.parse(await request.json());
      const answer = tools[params.name]?.(params.arguments);
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: { structuredContent: answer, content: [] },
      });
    },
  },
});
