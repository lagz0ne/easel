import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { stdinText } from "@/cli/frames";
import { lookRun } from "@/cli/look";
import type { LookCommand } from "@/cli/look";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitApi } from "@/kit/contract";
import { kitOps } from "@/kit/ops.server";
import { runtimeOf } from "@/kit/runtime.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

const brokenUndo = operation({
  label: "test.brokenUndo",
  input: kitApi["look.undo"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

async function boot(options: { broken?: boolean } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const implement = { ...kitOps, ...(options.broken ? { "look.undo": brokenUndo } : {}) };
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
      kit.api({ implement, onStart: [user] }),
      memory.server({ services: [access.login, access.user, access.owner, frames.api, kit.api] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function easel(srv: Srv, options: { json?: boolean; stdin?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-look-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const stdin = options.stdin;
  const scope = await createScope({
    clock: srv.clock,
    tags: stdin === undefined ? [] : [stdinText(async () => stdin)],
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
      kit.api({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json: options.json ?? true,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    out,
    err,
    file: (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);
      return path;
    },
    path: (name: string) => join(dir, name),
    run: (command: LookCommand) => scope.run(lookRun, { input: command }),
    login: () =>
      scope.run(cli.run, {
        input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
      }),
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

async function ann(srv: Srv, options: { json?: boolean; stdin?: string } = {}) {
  const a = await easel(srv, options);
  expect(await a.login()).toBe(0);
  a.out.splice(0);
  a.err.splice(0);

  return a;
}

const primary = (hex: string) =>
  JSON.stringify({
    color: {
      primary: {
        $value: {
          colorSpace: "srgb",
          components: [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255),
        },
      },
    },
  });

test("look get -o writes the DTCG file and prints the revision and kit version; set the edited file saves it (exit 0); the same file again is unchanged (0)", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(await a.run({ kind: "get", out: a.path("look.json") })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "found", kit: 1, rev: 1, file: a.path("look.json") }]);
  const look = JSON.parse(readFileSync(a.path("look.json"), "utf8"));
  expect(look.color.primary.$value.hex).toBe("#171717");

  look.color.primary.$value = { colorSpace: "srgb", components: [0.2, 0.2, 0.8] };
  const edited = a.file("look.json", JSON.stringify(look));
  expect(await a.run({ kind: "set", file: edited, base: "1" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "updated", rev: 2, kit: 2 }]);
  expect(await a.run({ kind: "set", file: edited, base: "2" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "unchanged", rev: 2, kit: 2 }]);

  expect(await a.run({ kind: "get", at: "1" })).toBe(0);
  expect(a.lines()).toMatchObject([{ kind: "found", kit: 1, rev: 1 }]);
  expect(await a.run({ kind: "get", at: "9" })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "gone" }]);
});

test("look get with no -o prints the file and the revision for a person; set from stdin with --base", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false, stdin: primary("#3b2fc9") });

  expect(await a.run({ kind: "get" })).toBe(0);
  const text = a.out.splice(0).join("");
  expect(text).toContain('"$schema": "https://www.designtokens.org/schemas/2025.10/format.json"');
  expect(text.trimEnd().endsWith("look revision 1, kit version 1")).toBe(true);

  expect(await a.run({ kind: "set", file: "-", base: "1" })).toBe(0);
  expect(a.out.splice(0).join("")).toBe("updated: look revision 2, kit version 2\n");
});

test("look set: a pair that fails is unreadable (1), each pair a line; an old base is stale (1) with the revision", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });

  expect(
    await a.run({ kind: "set", file: a.file("low.json", primary("#e5e5e5")), base: "1" }),
  ).toBe(1);
  const told = a.err.splice(0).join("");
  expect(told).toMatch(/^unreadable: nothing is saved; each pair needs WCAG AA\n/);
  expect(told).toMatch(
    /\nprimary-foreground on primary: 1\.\d+:1, needs 4\.5:1 \(the kit rule \.btn-primary[^)]*\)\n/,
  );

  expect(await a.run({ kind: "set", file: a.file("p.json", primary("#3b2fc9")), base: "1" })).toBe(
    0,
  );
  a.out.splice(0);
  expect(await a.run({ kind: "set", file: a.file("q.json", primary("#1d4ed8")), base: "1" })).toBe(
    1,
  );
  expect(a.err.splice(0).join("")).toContain("stale: the look is at revision 2 (kit version 2)");
});

