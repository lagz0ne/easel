import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import type { z } from "zod";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { arrangeGap, sectionHead, sectionSpace } from "@/frames/arrange";
import { framesContracts } from "@/frames/contract";
import type { MoveInput, PutInput } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

async function boot() {
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
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
      memory.server({ services: [access.login, access.user, frames.api, frames.board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  return { server, setupCode: () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "" };
}

async function client(server: Scope.Handle, token?: string) {
  const meta = operation({
    label: "test.arrangeMeta",
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
    ],
  }).ready;
  closers.push(() => scope.close());
  return scope;
}

const screen = { w: 390, h: 844 };

async function easel() {
  const srv = await boot();
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });

  const scope = await client(srv.server, text);
  const api = frames.api;
  await scope.run(api["canvas.create"], { input: { name: "flow" } });

  const put = (input: Omit<Extract<PutInput, { html: string }>, "canvas" | "html">) =>
    scope.run(api["frame.put"], {
      input: { canvas: "flow", html: "<p>x</p>", size: screen, ...input },
    });
  const made = async (input: Parameters<typeof put>[0]) => {
    const answer = await put(input);
    if (answer.kind !== "created") throw new Error(answer.kind);
    return answer;
  };
  return {
    scope,
    put,
    made,
    move: (input: Omit<MoveInput, "canvas">) =>
      scope.run(api["frame.move"], { input: { canvas: "flow", ...input } }),
    section: (input: Omit<z.infer<(typeof framesContracts)["section.set"]["input"]>, "canvas">) =>
      scope.run(api["section.set"], { input: { canvas: "flow", ...input } }),
    layout: (page?: string) => scope.run(api["page.layout"], { input: { canvas: "flow", page } }),
    list: async () => {
      const answer = await scope.run(api["frame.list"], { input: { canvas: "flow" } });
      if (answer.kind !== "found") throw new Error(answer.kind);
      return answer;
    },
    rm: (id: string) => scope.run(api["frame.delete"], { input: { canvas: "flow", id } }),
  };
}

type Easel = Awaited<ReturnType<typeof easel>>;

async function boxes(e: Easel) {
  const { frames: list } = await e.list();
  return new Map(list.map((f) => [f.id, f]));
}

async function flowOf(e: Easel, count: number) {
  const first = await e.made({ name: "Step 1", section: "Checkout" });
  const ids = [first.id];
  for (let n = 2; n <= count; n++) {
    const next = await e.made({ name: `Step ${n}`, after: ids[ids.length - 1] });
    ids.push(next.id);
  }
  return ids;
}

const apart = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

test("G1: ten frames of a flow with section and after only go in one row, in their order, with one gap and no overlap", async () => {
  const e = await easel();
  const ids = await flowOf(e, 10);

  const all = await boxes(e);
  const row = ids.map((id) => all.get(id));
  row.forEach((f, n) => {
    expect(f).toMatchObject({
      x: n * (screen.w + arrangeGap),
      y: sectionHead,
      section: "Checkout",
    });
  });
  for (const [n, a] of row.entries()) {
    for (const b of row.slice(n + 1)) if (a && b) expect(apart(a, b)).toBe(true);
  }

  const laid = await e.layout();
  expect(laid).toMatchObject({
    kind: "found",
    layout: { page: "page-1", findings: [], more: 0 },
    sections: [
      { key: "checkout", name: "Checkout", x: 0, y: 0, at: false, columns: ids.map((id) => [id]) },
    ],
  });
});

test("G2: a frame that gets 300 px wider moves the frames after it by 300 px, and the frames before it stay", async () => {
  const e = await easel();
  const [first = "", grown = "", ...rest] = await flowOf(e, 4);
  const before = await boxes(e);

  const answer = await e.move({ id: grown, size: { w: screen.w + 300, h: screen.h } });
  expect(answer).toMatchObject({ kind: "moved", layout: { findings: [], more: 0 } });

  const after = await boxes(e);
  const shift = (id: string) => (after.get(id)?.x ?? 0) - (before.get(id)?.x ?? 0);
  expect([first, grown].map(shift)).toEqual([0, 0]);
  expect(after.get(grown)?.w).toBe(690);
  expect(rest.map(shift)).toEqual([300, 300]);
});

