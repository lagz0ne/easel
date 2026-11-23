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
import { lookPaths, lookPatch } from "@/kit/shape";
import { readKit } from "@/kit/store.server";

import { frame } from "./kit/fixture";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 150 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

async function boot() {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, kit.api];
  const server = await createScope({
    clock,
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
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
}

async function client(server: Scope.Handle, token?: string) {
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> =>
      token ? { authorization: `Bearer ${token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
      kit.api({ remote: memory.client }),
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
  await agent.run(frames.api["canvas.create"], { input: { name: "flow" } });
  await agent.run(frames.api["canvas.create"], { input: { name: "plan" } });

  return { srv, token: text, agent };
}

const srgb = (hex: string) => ({
  colorSpace: "srgb" as const,
  components: [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ],
});

const get = (agent: Scope.Handle, at?: number) =>
  agent.run(kit.api["look.get"], { input: at === undefined ? {} : { at } });

const setColors = (agent: Scope.Handle, base: number, colors: Record<string, string>) =>
  agent.run(kit.api["look.set"], {
    input: {
      look: {
        color: Object.fromEntries(
          Object.entries(colors).map(([name, hex]) => [name, { $value: srgb(hex) }]),
        ),
      },
      base,
    },
  });

const undo = (agent: Scope.Handle, base: number) =>
  agent.run(kit.api["look.undo"], { input: { base } });

function kitCell(tab: Scope.Handle, canvas: string) {
  const cell = tab.resolve(frames.board.kit.of({ canvas }));
  closers.push(cell.watch(() => undefined));
  return {
    kit: () => cell.get()?.kit ?? 0,
    look: () => cell.get()?.look ?? "",
    css: () => cell.get()?.css ?? "",
  };
}

async function stored(server: Scope.Handle) {
  const now = await server.run(readKit);
  if (!now) throw new Error("no kit version");
  return now;
}

test("look.get answers the seed look of kit version 1 with revision 1; at a kit version that is not stored, gone", async () => {
  const { agent } = await easel();
  const now = await get(agent);

  expect(now).toMatchObject({
    kind: "found",
    kit: 1,
    rev: 1,
    look: { color: { primary: { $value: { hex: "#171717" } } } },
  });
  expect(await get(agent, 1)).toEqual(now);
  expect(await get(agent, 2)).toEqual({ kind: "gone" });
});

test("look.set saves a new look as kit version 2 (SetLook, K7): each canvas's cell kit at scope gets it, no frame is written, and the kit's made CSS is kept", async () => {
  const { srv, token, agent } = await easel();
  const put = await agent.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: await frame("form") },
  });
  if (put.kind !== "created") throw new Error("not created");
  const before = await stored(srv.server);
  const tab = await client(srv.server, token);
  const flow = kitCell(tab, "flow");
  const plan = kitCell(tab, "plan");
  await until(() => flow.kit() === 1 && plan.kit() === 1);

  const answer = await setColors(agent, 1, { primary: "#3b2fc9" });
  expect(answer).toEqual({ kind: "updated", rev: 2, kit: 2 });

  await until(() => flow.kit() === 2 && plan.kit() === 2);
  expect(flow.look()).toContain("  --primary: #3b2fc9;\n");
  expect(flow.css()).toBe(before.css);
  const listed = await agent.run(frames.api["frame.list"], { input: { canvas: "flow" } });
  expect(listed).toMatchObject({ kind: "found", frames: [{ id: put.id, version: 1 }] });

  expect(await get(agent)).toMatchObject({
    kit: 2,
    rev: 2,
    look: { color: { primary: { $value: srgb("#3b2fc9") } } },
  });
  expect(await get(agent, 1)).toMatchObject({
    kit: 1,
    look: { color: { primary: { $value: { hex: "#171717" } } } },
  });
  const now = await stored(srv.server);
  expect(now).toMatchObject({ version: 2, lookRev: 2, source: before.source, css: before.css });
  expect(now.values["--primary"]).toBe("#3b2fc9");
  expect(now.values["--background"]).toBe("#ffffff");
});

test("the whole file that look.get gives is a patch with the same values: unchanged, nothing written", async () => {
  const { srv, agent } = await easel();
  const now = await get(agent);
  if (now.kind !== "found") throw new Error("not found");

  const look = lookPatch.parse(now.look);
  expect(await agent.run(kit.api["look.set"], { input: { look, base: 1 } })).toEqual({
    kind: "unchanged",
    rev: 1,
    kit: 1,
  });
  expect((await srv.server.run(readKit))?.version).toBe(1);
});

test("look.set on an old revision is stale with the current one (PutStale, K14), and writes nothing", async () => {
  const { srv, agent } = await easel();
  await setColors(agent, 1, { primary: "#3b2fc9" });

  expect(await setColors(agent, 1, { primary: "#1d4ed8" })).toEqual({
    kind: "stale",
    rev: 2,
    kit: 2,
  });
  expect(await undo(agent, 1)).toEqual({ kind: "stale", rev: 2, kit: 2 });
  expect((await srv.server.run(readKit))?.values["--primary"]).toBe("#3b2fc9");
});

test("two look.set calls on one revision: the first wins, the second answers stale (judged rule 2)", async () => {
  const { srv, agent } = await easel();
  const [one, two] = await Promise.all([
    setColors(agent, 1, { primary: "#3b2fc9" }),
    setColors(agent, 1, { primary: "#1d4ed8" }),
  ]);

  expect([one.kind, two.kind].sort()).toEqual(["stale", "updated"]);
  expect((await srv.server.run(readKit))?.version).toBe(2);
});

test("K8: a look that fails each kind of pair is unreadable with that pair and its ratio (SetLookUnreadable); nothing is written", async () => {
  const { srv, agent } = await easel();
  const answer = await setColors(agent, 1, {
    primary: "#e5e5e5",
    "muted-foreground": "#a3a3a3",
    input: "#d4d4d4",
  });

  if (answer.kind !== "unreadable") throw new Error(`not unreadable: ${answer.kind}`);
  expect(answer.fails).toContainEqual({
    text: "primary-foreground",
    on: "primary",
    ratio: expect.any(Number),
    min: 4.5,
    where: expect.stringMatching(/^the kit rule \.btn-primary/),
  });
  expect(answer.fails).toContainEqual({
    text: "muted-foreground",
    on: "muted",
    ratio: 2.31,
    min: 4.5,
    where: "text on --muted",
  });
  expect(answer.fails).toContainEqual({
    text: "input",
    on: "background",
    ratio: 1.48,
    min: 3,
    where: "a field edge",
  });
  for (const fail of answer.fails) expect(fail.ratio).toBeLessThan(fail.min);
  expect(await srv.server.run(readKit)).toMatchObject({ version: 1, lookRev: 1 });
});

test("K9, F7: look.undo gives the look before the last change as a new kit version, and a second undo the changed look again; with no change, none", async () => {
  const { srv, token, agent } = await easel();
  expect(await undo(agent, 1)).toEqual({ kind: "none" });

  await setColors(agent, 1, { primary: "#3b2fc9" });
  const tab = await client(srv.server, token);
  const flow = kitCell(tab, "flow");

  expect(await undo(agent, 2)).toEqual({ kind: "updated", rev: 3, kit: 3 });
  await until(() => flow.kit() === 3);
  expect(flow.look()).toContain("  --primary: #171717;\n");
  const back = await srv.server.run(readKit);
  const seed = await get(agent, 1);
  if (seed.kind !== "found") throw new Error("no seed");
  expect(back?.look).toEqual(seed.look);

  expect(await undo(agent, 3)).toEqual({ kind: "updated", rev: 4, kit: 4 });
  await until(() => flow.kit() === 4);
  expect(flow.look()).toContain("  --primary: #3b2fc9;\n");
  for (const at of [1, 2, 3, 4]) expect(await get(agent, at)).toMatchObject({ kit: at, rev: at });
});

test("a patch with a name that the look does not have, a wrong $type, a null, a bad alias or a hex that is not its color is invalid, with its path", () => {
  const issues = (patch: unknown) => lookPatch.safeParse(patch).error?.issues ?? [];
  const pathOf = (patch: unknown) => issues(patch)[0]?.path ?? null;
  const codeOf = (patch: unknown) => issues(patch)[0]?.code ?? null;

  expect(pathOf({ color: { nope: { $value: srgb("#000000") } } })).toEqual(["color"]);
  expect(codeOf({ color: { nope: { $value: srgb("#000000") } } })).toBe("unrecognized_keys");
  expect(pathOf({ color: { primary: { $type: "dimension" } } })).toEqual([
    "color",
    "primary",
    "$type",
  ]);
  expect(pathOf({ color: { primary: null } })).toEqual(["color", "primary"]);
  expect(pathOf({ color: { primary: { $value: null } } })).toEqual(["color", "primary", "$value"]);
  expect(pathOf({ text: { sm: { $value: { value: 14, unit: "em" } } } })).toEqual([
    "text",
    "sm",
    "$value",
  ]);
  expect(pathOf({ font: { display: { $value: "{font.mono}" } } })).toBeNull();
  expect(pathOf({ font: { sans: { $value: "{font.display}" } } })).toEqual([
    "font",
    "sans",
    "$value",
  ]);
  expect(pathOf({ font: { display: { $value: "{font.nope}" } } })).toEqual([
    "font",
    "display",
    "$value",
  ]);
  expect(pathOf({ spacing: { $value: "{color.primary}" } })).toEqual(["spacing", "$value"]);
  const wrongHex = { ...srgb("#3b2fc9"), hex: "#000000" };
  expect(pathOf({ color: { primary: { $value: wrongHex } } })).toEqual([
    "color",
    "primary",
    "$value",
    "hex",
  ]);
  expect(pathOf({ color: { primary: { $value: { ...srgb("#3b2fc9"), hex: "#3b2fc9" } } } })).toBe(
    null,
  );
});

test("the look's names are the seed's: each look value of the seed has its path and type, and no other", async () => {
  const { srv } = await easel();
  const now = await srv.server.run(readKit);
  const names = Object.keys(now?.values ?? {});

  expect(names).toEqual(
    lookPaths.map(({ path }) => `--${path.replace(/^color\./, "").replaceAll(".", "-")}`),
  );
  expect(lookPatch.safeParse(now?.look).success).toBe(true);
});
