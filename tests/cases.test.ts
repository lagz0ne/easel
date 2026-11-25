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
import { sectionHead } from "@/frames/arrange";
import { maxCases } from "@/frames/cases";
import type { FrameCase } from "@/frames/cases";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitOps } from "@/kit/ops.server";

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
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, kit.api];

  const server = await createScope({
    clock: makeTestClock({ now: 1_800_000_000_000 }),
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({
        mode: "approve",
        origin: null,
        stdout,
        trusted: [],
        durable: false,
      }),
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

  return {
    server,
    setupCode: () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "",
  };
}

async function client(server: Scope.Handle, token?: string) {
  const meta = operation({
    label: "test.casesMeta",
    run: async (): Promise<Record<string, string>> =>
      token ? { authorization: `Bearer ${token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({
        peer: server,
        headers: { "x-easel-peer": "198.51.100.1" },
        meta,
      }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
      kit.api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  return scope;
}

const people = {
  empty: [],
  few: [{ name: "Ana" }, { name: "Ben" }, { name: "Chen" }],
  "long-names": [{ name: "Maximiliana Alexandrovna Konstantinopoulou-Vanderberg" }],
  many: Array.from({ length: 120 }, (_, n) => ({ name: `Person ${n + 1}` })),
};

const dataCases: FrameCase[] = [
  { name: "empty", fixture: "empty" },
  { name: "few", fixture: "few" },
  { name: "long-names", fixture: "long-names" },
  { name: "many", fixture: "many", switches: { theme: "dark" } },
];

async function easel() {
  const srv = await boot();
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  const agent = await client(srv.server, text);
  const api = frames.api;
  await agent.run(api["canvas.create"], { input: { name: "flow" } });
  await agent.run(kit.api["fixtures.set"], {
    input: { cell: "people.list", fixtures: people },
  });
  const source = await agent.run(api["frame.put"], {
    input: {
      canvas: "flow",
      html: "<p>users list</p>",
      name: "users list",
      size: { w: 880, h: 600 },
      x: 400,
      y: 400,
    },
  });
  if (source.kind !== "created") throw new Error(source.kind);

  const set = (cases: FrameCase[], base?: number, frame = source.id) =>
    agent.run(api["cases.set"], {
      input:
        base === undefined
          ? { canvas: "flow", frame, cases }
          : { canvas: "flow", frame, cases, base },
    });
  const listCases = (frame = source.id) =>
    agent.run(api["cases.list"], { input: { canvas: "flow", frame } });
  const listFrames = async () => {
    const answer = await agent.run(api["frame.list"], {
      input: { canvas: "flow" },
    });
    if (answer.kind !== "found") throw new Error(answer.kind);
    return new Map(answer.frames.map((one) => [one.id, one]));
  };
  return { srv, text, agent, source, set, listCases, listFrames };
}

type Easel = Awaited<ReturnType<typeof easel>>;

async function setOk(e: Easel, cases: FrameCase[], base?: number) {
  const answer = await e.set(cases, base);
  if (answer.kind !== "set") throw new Error(answer.kind);
  return answer;
}

test("X12 cases: 4 cases make 4 case frames in the section 'users list · cases', after the source frame, which stays at its place", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases, 0);
  expect(answer.rev).toBe(1);
  expect(answer.frames.map((one) => one.name)).toEqual(["empty", "few", "long-names", "many"]);

  const all = await e.listFrames();
  const source = all.get(e.source.id);
  expect(source).toMatchObject({
    x: 400,
    y: 400,
    section: "users list · cases",
  });
  const cases = answer.frames.map((one) => all.get(one.id));
  expect(cases.map((one) => one?.name)).toEqual([
    "users list · empty",
    "users list · few",
    "users list · long-names",
    "users list · many",
  ]);
  expect(cases.every((one) => one?.section === "users list · cases")).toBe(true);
  expect(cases.every((one) => one?.y === 400 && one.w === 880 && one.h === 600)).toBe(true);
  const xs = [source?.x ?? 0, ...cases.map((one) => one?.x ?? 0)];
  expect(xs).toEqual(xs.toSorted((a, b) => a - b));
  expect(new Set(xs).size).toBe(5);
  expect(source?.y).toBe(400);
  expect(sectionHead).toBeGreaterThan(0);

  expect(await e.listCases()).toEqual({
    kind: "found",
    rev: 1,
    section: "users list · cases",
    cases: dataCases,
    frames: answer.frames,
  });
});

test("X12 cases: the board frame of a case frame has its source, its name and its values; the source frame has none", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases);
  const tab = await client(e.srv.server, e.text);
  const many = answer.frames.find((one) => one.name === "many")?.id ?? "";
  const cells = tab.resolve(frames.board.frames.where({ canvas: "flow" }));
  closers.push(cells.watch(() => undefined));
  await until(() => cells.get().some((one) => one.id === many));

  const board = new Map(cells.get().map((one) => [one.id, one]));
  expect(board.get(many)?.case).toEqual({
    source: e.source.id,
    name: "many",
    fixture: "many",
    switches: { theme: "dark" },
  });
  expect(board.get(e.source.id)?.case ?? null).toBeNull();
});

test("X12 cases: a second write keeps the ids of the cases that stay, removes one, adds one at the end, and changes values", async () => {
  const e = await easel();
  const first = await setOk(e, dataCases);
  const ids = new Map(first.frames.map((one) => [one.name, one.id]));

  const next: FrameCase[] = [
    { name: "empty", fixture: "empty" },
    { name: "few", fixture: "few", switches: { theme: "dark" } },
    { name: "many", fixture: "many" },
    { name: "one", fixture: "few" },
  ];
  const second = await setOk(e, next, 1);
  expect(second.rev).toBe(2);
  const again = new Map(second.frames.map((one) => [one.name, one.id]));
  expect(again.get("empty")).toBe(ids.get("empty"));
  expect(again.get("few")).toBe(ids.get("few"));
  expect(again.get("many")).toBe(ids.get("many"));
  expect(again.get("one")).not.toBe(ids.get("long-names"));

  const all = await e.listFrames();
  expect(all.has(ids.get("long-names") ?? "")).toBe(false);
  expect(all.get(again.get("one") ?? "")?.name).toBe("users list · one");
  const listed = await e.listCases();
  expect(listed).toMatchObject({ kind: "found", rev: 2, cases: next });
});

test("X17 cases: a new version of the source frame gives each case frame its build and its version, in one write", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases);
  const put = await e.agent.run(frames.api["frame.put"], {
    input: {
      canvas: "flow",
      id: e.source.id,
      base: 1,
      html: "<p>users list v2</p>",
    },
  });
  expect(put).toMatchObject({ kind: "updated", version: 2 });
  expect(put).not.toHaveProperty("cases");

  const all = await e.listFrames();
  expect(answer.frames.every((one) => all.get(one.id)?.version === 2)).toBe(true);
  for (const one of answer.frames) {
    const got = await e.agent.run(frames.api["frame.get"], {
      input: { canvas: "flow", id: one.id },
    });
    expect(got).toMatchObject({
      kind: "found",
      frame: { html: "<p>users list v2</p>" },
    });
  }

  const same = await e.agent.run(frames.api["frame.put"], {
    input: {
      canvas: "flow",
      id: e.source.id,
      base: 2,
      html: "<p>users list v2</p>",
    },
  });
  expect(same).toMatchObject({ kind: "unchanged", version: 2 });
  expect(same).not.toHaveProperty("cases");
});

test("X12 cases: only easel writes a case frame: a put, a delete, cases.set and cases.list on it say CaseFrame and name the source", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases);
  const id = answer.frames[0]?.id ?? "";
  const refusal = { kind: "CaseFrame", source: e.source.id };

  expect(
    await e.agent.run(frames.api["frame.put"], {
      input: { canvas: "flow", id, base: 1, html: "<p>mine</p>" },
    }),
  ).toEqual(refusal);
  expect(
    await e.agent.run(frames.api["frame.delete"], {
      input: { canvas: "flow", id },
    }),
  ).toEqual(refusal);
  expect(await e.set(dataCases, undefined, id)).toEqual(refusal);
  expect(await e.listCases(id)).toEqual(refusal);
});

test("X12 cases: a delete of the source frame takes its case frames and its list", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases);
  const deleted = await e.agent.run(frames.api["frame.delete"], {
    input: { canvas: "flow", id: e.source.id },
  });
  expect(deleted).toMatchObject({ kind: "deleted" });
  expect(deleted).not.toHaveProperty("removed");

  const all = await e.listFrames();
  expect(answer.frames.some((one) => all.has(one.id))).toBe(false);
  expect(await e.listCases()).toEqual({ kind: "gone" });
  expect(
    await e.agent.run(frames.api["frame.delete"], {
      input: { canvas: "flow", id: e.source.id },
    }),
  ).toEqual({ kind: "gone" });
});

test("X12 cases: a frame with no list has revision 0 and no cases; a frame that is not there is gone", async () => {
  const e = await easel();
  expect(await e.listCases()).toEqual({
    kind: "found",
    rev: 0,
    section: null,
    cases: [],
    frames: [],
  });
  expect(await e.listCases("000000000000")).toEqual({ kind: "gone" });
  expect(await e.set(dataCases, undefined, "000000000000")).toEqual({
    kind: "gone",
  });
});

test("X12 cases: a refused list writes nothing: a fixture that no cell has, two cases with one name, too many cases, an old base", async () => {
  const e = await easel();
  expect(await e.set([{ name: "lost", fixture: "nowhere" }])).toEqual({
    kind: "CaseInvalid",
    case: "lost",
    field: "fixture",
    reason: 'no cell has the fixture "nowhere" (fixtures.list)',
  });
  expect(await e.set([{ name: "few" }, { name: "few", fixture: "few" }])).toEqual({
    kind: "CaseInvalid",
    case: "few",
    field: "name",
    reason: "a case before it has this name",
  });
  const lots = Array.from({ length: maxCases + 1 }, (_, n) => ({
    name: `case-${n}`,
  }));
  expect(await e.set(lots)).toEqual({
    kind: "CasesTooMany",
    cases: maxCases + 1,
    max: maxCases,
  });
  expect(await e.listCases()).toMatchObject({
    kind: "found",
    rev: 0,
    cases: [],
  });

  await setOk(e, dataCases, 0);
  expect(await e.set(dataCases, 0)).toEqual({ kind: "changed", rev: 1 });
  expect((await e.listFrames()).size).toBe(5);
});

test("X12 cases: a source frame in a section of a person keeps that section, and its case frames go right after it, in the order of the list", async () => {
  const e = await easel();
  const putStep = async (name: string) => {
    const made = await e.agent.run(frames.api["frame.put"], {
      input: {
        canvas: "flow",
        html: `<p>${name}</p>`,
        name,
        section: "Checkout",
        size: { w: 400, h: 300 },
      },
    });
    if (made.kind !== "created") throw new Error(made.kind);
    return made.id;
  };
  const step = await putStep("step");
  const pay = await putStep("pay");

  await e.agent.run(frames.api["frame.move"], {
    input: { canvas: "flow", id: e.source.id, after: step },
  });

  const answer = await setOk(e, dataCases.slice(0, 2));
  const all = await e.listFrames();
  const row = [step, e.source.id, ...answer.frames.map((one) => one.id), pay];
  expect(row.map((id) => all.get(id)?.section)).toEqual(row.map(() => "Checkout"));
  const xs = row.map((id) => all.get(id)?.x ?? 0);
  expect(xs).toEqual(xs.toSorted((a, b) => a - b));
  expect(new Set(xs).size).toBe(row.length);
  expect(await e.listCases()).toMatchObject({ kind: "found", section: "Checkout" });
});

test("X12 cases: a section of a person with the name of the group gets the id of the source in the name of the group", async () => {
  const e = await easel();
  await e.agent.run(frames.api["frame.put"], {
    input: {
      canvas: "flow",
      html: "<p>x</p>",
      name: "x",
      section: "users list · cases",
      size: { w: 300, h: 200 },
    },
  });

  await setOk(e, dataCases.slice(0, 1));
  const all = await e.listFrames();
  expect(all.get(e.source.id)?.section).toBe(`users list ${e.source.id} · cases`);
});

test("X12 cases: a new order of the list seats the case frames again in that order, after the source frame", async () => {
  const e = await easel();
  await setOk(e, dataCases);
  const order = ["many", "empty", "few", "long-names"];
  const next = order.flatMap((name) => dataCases.filter((one) => one.name === name));

  const answer = await setOk(e, next, 1);
  expect(answer.frames.map((one) => one.name)).toEqual(order);
  const all = await e.listFrames();
  const xs = [e.source.id, ...answer.frames.map((one) => one.id)].map((id) => all.get(id)?.x ?? 0);
  expect(xs).toEqual(xs.toSorted((a, b) => a - b));
  expect(new Set(xs).size).toBe(5);
  expect(await e.listCases()).toEqual({
    kind: "found",
    rev: 2,
    section: "users list · cases",
    cases: next,
    frames: answer.frames,
  });
});

test("X12 cases: an empty first list makes no section and changes no place", async () => {
  const e = await easel();
  const before = await e.listFrames();

  const answer = await setOk(e, [], 0);
  expect(answer.frames).toEqual([]);
  expect(await e.listFrames()).toEqual(before);
  expect(await e.listCases()).toEqual({
    kind: "found",
    rev: 1,
    section: null,
    cases: [],
    frames: [],
  });
});

const rowInOrder = (all: Map<string, { x: number; y: number }>, ids: string[]) => {
  const xs = ids.map((id) => all.get(id)?.x ?? 0);
  expect(xs).toEqual(xs.toSorted((a, b) => a - b));
  expect(new Set(xs).size).toBe(ids.length);
};

async function newPage(e: Easel, name: string) {
  const made = await e.agent.run(frames.api["page.create"], {
    input: { canvas: "flow", name },
  });
  if (made.kind !== "created") throw new Error(made.kind);
  return made.key;
}

test("X12 cases: a move of the source frame to an exact place on another page takes its case frames, right after it, in one section", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases);
  const page = await newPage(e, "Two");

  const moved = await e.agent.run(frames.api["frame.move"], {
    input: { canvas: "flow", id: e.source.id, page, x: 100, y: 200 },
  });
  expect(moved).toMatchObject({ kind: "moved" });

  const all = await e.listFrames();
  const group = [e.source.id, ...answer.frames.map((one) => one.id)];
  expect(group.map((id) => all.get(id)?.page)).toEqual(group.map(() => page));
  expect(group.map((id) => all.get(id)?.section)).toEqual(group.map(() => "users list · cases"));
  expect(all.get(e.source.id)).toMatchObject({ x: 100, y: 200 });
  expect(answer.frames.every((one) => all.get(one.id)?.y === 200)).toBe(true);
  rowInOrder(all, group);

  const again = await setOk(e, dataCases.slice(0, 3), 1);
  const after = await e.listFrames();
  const kept = [e.source.id, ...again.frames.map((one) => one.id)];
  expect(kept.map((id) => after.get(id)?.page)).toEqual(kept.map(() => page));
  expect(kept.map((id) => after.get(id)?.section)).toEqual(kept.map(() => "users list · cases"));
  rowInOrder(after, kept);
  expect(await e.listCases()).toMatchObject({ kind: "found", section: "users list · cases" });
});

test("X12 cases: a move of the source frame into a section of another page takes its case frames, right after it", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases.slice(0, 2));
  const page = await newPage(e, "Two");
  const step = await e.agent.run(frames.api["frame.put"], {
    input: {
      canvas: "flow",
      page,
      html: "<p>step</p>",
      name: "step",
      section: "Checkout",
      size: { w: 400, h: 300 },
    },
  });
  if (step.kind !== "created") throw new Error(step.kind);

  await e.agent.run(frames.api["frame.move"], {
    input: { canvas: "flow", id: e.source.id, page, section: "Checkout" },
  });

  const all = await e.listFrames();
  const row = [step.id, e.source.id, ...answer.frames.map((one) => one.id)];
  expect(row.map((id) => all.get(id)?.page)).toEqual(row.map(() => page));
  expect(row.map((id) => all.get(id)?.section)).toEqual(row.map(() => "Checkout"));
  rowInOrder(all, row);
  expect([...all.values()].filter((one) => one.page === "page-1")).toEqual([]);
});

test("X12 cases: a new size of the source frame gives each case frame the same size, in the same move", async () => {
  const e = await easel();
  const answer = await setOk(e, dataCases);

  const moved = await e.agent.run(frames.api["frame.move"], {
    input: { canvas: "flow", id: e.source.id, size: { w: 500, h: 320 } },
  });
  expect(moved).toMatchObject({ kind: "moved" });

  const all = await e.listFrames();
  const group = [e.source.id, ...answer.frames.map((one) => one.id)];
  expect(group.map((id) => [all.get(id)?.w, all.get(id)?.h])).toEqual(group.map(() => [500, 320]));
  rowInOrder(all, group);
});

test("X12 cases: a move of the source frame in its section or to an exact place on its page keeps its case frames right after it", async () => {
  const e = await easel();
  const putStep = async (name: string) => {
    const made = await e.agent.run(frames.api["frame.put"], {
      input: {
        canvas: "flow",
        html: `<p>${name}</p>`,
        name,
        section: "Checkout",
        size: { w: 400, h: 300 },
      },
    });
    if (made.kind !== "created") throw new Error(made.kind);
    return made.id;
  };
  const step = await putStep("step");
  const pay = await putStep("pay");
  await e.agent.run(frames.api["frame.move"], {
    input: { canvas: "flow", id: e.source.id, after: step },
  });
  const answer = await setOk(e, dataCases.slice(0, 2));
  const cases = answer.frames.map((one) => one.id);

  await e.agent.run(frames.api["frame.move"], {
    input: { canvas: "flow", id: e.source.id, after: pay },
  });
  const inSection = await e.listFrames();
  const row = [step, pay, e.source.id, ...cases];
  expect(row.map((id) => inSection.get(id)?.section)).toEqual(row.map(() => "Checkout"));
  rowInOrder(inSection, row);

  await e.agent.run(frames.api["frame.move"], {
    input: { canvas: "flow", id: e.source.id, x: 3000, y: 2000 },
  });
  const exact = await e.listFrames();
  const group = [e.source.id, ...cases];
  expect(exact.get(e.source.id)).toMatchObject({ x: 3000, y: 2000 });
  expect(group.map((id) => exact.get(id)?.section)).toEqual(group.map(() => "users list · cases"));
  expect(cases.every((id) => exact.get(id)?.y === 2000)).toBe(true);
  rowInOrder(exact, group);
  expect([step, pay].map((id) => exact.get(id)?.section)).toEqual(["Checkout", "Checkout"]);
});