test("below stacks a frame under another in its column; a delete leaves no hole, and an empty section goes", async () => {
  const e = await easel();
  const [a = "", b = ""] = await flowOf(e, 2);
  const under = await e.made({ name: "Error", below: a });

  const all = await boxes(e);
  expect(all.get(under.id)).toMatchObject({ x: 0, y: sectionHead + screen.h + arrangeGap });
  expect(all.get(b)?.x).toBe(screen.w + arrangeGap);

  expect(await e.rm(a)).toMatchObject({ kind: "deleted", layout: { findings: [] } });
  const left = await boxes(e);
  expect(left.get(under.id)).toMatchObject({ x: 0, y: sectionHead });
  expect(left.get(b)?.x).toBe(screen.w + arrangeGap);

  await e.rm(under.id);
  await e.rm(b);
  expect(await e.layout()).toMatchObject({ kind: "found", sections: [] });
});

test("two sections go from top to bottom in their order, 160 px apart; section.set moves, orders, wraps and spaces a section", async () => {
  const e = await easel();
  const [a = "", b = "", c = ""] = await flowOf(e, 3);
  const other = await e.made({ name: "Login", section: "Sign in" });
  const top = sectionHead + screen.h;

  expect((await boxes(e)).get(other.id)).toMatchObject({
    x: 0,
    y: top + sectionSpace + sectionHead,
  });

  expect(await e.section({ section: "Sign in", after: null })).toMatchObject({ kind: "set" });
  const first = await boxes(e);
  expect(first.get(other.id)).toMatchObject({ x: 0, y: sectionHead });
  expect(first.get(a)).toMatchObject({ y: top + sectionSpace + sectionHead });

  expect(await e.section({ section: "Checkout", wrap: 2, gap: 40 })).toMatchObject({ kind: "set" });
  const wrapped = await boxes(e);
  const start = top + sectionSpace + sectionHead;
  expect(wrapped.get(a)).toMatchObject({ x: 0, y: start });
  expect(wrapped.get(b)).toMatchObject({ x: screen.w + 40, y: start });
  expect(wrapped.get(c)).toMatchObject({ x: 0, y: start + screen.h + 40 });

  expect(await e.section({ section: "Checkout", at: { x: 5000, y: 100 } })).toMatchObject({
    kind: "set",
  });
  expect((await boxes(e)).get(a)).toMatchObject({ x: 5000, y: 100 + sectionHead });
  expect(await e.section({ section: "Checkout", at: { x: 5000, y: 100 } })).toMatchObject({
    kind: "unchanged",
  });
  expect(await e.section({ section: "Checkout", at: null })).toMatchObject({ kind: "set" });
  expect((await boxes(e)).get(a)).toMatchObject({ x: 0, y: start });

  expect(await e.section({ section: "Nope", wrap: 1 })).toEqual({ kind: "gone" });
  expect(await e.section({ section: "Checkout", after: "Nope" })).toEqual({ kind: "gone" });
  expect(await e.section({ section: "Checkout", page: "nope", wrap: 1 })).toEqual({ kind: "gone" });
});

test("G4: a frame with an exact place stays, and the section flows below it; an exact place on a section with at is a stray, and two exact frames touch", async () => {
  const e = await easel();
  const fixed = await e.made({ name: "Note", x: 0, y: 0 });
  const [a = ""] = await flowOf(e, 2);

  const all = await boxes(e);
  expect(all.get(fixed.id)).toMatchObject({ x: 0, y: 0, section: null });
  const flowed = all.get(a);
  const note = all.get(fixed.id);
  if (!flowed || !note) throw new Error("no frame");
  expect(flowed.y).toBeGreaterThanOrEqual(note.y + note.h + sectionHead);

  await e.section({ section: "Checkout", at: { x: 0, y: 2000 } });
  const held = (await boxes(e)).get(a);
  if (!held) throw new Error("no frame");
  const stray = await e.made({ name: "Stray", x: held.x + 10, y: held.y + 10 });
  expect(stray.layout.findings).toContainEqual({ stray: stray.id, section: "Checkout" });
  expect((await boxes(e)).get(a)).toMatchObject({ x: held.x, y: held.y });
  const near = await e.put({ name: "Near", x: 0, y: note.h + 4 });
  if (near.kind !== "created") throw new Error(near.kind);
  expect(near.layout.findings).toContainEqual({ touch: [fixed.id, near.id] });

  const checked = await e.layout();
  if (checked.kind !== "found") throw new Error(checked.kind);
  expect(checked.layout.findings.length).toBeGreaterThanOrEqual(2);
  expect(await e.layout("nope")).toEqual({ kind: "gone" });
});

