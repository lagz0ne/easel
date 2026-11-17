import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "@tinkered/bun";
import { afterAll, expect, test } from "vite-plus/test";

type Server = typeof import("../cmds/server");
type Pages = typeof import("../cmds/pages");

// Share in the real commands: the server on its own port, and `easel` in this process. A raw
// socket sends as any client may: a password is `invalid` until passwords are built (SPEC-frames
// § Inputs). `easel share` prints the link's page on its server (decision C4), and every page says
// `Referrer-Policy: no-referrer` (judged rule 15, decision C11).

/** The real commands and pages, run in this process; the lint bans a static parent import. */
const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);
const easelCmd: Server = await import(new URL("../cmds/easel.ts", import.meta.url).href);
const { pagesOf }: Pages = await import(new URL("../cmds/pages.ts", import.meta.url).href);

/** Takes the telemetry the command sends, so nothing leaves this machine. */
const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

afterAll(() => collector.stop());

/** Runs the command; its log lines are kept. */
async function run() {
  const stop = new AbortController();
  const out: string[] = [];
  const root = await server.default({
    env: {
      PORT: "0",
      OTEL_SERVICE_NAME: "share-cmd-test",
      VICTORIA_TRACES_URL: `${collector.url}traces`,
      VICTORIA_LOGS_URL: `${collector.url}logs`,
    },
    args: [],
    cwd: process.cwd(),
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (_, reason) => stop.abort(reason),
  });
  if (!("resolve" in root)) throw new Error("the command did not start");
  const url = root.resolve(serve.url).get() ?? new URL("http://localhost:0");
  const close = async () => (stop.abort(), await root.closed);

  return { url, out, close };
}

/** `easel` with these words, in its own home: its exit code and what it printed. */
async function easel(home: string, ...args: string[]) {
  const out: string[] = [];
  const codes: number[] = [];
  const stop = new AbortController();
  const app = await easelCmd.default({
    env: { HOME: home },
    args,
    cwd: process.cwd(),
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code) => (codes.push(code), stop.abort()),
  });
  await app.closed;

  return { code: codes[0], out: out.join("") };
}

/** A raw socket to `host`: each call is one frame, answered as the server wrote it. */
async function socket(host: string) {
  const ws = new WebSocket(`ws://${host}/rpc`);
  const replies = new Map<number, (text: string) => void>();
  ws.onmessage = (event) => {
    for (const reply of JSON.parse(String(event.data))) replies.get(reply.i)?.(reply.t);
  };
  await new Promise((done) => (ws.onopen = done));
  let next = 0;
  const call = (address: string, input: unknown) =>
    new Promise<string>((done) => {
      const i = ++next;
      replies.set(i, done);
      ws.send(JSON.stringify([{ i, a: address, t: JSON.stringify(input) }]));
    });

  return { call, close: () => ws.close() };
}

test("a password is invalid on share.open and on canvas.share, and the answer carries no link", async () => {
  const app = await run();
  const raw = await socket(app.url.host);
  const link = "a".repeat(32);

  const invalid = JSON.stringify({ ok: false, kind: "invalid", payload: {} });
  expect(await raw.call("share.open", { link, name: "Bo", password: "hunter2" })).toBe(invalid);
  // Before any token: the input is read before the guard, so no password reaches a user check.
  expect(await raw.call("canvas.share", { canvas: "home", password: "hunter2" })).toBe(invalid);
  expect(await raw.call("share.open", { link: "not-a-link", name: "Bo" })).toBe(invalid);
  // Well formed and unknown: gone, as an ended link is.
  expect(JSON.parse(await raw.call("share.open", { link, name: "Bo" }))).toEqual({
    ok: true,
    value: { kind: "gone" },
  });

  raw.close();
  await app.close();
  const log = app.out.join("");
  expect(log).not.toContain(link);
  expect(log).not.toContain("hunter2");
});

test("every page and file the binary serves says Referrer-Policy: no-referrer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "easel-pages-"));
  const index = join(dir, "index.html");
  const asset = join(dir, "app.js");
  await writeFile(index, "<!doctype html>");
  await writeFile(asset, "");
  const routes = pagesOf.parse({ "/index.html": index, "/assets/app.js": asset });

  expect(Object.keys(routes).toSorted()).toEqual(["/*", "/assets/app.js", "/index.html"]);
  for (const response of Object.values(routes)) {
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  }
  expect(routes["/assets/app.js"]?.headers.get("cache-control")).toContain("immutable");
  expect(routes["/*"]?.headers.get("cache-control")).toBeNull();

  await rm(dir, { recursive: true });
});

test("the page itself asks for no referrer, so a link to elsewhere never carries /s/<link>", async () => {
  const html = await readFile(new URL("../cmds/index.html", import.meta.url), "utf8");
  expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/);
});

test("easel share prints <server>/s/<link> from the real server, the same each time", async () => {
  const app = await run();
  const home = mkdtempSync(join(tmpdir(), "easel-share-cmd-"));
  const at = app.url.origin;
  const code = /setup code: (\S+)/.exec(app.out.join(""))?.[1] ?? "";

  expect((await easel(home, "login", at, "--name", "ann", "--setup", code)).code).toBe(0);
  expect((await easel(home, "canvas", "new", "Flow")).code).toBe(0);
  const first = await easel(home, "share", "flow");
  expect(first.code).toBe(0);
  expect(first.out).toMatch(new RegExp(`^${at}/s/[0-9a-f]{32}\n$`));
  expect(await easel(home, "share", "flow")).toEqual(first);
  expect((await easel(home, "share", "nope")).code).toBe(1);

  await app.close();
  const link = first.out.trim().split("/s/")[1] ?? "";
  expect(app.out.join("")).not.toContain(link);
  rmSync(home, { recursive: true, force: true });
}, 30_000);

test("easel share: --password, no canvas, or a key that is no key is bad usage, 64, before any call", async () => {
  const home = mkdtempSync(join(tmpdir(), "easel-share-cmd-"));
  // Port 9 has no server: a run that called it would exit 69, not 64.
  const at = ["--server", "localhost:9", "--json"];

  expect(await easel(home, "share", "flow", "--password", "hunter2", ...at)).toEqual({
    code: 64,
    out: `${JSON.stringify({ usage: "--password is not built yet: a share link opens for anyone who has it" })}\n`,
  });
  expect((await easel(home, "share", ...at)).code).toBe(64);
  expect((await easel(home, "share", "Not A Key", ...at)).code).toBe(64);
  expect((await easel(home, "share", "flow", "--password", ...at)).code).toBe(64);
  expect((await easel(home, "--help")).out).toContain("easel share <canvas>");
  rmSync(home, { recursive: true, force: true });
});
