import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const [command, url] = process.argv.slice(2);

if (command === "login") {
  const home = process.env.XDG_CONFIG_HOME ?? "";
  mkdirSync(join(home, "easel"), { recursive: true });
  writeFileSync(
    join(home, "easel/hosts.json"),
    JSON.stringify({ hosts: { [url ?? ""]: { token: "fake-token" } } }),
  );
  process.exit(0);
}

const marks: string[] = [];
const versions = new Map<string, number>();
const count = { canvases: 0, pages: 0, frames: 0, asks: 0 };

const call = z.object({
  id: z.number(),
  params: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
});

const answers: Record<string, (args: Record<string, unknown>) => unknown> = {
  create_canvas: () => ({ key: `c${++count.canvases}` }),
  list_pages: (args) => ({ pages: [{ key: `${String(args.canvas)}-p1` }] }),
  create_page: (args) => ({ key: `${String(args.canvas)}-p${++count.pages + 1}` }),
  share_canvas: (args) => ({ path: `/s/${String(args.canvas)}` }),
  put_frame: (args) => {
    const id = typeof args.id === "string" ? args.id : `f${++count.frames}`;
    const version = typeof args.id === "string" ? (versions.get(id) ?? 1) + 1 : 1;
    versions.set(id, version);
    if (version > 1) marks.push(`easel:change:${id}:${version}`);
    return { id, version };
  },
};

const screens = Array.from(
  { length: 20 },
  (_, i) =>
    `<div role="group" aria-label="Screen ${i + 1}" class="e-shell" data-id="s${i}" style="height:60px;background:#ddd"></div>`,
).join("");

const page = (seen: number) => `<!doctype html><html><body style="margin:0">
<output aria-label="Zoom">10%</output>
<button>Request</button>
<input aria-label="Request"><input aria-label="Your name"><button aria-label="Send">Go</button>
<div aria-label="Frames" style="display:grid;grid-template-columns:repeat(5,100px);gap:8px">${screens}</div>
<div class="e-card" hidden></div>
<script>
performance.mark("easel:open");
const zoom = document.querySelector("output");
let seen = ${seen};
const poll = async () => {
  const got = await (await fetch("/marks?from=" + seen)).json();
  for (const name of got) performance.mark(name);
  seen += got.length;
  setTimeout(poll, 20);
};
poll();
document.querySelector("[aria-label=Send]").addEventListener("click", () => fetch("/ask", { method: "POST" }));
addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.code === "Equal") zoom.textContent = parseFloat(zoom.textContent) + 10 + "%";
});
</script></body></html>`;

process.stdout.write("setup code: fake-code\n");

Bun.serve({
  port: Number(process.env.PORT),
  fetch: async (request) => {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/api/health") return new Response("ok");
    if (pathname === "/marks") return Response.json(marks.slice(Number(searchParams.get("from"))));
    if (pathname.startsWith("/s/")) {
      return new Response(page(marks.length), { headers: { "content-type": "text/html" } });
    }
    if (pathname === "/ask") {
      marks.push(`easel:ask:${++count.asks}`);
      return new Response("ok");
    }

    const { id, params } = call.parse(await request.json());
    const answer = answers[params.name]?.(params.arguments);
    return Response.json({
      jsonrpc: "2.0",
      id,
      result: { structuredContent: answer, content: [] },
    });
  },
});