test("look set: a name that the look does not have exits 65 with its path, and sends nothing; a file that is not JSON, or no --base, exits 64", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const nope = a.file("nope.json", JSON.stringify({ color: { nope: { $value: 1 } } }));

  expect(await a.run({ kind: "set", file: nope, base: "1" })).toBe(65);
  expect(a.lines()).toEqual([
    { invalid: [{ path: "color", message: expect.stringContaining("nope") }] },
  ]);
  expect(await a.run({ kind: "set", file: a.file("bad.json", "{"), base: "1" })).toBe(64);
  expect(a.lines()).toMatchObject([{ usage: expect.stringContaining("is not JSON") }]);
  expect(await a.run({ kind: "set", file: a.path("none.json"), base: "1" })).toBe(64);
  expect(a.lines()).toMatchObject([{ usage: expect.stringContaining("cannot read") }]);
  expect(await a.run({ kind: "set", file: nope, base: "x" })).toBe(64);
  expect(a.lines()).toMatchObject([{ usage: expect.stringContaining("--base") }]);
  expect(await a.run({ kind: "undo", base: "0" })).toBe(64);
  expect(await a.run({ kind: "get", at: "first" })).toBe(64);
  expect(a.lines()).toMatchObject([{ usage: expect.any(String) }, { usage: expect.any(String) }]);
  expect(await a.run({ kind: "get" })).toBe(0);
  expect(a.lines()).toMatchObject([{ kind: "found", kit: 1 }]);
});

test("look undo: none with no change (1); after a change, updated (0); stale on an old base (1)", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(await a.run({ kind: "undo", base: "1" })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "none" }]);
  expect(await a.run({ kind: "set", file: a.file("p.json", primary("#3b2fc9")), base: "1" })).toBe(
    0,
  );
  a.lines();
  expect(await a.run({ kind: "undo", base: "2" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "updated", rev: 3, kit: 3 }]);
  expect(await a.run({ kind: "undo", base: "2" })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "stale", rev: 3, kit: 3 }]);
});

test("look with no sign-in is refused (2); a server that throws exits 70 with its trace", async () => {
  const srv = await boot({ broken: true });
  const stranger = await easel(srv);
  expect(await stranger.run({ kind: "get" })).toBe(2);
  expect(stranger.lines()).toEqual([{ refused: { signIn: true } }]);

  const a = await ann(srv, { json: false });
  expect(await a.run({ kind: "undo", base: "1" })).toBe(70);
  expect(a.err.splice(0).join("")).toMatch(/^the server failed \(trace /);
  expect(await a.run({ kind: "set", file: a.file("p.json", primary("#3b2fc9")), base: "1" })).toBe(
    0,
  );
  expect(await a.run({ kind: "undo", base: "2" })).toBe(70);
});

test("kit check prints the count, and each finding on stderr as put does; a .tsx file is an app frame; it writes nothing (exit 0)", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });

  const page = a.file("page.html", '<p class="p-4 text-red-500">a</p>');
  expect(await a.run({ kind: "check", file: page })).toBe(0);
  expect(a.out.splice(0).join("")).toBe("checked: 1 finding, kit version 1\n");
  expect(a.err.splice(0).join("")).toBe(
    `${page}:1:15 look/color "text-red-500" is a color of Tailwind's palette, not of the look. Fix: use text-destructive\n`,
  );

  const app = a.file("page.tsx", 'import { x } from "left-pad";\nexport const logic = 1;\n');
  expect(await a.run({ kind: "check", file: app })).toBe(0);
  expect(a.out.splice(0).join("")).toBe("checked: 2 findings, kit version 1\n");
  const lines = a.err.splice(0).join("").trimEnd().split("\n");
  expect(lines.map((l) => l.split(" ").slice(0, 2).join(" "))).toEqual([
    `${app}:1:1 kit/shape`,
    `${app}:1:19 kit/import`,
  ]);

  expect(await a.run({ kind: "check", file: a.path("none.tsx") })).toBe(64);
});

