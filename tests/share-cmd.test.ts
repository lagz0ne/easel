import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "@tinkered/bun";
import { afterAll, expect, test } from "vite-plus/test";

type Server = typeof import("../cmds/server");
type Pages = typeof import("../cmds/pages");

const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);
const easelCmd: Server = await import(new URL("../cmds/easel.ts", import.meta.url).href);
const { pagesOf }: Pages = await import(new URL("../cmds/pages.ts", import.meta.url).href);

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

afterAll(() => collector.stop());

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

test("a password out of bounds is invalid on share.open and on canvas.share; a typed one on an unknown link is gone; none reaches the log", async () => {
  const app = await run();
  const raw = await socket(app.url.host);
  const link = "a".repeat(32);

  const invalid = JSON.stringify({ ok: false, kind: "invalid", payload: {} });
  expect(await raw.call("share.open", { link, name: "Bo", password: "" })).toBe(invalid);
  expect(await raw.call("canvas.share", { canvas: "home", password: "hunter2" })).toBe(invalid);
  expect(await raw.call("canvas.share", { canvas: "home", password: 12345678 })).toBe(invalid);
  const long = "x".repeat(1025);
  expect(await raw.call("share.open", { link, name: "Bo", password: long })).toBe(invalid);
  expect(await raw.call("canvas.share", { canvas: "home", password: long })).toBe(invalid);
  expect(await raw.call("share.open", { link: "not-a-link", name: "Bo" })).toBe(invalid);
  for (const input of [
    { link, name: "Bo" },
    { link, name: "Bo", password: "hunter2hunter2" },
  ]) {
    expect(JSON.parse(await raw.call("share.open", input))).toEqual({
      ok: true,
      value: { kind: "gone" },
    });
  }

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

test("easel share --password makes the link ask it, --no-password lets it open, and easel unshare ends it; none is printed", async () => {
  const app = await run();
  const home = mkdtempSync(join(tmpdir(), "easel-share-cmd-"));
  const at = app.url.origin;
  const code = /setup code: (\S+)/.exec(app.out.join(""))?.[1] ?? "";
  const pw = "correct horse";
  const raw = await socket(app.url.host);
  const open = async (link: string, password?: string) =>
    JSON.parse(
      await raw.call("share.open", { link, name: "Bo", ...(password ? { password } : {}) }),
    );

  expect((await easel(home, "login", at, "--name", "ann", "--setup", code)).code).toBe(0);
  expect((await easel(home, "canvas", "new", "Flow")).code).toBe(0);
  const first = await easel(home, "share", "flow", "--password", pw);
  expect(first.code).toBe(0);
  expect(first.out).toMatch(new RegExp(`^${at}/s/[0-9a-f]{32}\n$`));
  const link = first.out.trim().split("/s/")[1] ?? "";
  expect(await open(link)).toEqual({ ok: true, value: { kind: "locked" } });
  expect(await open(link, "not the password")).toEqual({ ok: true, value: { kind: "wrong" } });
  expect((await open(link, pw)).value.kind).toBe("open");

  expect(await easel(home, "share", "flow", "--no-password")).toEqual(first);
  expect((await open(link)).value.kind).toBe("open");

  expect(await easel(home, "unshare", "flow")).toEqual({
    code: 0,
    out: "flow is not shared: its link has ended\n",
  });
  expect(await open(link, pw)).toEqual({ ok: true, value: { kind: "gone" } });
  expect((await easel(home, "unshare", "nope")).code).toBe(1);
  const again = await easel(home, "share", "flow");
  expect(again.code).toBe(0);
  expect(again.out).not.toBe(first.out);

  raw.close();
  await app.close();
  const log = app.out.join("");
  expect(log).not.toContain(pw);
  expect(log).not.toContain(link);
  rmSync(home, { recursive: true, force: true });
}, 30_000);

test("easel share: a short --password, it with --no-password, no canvas, or a key that is no key is bad usage, 64, before any call", async () => {
  const home = mkdtempSync(join(tmpdir(), "easel-share-cmd-"));
  const at = ["--server", "localhost:9", "--json"];

  expect(await easel(home, "share", "flow", "--password", "hunter2", ...at)).toEqual({
    code: 64,
    out: `${JSON.stringify({ usage: "--password takes 8 to 1024 characters" })}\n`,
  });
  expect(
    await easel(home, "share", "flow", "--password", "hunter2hunter2", "--no-password", ...at),
  ).toEqual({
    code: 64,
    out: `${JSON.stringify({ usage: "--password and --no-password do not go together" })}\n`,
  });
  expect((await easel(home, "share", ...at)).code).toBe(64);
  expect((await easel(home, "share", "Not A Key", ...at)).code).toBe(64);
  expect((await easel(home, "share", "flow", "--password", ...at)).code).toBe(64);
  expect((await easel(home, "unshare", ...at)).code).toBe(64);
  expect((await easel(home, "unshare", "Not A Key", ...at)).code).toBe(64);
  const help = (await easel(home, "--help")).out;
  expect(help).toContain("easel share <canvas>");
  expect(help).toContain("easel unshare <canvas>");
  rmSync(home, { recursive: true, force: true });
});
