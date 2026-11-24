import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope, data, operation, rpc, transport } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { deriveMap } from "@/map/derive";
import { placeMap } from "@/map/place";
import { mapJson, mapText } from "@/map/text";
import type { MapJson } from "@/map/text";
import { answerOf, exampleCall, exampleWatch } from "@/map/trial";
import { readView } from "@/map/view";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const app = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS })],
    tags: [{ tag: answerOf, value: async (address: string) => ({ ok: true, value: address }) }],
  }).ready;
  closers.push(() => app.close());
  return app;
}

async function mapOf(...args: string[]) {
  const child = Bun.spawn([process.execPath, "scripts/map.ts", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

const step = data<{ kind: string }>({ label: "fixture.step", initial: { kind: "idle" } });

const twoAnswers = {
  "fixture.go": {
    input: z.null(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done"), at: z.number() }),
      z.object({ kind: z.literal("refused") }),
    ]),
  },
};

const threeAnswers = {
  "fixture.go": {
    input: z.null(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done"), at: z.number() }),
      z.object({ kind: z.literal("refused") }),
      z.object({ kind: z.literal("later"), retryIn: z.number() }),
    ]),
  },
};

const twoApi = rpc(twoAnswers);

const threeApi = rpc(threeAnswers);

const goWithTwo = operation({
  label: "fixture.goWithTwo",
  depends: { go: twoApi["fixture.go"], step: step.controller },
  run: async ({ go, step }) => step.set({ kind: (await go.run({ input: null })).kind }),
});

const goWithThree = operation({
  label: "fixture.goWithThree",
  depends: { go: threeApi["fixture.go"], step: step.controller },
  run: async ({ go, step }) => step.set({ kind: (await go.run({ input: null })).kind }),
});

const made = data<{ kind: string }>({ label: "fixture.made", initial: { kind: "none" } });

const madeAnswers = {
  "fixture.make": {
    input: z.null(),
    output: z.object({
      kind: z.literal("made"),
      request: z.string().regex(/^[0-9a-f]{32}$/),
      code: z.string().regex(/^[BCDF]{4}-\d{2}$/),
      n: z.number().int().min(3),
    }),
  },
};

const madeApi = rpc(madeAnswers);

const goMade = operation({
  label: "fixture.goMade",
  depends: { make: madeApi["fixture.make"], made: made.controller },
  run: async ({ make, made }) => made.set(await make.run({ input: null })),
});

test("the map of the sign-in has its 7 states, each in the place of the method", async () => {
  const { code, out, err } = await mapOf("home.signInStep", "--json");
  expect(err).toBe("");
  expect(code).toBe(0);

  const map = mapJson.parse(JSON.parse(out));
  expect(map.view).toBe("src/home/home.tsx");
  expect(map.states.map(({ state, column, row }) => [state, column, row])).toEqual([
    ["name", 0, 0],
    ["code", 1, 0],
    ["in", 2, 0],
    ["denied", 2, 1],
    ["expired", 2, 2],
    ["slow", 1, 3],
    ["lost", 1, 4],
  ]);
  expect(map.states.find((state) => state.state === "name")?.actions).toEqual([
    "home.codeAtOnce",
    "home.askForCode",
  ]);
  expect(map.moves).toContainEqual({
    from: "name",
    to: "lost",
    action: "home.codeAtOnce",
    answer: { call: "browser.start", kind: "link", fault: true },
    effects: [],
  });
  expect(map.moves).toContainEqual({
    from: "code",
    to: "in",
    action: "home.askForCode",
    answer: { call: "browser.wait", kind: "approved", fault: false },
    effects: ["home.postForm"],
  });
  expect(map.moves.filter((move) => move.action === "home.askAgain").map((m) => m.to)).toEqual([
    "name",
    "name",
    "name",
    "name",
  ]);
  expect(map.stays).toContainEqual({
    state: "code",
    action: "home.copyApproveCommand",
    answer: null,
    effects: ["home.writeClipboard"],
  });
  expect(map.calls).toEqual([
    { call: "browser.start", answers: ["pending", "name", "slow", "link"] },
    { call: "browser.wait", answers: ["approved", "pending", "denied", "expired", "slow", "link"] },
  ]);
});

test("the map prints as text: the places, then each move, each stay and each call", async () => {
  const { code, out } = await mapOf("home.signInStep");
  expect(code).toBe(0);
  expect(out.split("\n").slice(0, 9)).toEqual([
    "map home.signInStep, start name, view src/home/home.tsx",
    "",
    "         step 0   step 1   step 2",
    "row 0    name     code     in",
    "row 1                      denied",
    "row 2                      expired",
    "row 3             slow",
    "row 4             lost",
    "",
  ]);
  expect(out).toContain("  name    -> lost     home.codeAtOnce, browser.start fault link\n");
});

test("a label that no module of src/ has exits 1, and a wrong argument exits 64", async () => {
  expect(await mapOf("fixture.none")).toEqual({
    code: 1,
    out: "",
    err: "map: no cell fixture.none in src/\n",
  });
  const wrong = await mapOf("--json");
  expect(wrong.code).toBe(64);
  expect(wrong.err).toContain("bun scripts/map.ts <cell label> [--json]");
});

test("the view gives the actions of each state, in the order that it draws them", async () => {
  const app = await scope();
  const file = join(root, "src/home/home.tsx");
  const source = await Bun.file(file).text();

  const view = app.run(readView, { input: { file, source, cell: "signInStep" } });
  expect(view).toEqual({
    kind: "found",
    states: [
      {
        state: "name",
        actions: [
          { name: "codeAtOnce", from: "./signin", open: true },
          { name: "askForCode", from: "./signin", open: false },
        ],
      },
      { state: "code", actions: [{ name: "copyApproveCommand", from: "./signin", open: false }] },
      ...["lost", "denied", "expired", "slow"].map((state) => ({
        state,
        actions: [{ name: "askAgain", from: "./signin", open: false }],
      })),
      { state: "in", actions: [] },
    ],
  });
});

test("a view with no switch on the kind of the cell gives none", async () => {
  const app = await scope();
  const source = `import { useData } from "@tinkered/react";
import { step } from "./step";
export function Step() {
  const now = useData(step);
  return <p>{now.kind}</p>;
}`;

  expect(app.run(readView, { input: { file: "step.tsx", source, cell: "step" } })).toEqual({
    kind: "none",
  });
});

test("one more answer in the contract gives one more state, with no other change", async () => {
  const app = await scope();

  const two = await app.run(deriveMap, {
    input: { cell: step, offers: { kind: "all", actions: [goWithTwo] }, contracts: [twoAnswers] },
  });
  const three = await app.run(deriveMap, {
    input: {
      cell: step,
      offers: { kind: "all", actions: [goWithThree] },
      contracts: [threeAnswers],
    },
  });

  expect(two.states.map((state) => state.state)).toEqual(["idle", "done", "refused"]);
  expect(three.states.map((state) => state.state)).toEqual(["idle", "done", "refused", "later"]);
  expect(three.states.at(-1)?.sample).toEqual({ kind: "later" });
  expect(three.stays.map((stay) => [stay.state, stay.answer?.kind])).toEqual([
    ["idle", "link"],
    ["done", "done"],
    ["done", "link"],
    ["refused", "refused"],
    ["refused", "link"],
    ["later", "later"],
    ["later", "link"],
  ]);

  const places = app.run(placeMap, {
    input: { start: three.start, states: three.states.map((s) => s.state), moves: three.moves },
  });
  expect(places).toEqual([
    { state: "idle", column: 0, row: 0 },
    { state: "done", column: 1, row: 0 },
    { state: "refused", column: 1, row: 1 },
    { state: "later", column: 1, row: 2 },
  ]);
});

test("a sample of an answer parses as its schema, with each pattern", async () => {
  const app = await scope();

  const found = await app.run(deriveMap, {
    input: { cell: made, offers: { kind: "all", actions: [goMade] }, contracts: [madeAnswers] },
  });
  expect(found.calls).toEqual([{ call: "fixture.make", answers: ["made", "link"] }]);
  expect(madeAnswers["fixture.make"].output.parse(found.states[1]?.sample)).toEqual({
    kind: "made",
    request: "0".repeat(32),
    code: "BBBB-00",
    n: 3,
  });
});

test("the example backend gives each answer of its script, also each fault, and ends a watch", async () => {
  const faults = ["refused", "failed", "invalid", "encode", "decode", "missing", "link"] as const;
  const app = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS })],
    tags: [
      {
        tag: answerOf,
        value: async (address: string): Promise<transport.Reply> => ({
          ok: false,
          kind: faults.find((fault) => fault === address) ?? "link",
          payload: null,
        }),
      },
    ],
  }).ready;
  closers.push(() => app.close());
  const call = { address: "fixture.go", value: null, meta: {} };

  for (const fault of faults) {
    const reply = await app.run(exampleCall, { input: { ...call, address: fault } });
    expect(reply).toMatchObject({ ok: false, kind: fault });
  }
  const watch = { ...call, push: () => undefined };
  expect(await app.run(exampleWatch, { input: watch })).toBeUndefined();

  const plain = await scope();
  expect(await plain.run(exampleCall, { input: call })).toEqual({ ok: true, value: "fixture.go" });
});

test("the text of a map with no view says that each action ran from each state", async () => {
  const app = await scope();
  const map: MapJson = {
    cell: "fixture.step",
    start: "idle",
    view: null,
    calls: [{ call: "fixture.go", answers: ["done", "link"] }],
    states: [
      { state: "idle", column: 0, row: 0, sample: { kind: "idle" }, actions: ["fixture.go"] },
      { state: "done", column: 1, row: 0, sample: { kind: "done" }, actions: [] },
    ],
    moves: [
      {
        from: "idle",
        to: "done",
        action: "fixture.goWithTwo",
        answer: { call: "fixture.go", kind: "done", fault: false },
        effects: ["fixture.post"],
      },
    ],
    stays: [{ state: "idle", action: "fixture.goWithTwo", answer: null, effects: [] }],
  };

  expect(app.run(mapText, { input: map })).toBe(
    [
      "map fixture.step, start idle, no view: each action from each state",
      "",
      "        step 0  step 1",
      "row 0   idle    done",
      "",
      "moves",
      "  idle -> done  fixture.goWithTwo, fixture.go done (fixture.post)",
      "",
      "stays",
      "  idle  fixture.goWithTwo",
      "",
      "calls",
      "  fixture.go: done, link",
    ].join("\n"),
  );
});