test("kit check with --json prints the answer only; many findings end with `and <n> more`; too big exits 1", async () => {
  const srv = await boot();
  const json = await ann(srv);
  const tsx = json.file(
    "page.tsx",
    "export const logic = 1;\nexport function View() { return <p />; }\n",
  );
  expect(await json.run({ kind: "check", file: tsx })).toBe(0);
  expect(json.lines()).toEqual([{ kind: "checked", kit: 1, findings: [], more: 0 }]);
  expect(json.err).toEqual([]);

  const text = await ann(await boot(), { json: false });
  const many = Array.from({ length: 22 }, () => '<p class="text-red-500">a</p>').join("\n");
  expect(await text.run({ kind: "check", file: text.file("many.html", many) })).toBe(0);
  const err = text.err.splice(0).join("").trimEnd().split("\n");
  expect(err.length).toBe(21);
  expect(err.at(-1)).toBe("and 2 more");

  const big = text.file("big.tsx", "x".repeat(256 * 1024 + 1));
  expect(await text.run({ kind: "check", file: big })).toBe(1);
  expect(text.err.splice(0).join("")).toContain("over 262144 bytes");
});

const olderRuntime = operation({
  label: "test.olderRuntime",
  depends: { connection: bunSqlite.connection, runtimeOf },
  run: async ({ connection, runtimeOf }) => {
    await runtimeOf.run({ input: 1 });
    const db = connection.db.$client;
    db.query(
      "INSERT INTO kit_runtimes (sha, imports, files, made) SELECT ?, imports, files, made FROM kit_runtimes",
    ).run("0".repeat(64));
    db.query("UPDATE kit_versions SET runtime = ? WHERE version = 1").run("0".repeat(64));
  },
});

test(
  "kit accept prints the kit version with the runtime of this easel and exits 0; with nothing to change, unchanged and 0",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const text = await ann(srv, { json: false });

    expect(await text.run({ kind: "accept" })).toBe(0);
    expect(text.out.splice(0).join("")).toBe(
      "unchanged: kit version 1 has the runtime of this easel, or gets it at its first use\n",
    );

    await srv.server.run(olderRuntime);
    expect(await text.run({ kind: "accept" })).toBe(0);
    expect(text.out.splice(0).join("")).toBe(
      "updated: kit version 2 has the runtime of this easel. Put each app frame again to give it this runtime\n",
    );

    expect(await text.run({ kind: "accept" })).toBe(0);
    expect(text.out.splice(0).join("")).toContain("unchanged: kit version 2 ");

    const json = await ann(await boot());
    expect(await json.run({ kind: "accept" })).toBe(0);
    expect(json.lines()).toEqual([{ kind: "unchanged", kit: 1, rev: 1 }]);
  },
);

test("kit capsules prints each capsule of the kit version: what it does, its install, config and exports, with its edges and texts", async () => {
  const srv = await boot();
  const text = await ann(srv, { json: false });

  expect(await text.run({ kind: "capsules" })).toBe(0);
  const out = text.out.splice(0).join("");
  expect(out.split("\n")[0]).toBe(
    "kit version 1: 3 capsules; they start with the look of this kit version",
  );
  expect(out).toContain("\n\ncopy: The locale of a scope");
  expect(out).toContain('  config locale: "en" | "vi"\n');
  expect(out).toContain("  config values (required): a map of ^--[a-z][a-z0-9-]*$ to values\n");
  expect(out).toContain("  pieces (resource): Button, Card, Badge, Stat and Empty");
  expect(out).toContain('           <Button tone="primary|secondary|ghost|danger"');
  expect(out).toContain("      depends: t uses ui.text");
  expect(out).toContain('      text ui.empty: "Nothing here yet"');

  const json = await ann(await boot());
  expect(await json.run({ kind: "capsules" })).toBe(0);
  const [answer] = json.lines();
  expect(answer).toMatchObject({ kind: "found", kit: 1, start: { kind: "started" } });
  const capsules = z
    .array(
      z.object({
        label: z.string(),
        exports: z.array(z.object({ name: z.string(), kind: z.string() })),
      }),
    )
    .parse(Reflect.get(Object(answer), "capsules"));
  expect(
    capsules.map(
      (one) => `${one.label}: ${one.exports.map((e) => `${e.name} ${e.kind}`).join(", ")}`,
    ),
  ).toEqual([
    "look: values resource, styles resource",
    "copy: say resource, texts tag, format resource",
    "ui: pieces resource, text resource",
  ]);
});