test("G6: a put, a move or a section change on an old revision is refused changed and writes nothing; the right revision writes", async () => {
  const e = await easel();
  const [a = ""] = await flowOf(e, 2);
  const { rev } = await e.list();

  expect(await e.put({ name: "Late", section: "Checkout", rev: rev + 1 })).toEqual({
    kind: "changed",
    rev,
  });
  expect(await e.move({ id: a, size: { w: 500, h: 500 }, rev: rev + 1 })).toEqual({
    kind: "changed",
    rev,
  });
  expect(await e.section({ section: "Checkout", wrap: 1, rev: rev + 1 })).toEqual({
    kind: "changed",
    rev,
  });
  expect((await e.list()).frames).toHaveLength(2);

  const written = await e.put({ name: "On time", section: "Checkout", rev });
  expect(written).toMatchObject({ kind: "created", layout: { rev: rev + 1 } });
  expect((await e.list()).rev).toBe(rev + 1);
});

test("a relation to a frame with an exact place is refused placed; a relation to a frame or a page that is not there is gone", async () => {
  const e = await easel();
  const fixed = await e.made({ name: "Note", x: 10, y: 10 });
  const [a = ""] = await flowOf(e, 1);

  expect(await e.put({ after: fixed.id })).toEqual({ kind: "placed", id: fixed.id });
  expect(await e.move({ id: a, below: fixed.id })).toEqual({ kind: "placed", id: fixed.id });
  expect(await e.put({ after: "0123456789ab" })).toEqual({ kind: "gone" });
  expect(await e.put({ section: "Checkout", page: "nope" })).toEqual({ kind: "gone" });
  expect(await e.move({ id: "0123456789ab", section: "Checkout" })).toEqual({ kind: "gone" });
  expect(await e.move({ id: a, after: "0123456789ab" })).toEqual({ kind: "gone" });
  expect((await e.list()).frames).toHaveLength(2);
});

test("a move puts a frame after another, into a section or at an exact place, and the same place again is unchanged", async () => {
  const e = await easel();
  const [a = "", b = "", c = ""] = await flowOf(e, 3);

  expect(await e.move({ id: c, after: a })).toMatchObject({ kind: "moved" });
  const swapped = await boxes(e);
  expect(swapped.get(c)?.x).toBe(screen.w + arrangeGap);
  expect(swapped.get(b)?.x).toBe(2 * (screen.w + arrangeGap));
  expect(await e.move({ id: c, after: a })).toMatchObject({ kind: "unchanged" });

  expect(await e.move({ id: b, section: "Other" })).toMatchObject({ kind: "moved" });
  expect((await boxes(e)).get(b)).toMatchObject({ section: "Other", x: 0 });

  expect(await e.move({ id: a, x: 9000, y: 9000 })).toMatchObject({ kind: "moved" });
  expect((await boxes(e)).get(a)).toMatchObject({ x: 9000, y: 9000, section: null });
  expect((await boxes(e)).get(c)).toMatchObject({ section: "Checkout" });
});

test("a frame of a section is never out of its section box, and the board shows each section with its name and its box", async () => {
  const e = await easel();
  const ids = await flowOf(e, 3);
  await e.made({ name: "Below", below: ids[0] });
  await e.move({ id: ids[2] ?? "", size: { w: 1200, h: 300 } });

  const tab = e.scope.resolve(frames.board.sections.where({ canvas: "flow", page: "page-1" }));
  const stop = tab.watch(() => {});
  closers.push(stop);
  await until(() => tab.get().length === 1);
  const [box] = tab.get();
  expect(box).toMatchObject({ key: "checkout", name: "Checkout", x: 0, y: 0 });

  const all = await boxes(e);
  for (const f of all.values()) {
    if (!box || f.section !== "Checkout") continue;
    expect(f.x).toBeGreaterThanOrEqual(box.x);
    expect(f.y).toBeGreaterThanOrEqual(box.y + sectionHead);
    expect(f.x + f.w).toBeLessThanOrEqual(box.x + box.w);
    expect(f.y + f.h).toBeLessThanOrEqual(box.y + box.h);
  }
});
