import { createHash, randomBytes } from "node:crypto";

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
import { parts } from "@/parts";
import { partsOps, partsServer } from "@/parts/ops.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const count = "cw8rv3bcji";

const page = (head: string, body: string) =>
  `<!doctype html>\n<html><head><meta name="easel-kit" content="off">\n${head}</head>\n<body>\n${body}\n</body></html>`;

const countMain = (attrs = "") =>
  page(
    `<style data-doop-component-source="${count}">\n.count {display:inline-flex}\n</style>\n`,
    `<span class="count"${attrs} data-doop-prop="value" data-doop-part="lyrk" data-doop-component="${count}">3</span>`,
  );

const props = `{&quot;tone&quot;:&quot;accent&quot;,&quot;value&quot;:&quot;2&quot;}`;

const countCopy = `<span class="count" data-doop-instance="${count}" data-doop-rev="1" data-doop-id="tqhcbt" data-tone="accent" data-doop-props="${props}">2</span>`;

async function boot() {
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, kit.api, parts.api];
  const server = await createScope({
    clock: makeTestClock({ now: 1_800_000_000_000 }),
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement: kitOps, onStart: [user] }),
      partsServer,
      parts.api({ implement: partsOps, onStart: [user] }),
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
}

async function client(server: Scope.Handle, token?: string) {
  const meta = operation({
    label: "test.casesPartsMeta",
    run: async (): Promise<Record<string, string>> =>
      token ? { authorization: `Bearer ${token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      parts.api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return scope;
}

async function easel() {
  const srv = await boot();
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  const agent = await client(srv.server, text);
  for (const name of ["design-system", "product"]) {
    await agent.run(frames.api["canvas.create"], { input: { name } });
  }

  const put = async (canvas: string, html: string, name: string) => {
    const answer = await agent.run(frames.api["frame.put"], { input: { canvas, html, name } });
    if (answer.kind !== "created") throw new Error(`put ${name}: ${answer.kind}`);
    return answer.id;
  };
  const twoCases = async (canvas: string, frame: string) => {
    const answer = await agent.run(frames.api["cases.set"], {
      input: { canvas, frame, cases: [{ name: "one" }, { name: "two" }] },
    });
    if (answer.kind !== "set") throw new Error(`cases.set: ${answer.kind}`);
    return answer.frames.map((one) => one.id);
  };
  const publish = (canvas: string) => agent.run(parts.api["parts.publish"], { input: { canvas } });
  const list = () => agent.run(parts.api["parts.list"], { input: {} });
  return { agent, put, twoCases, publish, list };
}

test("X12 cases: parts publish takes the source frame of a main with 2 cases as the one main, and no case frame", async () => {
  const e = await easel();
  const main = await e.put("design-system", countMain(), "Count");
  expect(await e.twoCases("design-system", main)).toHaveLength(2);

  expect(await e.publish("design-system")).toMatchObject({
    kind: "updated",
    parts: [{ id: count, name: "Count", rev: 1 }],
  });
  expect(await e.list()).toMatchObject({
    kind: "found",
    parts: [{ id: count, rev: 1, source: { canvas: "design-system", frame: main, version: 1 } }],
  });

  const put = await e.agent.run(frames.api["frame.put"], {
    input: { canvas: "design-system", id: main, base: 1, html: countMain(' title="Count"') },
  });
  expect(put).toMatchObject({ kind: "updated", version: 2 });
  expect(await e.publish("design-system")).toMatchObject({
    parts: [{ id: count, name: "Count", rev: 2 }],
  });
  expect(await e.list()).toMatchObject({
    parts: [{ id: count, rev: 2, source: { canvas: "design-system", frame: main, version: 2 } }],
  });
});

test("X12 cases: parts list counts a frame with a copy and 2 cases as one copy, and no case frame", async () => {
  const e = await easel();
  await e.put("design-system", countMain(), "Count");
  const copy = await e.put("product", page("", countCopy), "Inbox");
  expect(await e.twoCases("product", copy)).toHaveLength(2);

  expect(await e.publish("design-system")).toMatchObject({ kind: "updated" });
  expect(await e.publish("product")).toMatchObject({ kind: "unchanged", parts: [] });
  expect(await e.list()).toMatchObject({
    kind: "found",
    parts: [{ id: count, copies: [{ canvas: "product", id: copy, linked: 1, edited: 0 }] }],
  });
});
