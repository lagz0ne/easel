import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import type { PartsCommand } from "@/cli/parts";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { parts } from "@/parts";
import { partsApi } from "@/parts/contract";
import { partsOps, partsServer } from "@/parts/ops.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";
const count = "cw8rv3bcji";

const page = (body: string, head = "") =>
  `<!doctype html>\n<html><head><meta name="easel-kit" content="off">\n${head}</head>\n<body>\n${body}\n</body></html>`;

const main = page(
  `<span class="count" data-doop-prop="value" data-doop-part="lyrk" data-doop-component="${count}">3</span>`,
  `<style data-doop-component-source="${count}">\n.count {display:inline-flex}\n</style>\n`,
);

const copy = page(
  `<span class="count" data-doop-instance="${count}" data-doop-rev="2" data-doop-id="tqhcbt" data-doop-props="{&quot;value&quot;:&quot;4&quot;}">4</span>`,
);

const serverBug = () => {
  throw new Error("a bug on the server");
};

const brokenList = operation({
  label: "test.brokenPartsList",
  input: partsApi["parts.list"].input,
  run: serverBug,
});

const brokenPublish = operation({
  label: "test.brokenPartsPublish",
  input: partsApi["parts.publish"].input,
  run: serverBug,
});

const brokenShow = operation({
  label: "test.brokenPartsShow",
  input: partsApi["parts.show"].input,
  run: serverBug,
});

async function boot(options: { broken?: boolean } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const implement = options.broken
    ? {
        "parts.list": brokenList,
        "parts.publish": brokenPublish,
        "parts.show": brokenShow,
      }
    : partsOps;
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      partsServer,
      parts.api({ implement, onStart: [user] }),
      memory.server({ services: [access.login, access.user, access.owner, frames.api, parts.api] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function easel(srv: Srv, json: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-parts-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const scope = await createScope({
    clock: srv.clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({
        peer: srv.server,
        headers: { "x-easel-peer": "198.51.100.1" },
        meta: cli.bearer,
      }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      parts.api({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());

  const run = (command: PartsCommand) =>
    scope.run(cli.run, { input: { kind: "parts", act: command } });
  const text = () => out.splice(0).join("");
  const login = async () => {
    const input = { kind: "login" as const, name: "ann", setup: srv.setupCode(), noWait: false };
    expect(await scope.run(cli.run, { input })).toBe(0);
    out.splice(0);
  };
  const put = async (canvas: string, html: string, name: string) => {
    await scope.run(frames.api["canvas.create"], { input: { name: canvas } });
    const answer = await scope.run(frames.api["frame.put"], { input: { canvas, html, name } });
    if (answer.kind !== "created") throw new Error(`put ${name}: ${answer.kind}`);
    return answer.id;
  };

  return { dir, err, run, text, login, put };
}

test("parts publish, parts and parts show print the parts, their copies and the document with its parts", async () => {
  const srv = await boot();
  const a = await easel(srv, false);
  await a.login();
  expect(await a.run({ kind: "ls" })).toBe(0);
  expect(a.text()).toBe(
    "no part: easel parts publish <canvas> makes them\ndesign revision 0, kit version 1\n",
  );

  const source = await a.put("design-system", main, "Count");
  const used = await a.put("product", copy, "Inbox");
  expect(await a.run({ kind: "publish", canvas: "design-system" })).toBe(0);
  expect(a.text()).toBe("updated: Count rev 2; design revision 1, kit version 2\n");
  expect(await a.run({ kind: "publish", canvas: "product" })).toBe(0);
  expect(a.text()).toBe("unchanged: no main on this canvas; design revision 1, kit version 2\n");
  expect(await a.run({ kind: "publish", canvas: "nope" })).toBe(1);
  expect(a.err.splice(0).join("")).toBe("no canvas nope\n");

  expect(await a.run({ kind: "ls" })).toBe(0);
  expect(a.text()).toBe(
    [
      `${count}  Count  rev 2  main design-system/${source} v1`,
      `  product/${used} 1 linked`,
      "design revision 1, kit version 2",
      "",
    ].join("\n"),
  );

  expect(await a.run({ kind: "show", canvas: "product", id: used })).toBe(0);
  expect(a.text()).toContain('data-doop-rev="2"');
  const file = join(a.dir, "inbox.html");
  expect(await a.run({ kind: "show", canvas: "product", id: used, out: file })).toBe(0);
  expect(a.text()).toBe(`${used} v1 with the parts of kit version 2 written to ${file}\n`);
  expect(readFileSync(file, "utf8")).toContain(".count:where(");
  expect(await a.run({ kind: "show", canvas: "product", id: "000000000000" })).toBe(1);
  expect(a.err.splice(0).join("")).toBe("no frame 000000000000 on product\n");
});

test("an edited copy shows in parts with its count", async () => {
  const srv = await boot();
  const a = await easel(srv, false);
  await a.login();
  await a.put("design-system", main, "Count");
  const used = await a.put("product", copy.replace(">4</span>", "><b>4</b></span>"), "Inbox");
  await a.run({ kind: "publish", canvas: "design-system" });
  a.text();

  expect(await a.run({ kind: "ls" })).toBe(0);
  expect(a.text()).toContain(`  product/${used} 0 linked, 1 edited\n`);
});

test("a fault of the server exits 70 for each parts command", async () => {
  const srv = await boot({ broken: true });
  const a = await easel(srv, false);
  await a.login();
  const commands: PartsCommand[] = [
    { kind: "ls" },
    { kind: "publish", canvas: "product" },
    { kind: "show", canvas: "product", id: "000000000000" },
  ];
  for (const command of commands) {
    expect(await a.run(command)).toBe(70);
    expect(a.err.splice(0).join("")).toMatch(/^the server failed \(trace /);
  }
});

type Cmd = typeof import("../cmds/easel");

const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

async function command(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-parts-main-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const codes: number[] = [];
  const stop = new AbortController();
  const app = await easelCmd.default({
    env: { HOME: dir },
    args,
    cwd: dir,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code) => (codes.push(code), stop.abort()),
  });
  await app.closed;

  return { code: codes[0], out: out.join("") };
}

test("the easel command reads parts, parts publish <canvas> and parts show <canvas> <id> -o; --help names them", async () => {
  const noServer = `${JSON.stringify({ usage: "no server: run `easel login <server> --name <name>`, or pass --server" })}\n`;
  for (const args of [
    ["parts"],
    ["parts", "publish", "design-system"],
    ["parts", "show", "product", "000000000000", "-o", "f.html"],
  ]) {
    expect(await command([...args, "--json"])).toEqual({ code: 64, out: noServer });
  }
  expect(await command(["parts", "publish", "--json"])).toEqual({
    code: 64,
    out: expect.stringMatching(/^\{"usage":"(?!no server)/),
  });

  const help = (await command(["--help"])).out;
  expect(help).toContain("  easel parts  ");
  expect(help).toContain("  easel parts publish <canvas> ");
  expect(help).toContain("  easel parts show <canvas> <id> [-o <file>] ");
});
