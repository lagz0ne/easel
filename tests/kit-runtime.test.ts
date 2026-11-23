import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitOps } from "@/kit/ops.server";
import { runtimeNames } from "@/kit/runtime";
import {
  type BuiltRuntime,
  buildRuntime,
  runtimeAddress,
  runtimeNamesOf,
  runtimeOf,
  runtimeRoute,
} from "@/kit/runtime.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

function fakeRuntime(mark: string): BuiltRuntime {
  const imports = Object.fromEntries(
    runtimeNames.map((name) => [name, `${name.replace(/^@/, "").replaceAll("/", "__")}.js`]),
  );
  const files = Object.fromEntries(
    Object.values(imports).map((file) => [file, `export const mark = "${mark} ${file}";`]),
  );
  const sha = createHash("sha256").update(mark).digest("hex");
  return { sha, imports, files };
}

type Boot = { file?: string; runtime?: BuiltRuntime | null };

async function boot(options: Boot = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, kit.api];
  const runtime = options.runtime === undefined ? fakeRuntime("a") : options.runtime;
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: options.file ?? ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout, runtime }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement: kitOps, onStart: [user] }),
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
}

async function agentOf(srv: Awaited<ReturnType<typeof boot>>, known?: string) {
  const client = async (token?: string) => {
    const meta = operation({
      label: "test.meta",
      run: async (): Promise<Record<string, string>> =>
        token ? { authorization: `Bearer ${token}` } : {},
    });
    const scope = await createScope({
      capsules: [
        exits({ file: process.env.TINKER_EXITS }),
        memory.client({ peer: srv.server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
        access.login({ remote: memory.client }),
        kit.api({ remote: memory.client }),
      ],
    }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  if (known) return client(known);

  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  await (
    await client()
  ).run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  passes.set(srv, text);
  return client(text);
}

const passes = new Map<object, string>();

const fetchFile = (server: Scope.Handle, kitVersion: string, sha: string, file: string) =>
  server.run(runtimeRoute, { input: { kit: kitVersion, sha, file } });

test(
  "the runtime builds the same bytes each time, with an entry for each name and React's production build",
  { timeout: 30_000 },
  async () => {
    const scope = createScope();
    closers.push(() => scope.close());
    const first = await scope.run(buildRuntime);
    const second = await scope.run(buildRuntime);

    expect(second.sha).toBe(first.sha);
    expect(second.files).toEqual(first.files);
    expect(Object.keys(first.imports)).toEqual([...runtimeNames]);
    for (const file of Object.values(first.imports)) expect(first.files[file]).toBeDefined();
    const all = Object.values(first.files).join("\n");
    expect(all).not.toContain("is deprecated and will be removed");
    expect(first.files["react.js"]).toMatch(/useState/);
    expect(first.files["easel__frame.js"]).toMatch(/frameLogic/);
  },
);

test(
  "a kit version gets its runtime at its first use, one time, and keeps it",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const a = fakeRuntime("a");

    expect(await srv.server.run(runtimeOf, { input: 9 })).toBeNull();
    expect(await srv.server.run(runtimeNamesOf, { input: 1 })).toEqual([...runtimeNames]);

    const first = await srv.server.run(runtimeOf, { input: 1 });
    expect(first).toEqual({ sha: a.sha, imports: a.imports });
    expect(await srv.server.run(runtimeOf, { input: 1 })).toEqual(first);
    expect(await srv.server.run(runtimeNamesOf, { input: 1 })).toEqual(Object.keys(a.imports));
  },
);

test(
  "K11: after a restart with another runtime in easel, a kit version keeps the bytes of its runtime",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-runtime-"));
    try {
      const file = join(dir, "easel.db");
      const a = fakeRuntime("a");
      const one = await boot({ file, runtime: a });
      expect((await one.server.run(runtimeOf, { input: 1 }))?.sha).toBe(a.sha);
      const before = await (await fetchFile(one.server, "1", a.sha, "react.js")).text();
      await one.server.close();

      const b = fakeRuntime("b");
      const two = await boot({ file, runtime: b });
      expect((await two.server.run(runtimeOf, { input: 1 }))?.sha).toBe(a.sha);
      const after = await fetchFile(two.server, "1", a.sha, "react.js");
      expect(await after.text()).toBe(before);
      expect((await fetchFile(two.server, "1", b.sha, "react.js")).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a change of the look keeps the runtime of the kit version before it",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const agent = await agentOf(srv);
    const a = fakeRuntime("a");
    await srv.server.run(runtimeOf, { input: 1 });

    const now = await agent.run(kit.api["look.get"], { input: {} });
    if (now.kind !== "found") throw new Error("no look");
    const set = await agent.run(kit.api["look.set"], {
      input: {
        look: { color: { primary: { $value: { colorSpace: "srgb", components: [0, 0, 0.5] } } } },
        base: now.rev,
      },
    });
    expect(set).toMatchObject({ kind: "updated", kit: 2 });
    expect((await srv.server.run(runtimeOf, { input: 2 }))?.sha).toBe(a.sha);
  },
);

test(
  "kit.accept: after an update of easel, the next kit version has its runtime and the same look; a change of the look keeps it",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-accept-"));
    try {
      const file = join(dir, "easel.db");
      const a = fakeRuntime("a");
      const one = await boot({ file, runtime: a });
      const ann = await agentOf(one);
      expect(await ann.run(kit.api["kit.accept"], { input: {} })).toEqual({
        kind: "unchanged",
        kit: 1,
        rev: 1,
      });
      await one.server.run(runtimeOf, { input: 1 });
      expect((await ann.run(kit.api["kit.accept"], { input: {} })).kind).toBe("unchanged");
      const pass = passes.get(one) ?? "";
      await one.server.close();

      const b = fakeRuntime("b");
      const two = await boot({ file, runtime: b });
      const again = await agentOf(two, pass);
      expect(await again.run(kit.api["kit.accept"], { input: {} })).toEqual({
        kind: "updated",
        kit: 2,
        rev: 1,
        runtime: b.sha,
      });
      expect((await two.server.run(runtimeOf, { input: 1 }))?.sha).toBe(a.sha);
      expect((await two.server.run(runtimeOf, { input: 2 }))?.sha).toBe(b.sha);
      const got = await again.run(kit.api["look.get"], { input: {} });
      const before = await again.run(kit.api["look.get"], { input: { at: 1 } });
      expect(got).toEqual({ ...before, kit: 2 });

      const set = await again.run(kit.api["look.set"], {
        input: {
          look: { color: { primary: { $value: { colorSpace: "srgb", components: [0, 0, 0.5] } } } },
          base: 1,
        },
      });
      expect(set).toMatchObject({ kind: "updated", kit: 3, rev: 2 });
      expect((await two.server.run(runtimeOf, { input: 3 }))?.sha).toBe(b.sha);
      expect(await again.run(kit.api["look.undo"], { input: { base: 2 } })).toMatchObject({
        kind: "updated",
        kit: 4,
      });
      expect((await two.server.run(runtimeOf, { input: 4 }))?.sha).toBe(b.sha);
      const undone = await again.run(kit.api["look.get"], { input: {} });
      expect(undone.kind === "found" && undone.look).toEqual(
        before.kind === "found" && before.look,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "the route answers a runtime file with an address that never changes, to any origin",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const a = fakeRuntime("a");
    await srv.server.run(runtimeOf, { input: 1 });

    const address = srv.server.run(runtimeAddress, { input: { kit: 1, sha: a.sha } });
    expect(address).toBe(`/api/runtime/1/${a.sha}/`);
    const got = await fetchFile(srv.server, "1", a.sha, "zod.js");
    expect(got.status).toBe(200);
    expect(await got.text()).toBe(a.files["zod.js"]);
    expect(got.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(got.headers.get("access-control-allow-origin")).toBe("*");
    expect(got.headers.get("content-type")).toBe("text/javascript; charset=utf-8");

    for (const [at, sha, file] of [
      ["2", a.sha, "zod.js"],
      ["1", "0".repeat(64), "zod.js"],
      ["1", a.sha, "nope.js"],
      ["01", a.sha, "zod.js"],
      ["1", "abc", "zod.js"],
      ["1", a.sha, "../easel.db"],
    ] as const) {
      const missing = await fetchFile(srv.server, at, sha, file);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBe("no-store");
    }
  },
);

test(
  "with no runtime from the build, the scope builds it from the pins one time",
  { timeout: 30_000 },
  async () => {
    const srv = await boot({ runtime: null });
    const built = await srv.server.run(runtimeOf, { input: 1 });
    if (built === null) throw new Error("no runtime");

    const scope = createScope();
    closers.push(() => scope.close());
    expect(built.sha).toBe((await scope.run(buildRuntime)).sha);
    const react = await fetchFile(srv.server, "1", built.sha, "react.js");
    expect(react.status).toBe(200);
    expect(await react.text()).toMatch(/useState/);
  },
);

test(
  "kit.check: an HTML frame and an app frame, with their findings and nothing written",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const agent = await agentOf(srv);

    const html = await agent.run(kit.api["kit.check"], {
      input: { html: '<p class="p-4 text-red-500">a</p>' },
    });
    expect(html).toMatchObject({ kind: "checked", kit: 1, more: 0 });
    expect(html.kind === "checked" && html.findings.map((f) => f.rule)).toEqual(["look/color"]);

    const tsx = await agent.run(kit.api["kit.check"], {
      input: { tsx: 'import { x } from "left-pad";\nexport function View() { return <p />; }' },
    });
    expect(
      tsx.kind === "checked" && tsx.findings.map((f) => `${f.line}:${f.col} ${f.rule}`),
    ).toEqual(["1:19 kit/import"]);
    expect(await srv.server.run(runtimeNamesOf, { input: 1 })).toEqual([...runtimeNames]);

    const off = await agent.run(kit.api["kit.check"], {
      input: { html: '<meta name="easel-kit" content="off"><p class="text-red-500">a</p>' },
    });
    expect(off).toEqual({ kind: "checked", kit: 1, findings: [], more: 0 });
  },
);

test(
  "kit.check: at most 20 findings, `more` counts the rest; over the size limit, tooBig",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const agent = await agentOf(srv);

    const many = Array.from({ length: 25 }, (_, i) => `<p class="text-red-${i + 1}00">a</p>`);
    const got = await agent.run(kit.api["kit.check"], { input: { html: many.join("\n") } });
    expect(got.kind === "checked" && [got.findings.length, got.more]).toEqual([20, 5]);

    expect(
      await agent.run(kit.api["kit.check"], { input: { tsx: "x".repeat(256 * 1024 + 1) } }),
    ).toEqual({ kind: "tooBig", maxBytes: 262144 });
    expect(
      await agent.run(kit.api["kit.check"], { input: { html: "x".repeat(1024 * 1024 + 1) } }),
    ).toEqual({ kind: "tooBig", maxBytes: 1048576 });
  },
);
