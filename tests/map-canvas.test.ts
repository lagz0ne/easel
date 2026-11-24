import { exits } from "@tinkered/cli/test";
import { createScope, data, operation, rpc } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import {
  captionLook,
  mapArrowLift,
  mapBoard,
  mapCaption,
  mapCaptionParts,
  mapColumns,
  mapFrameName,
  mapGap,
  mapOrder,
  mapPictureHeight,
  mapRelation,
  readableLabel,
} from "@/map/canvas";
import { showPlans, showScope } from "@/map/show";
import type { MapJson } from "@/map/text";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const app = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => app.close());
  return app;
}

const map: MapJson = {
  cell: "fixture.step",
  start: "idle",
  view: "src/fixture.tsx",
  calls: [{ call: "fixture.go", answers: ["done", "refused", "link"] }],
  states: [
    { state: "idle", column: 0, row: 0, sample: { kind: "idle" }, actions: ["f.go"], run: null },
    { state: "done", column: 1, row: 0, sample: { kind: "done" }, actions: [], run: null },
    { state: "refused", column: 1, row: 1, sample: { kind: "refused" }, actions: [], run: null },
    {
      state: "idle · go failed",
      column: 1,
      row: 3,
      sample: { kind: "idle" },
      actions: [],
      run: { from: "idle", action: "f.go", press: "go", status: "failed" },
    },
    {
      state: "idle · go pending",
      column: 1,
      row: 2,
      sample: { kind: "idle" },
      actions: [],
      run: { from: "idle", action: "f.go", press: "go", status: "pending" },
    },
  ],
  moves: [
    {
      from: "idle",
      to: "done",
      action: "f.go",
      answer: { call: "fixture.go", kind: "done", fault: false },
      effects: ["f.post"],
    },
    {
      from: "idle",
      to: "refused",
      action: "f.go",
      answer: { call: "fixture.go", kind: "refused", fault: false },
      effects: [],
    },
    { from: "idle", to: "idle · go pending", action: "f.go", answer: null, effects: [] },
    {
      from: "idle",
      to: "idle · go failed",
      action: "f.go",
      answer: { call: "fixture.go", kind: "link", fault: true },
      effects: [],
    },
  ],
  stays: [],
};

const contract = {
  "fixture.go": {
    input: z.null(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done"), at: z.number() }),
      z.object({ kind: z.literal("refused") }),
    ]),
  },
};

test("a frame of a map has the name of the map and of its state", async () => {
  const app = await scope();
  expect(app.run(mapFrameName, { input: { map: "sign-in", state: "code" } })).toBe(
    "sign-in · code",
  );
});

test("the columns of a map hold its states in the order of their rows", async () => {
  const app = await scope();
  expect(app.run(mapColumns, { input: map.states })).toEqual([
    ["idle"],
    ["done", "refused", "idle · go pending", "idle · go failed"],
  ]);
  expect(app.run(mapColumns, { input: [] })).toEqual([]);
});

test("the caption of a state lists each move out of it, and a run state names its first state", async () => {
  const app = await scope();
  expect(app.run(mapCaption, { input: { map, state: "idle" } })).toEqual([
    "idle",
    "go · done → done (post)",
    "go · refused → refused",
    "go → idle · go pending",
    "go · link fault → idle · go failed",
  ]);
  expect(app.run(mapCaption, { input: { map, state: "done" } })).toEqual([
    "done",
    "no move: the end of the map",
  ]);
  expect(app.run(mapCaption, { input: { map, state: "idle · go failed" } })).toEqual([
    "idle · go failed",
    "the moves of idle",
  ]);
});

test("at 10% zoom, the label of a frame and a clear space fit in the gap above it", () => {
  expect(readableLabel.zoom).toBe(0.1);
  expect(mapGap * readableLabel.zoom).toBeGreaterThanOrEqual(
    readableLabel.height + readableLabel.clear,
  );
  expect(mapGap).toBeLessThanOrEqual(800);
});

test("the board puts the card column of each step after its picture column, in the same order", async () => {
  const app = await scope();
  const columns = [["idle"], ["done", "refused"]];
  expect(app.run(mapBoard, { input: { map: "fix", columns } })).toEqual([
    ["fix · idle"],
    ["fix · idle · card"],
    ["fix · done", "fix · refused"],
    ["fix · done · card", "fix · refused · card"],
  ]);
});

test("a picture is the screen and a line of its caption for each line", async () => {
  const app = await scope();
  expect(app.run(mapPictureHeight, { input: { screen: 768, lines: 3 } })).toBe(
    768 + 2 * captionLook.pad + 3 * captionLook.line,
  );
});

test("the arrow of a caption is a part of its own, lifted so its middle is the middle of the text", async () => {
  const app = await scope();
  expect(app.run(mapCaptionParts, { input: "go · done → done (post)" })).toEqual([
    { text: "go · done ", arrow: false },
    { text: "→", arrow: true },
    { text: " done (post)", arrow: false },
  ]);
  expect(app.run(mapCaptionParts, { input: "done" })).toEqual([{ text: "done", arrow: false }]);

  const text = { ascent: 4, descent: 0 };
  expect(app.run(mapArrowLift, { input: { text, arrow: { ascent: 2, descent: 2 } } })).toBe(-2);
  expect(app.run(mapArrowLift, { input: { text, arrow: { ascent: 4, descent: 0 } } })).toBe(0);
});

test("a new frame goes below the state above it, after the top of the column before, or in the section", async () => {
  const app = await scope();
  const columns = [["idle"], ["done", "refused"]];
  const relation = (state: string, ids: Record<string, string>) =>
    app.run(mapRelation, { input: { section: "sign-in", columns, ids, state } });

  expect(relation("idle", {})).toEqual({ kind: "section", section: "sign-in" });
  expect(relation("done", { idle: "f1" })).toEqual({ kind: "after", id: "f1" });
  expect(relation("refused", { idle: "f1", done: "f2" })).toEqual({ kind: "below", id: "f2" });
  expect(relation("done", {})).toEqual({ kind: "section", section: "sign-in" });
});

test("the order moves each frame only when the columns on the page are not the columns of the map", async () => {
  const app = await scope();
  const want = [["a"], ["b", "c"]];
  const order = (now: string[][]) =>
    app.run(mapOrder, { input: { section: "sign-in", want, now } });

  expect(order([["a"], ["b", "c"]])).toEqual([]);
  expect(order([["a"], ["c", "b"]])).toEqual([
    { id: "a", to: { kind: "section", section: "sign-in" } },
    { id: "b", to: { kind: "section", section: "sign-in" } },
    { id: "c", to: { kind: "below", id: "b" } },
  ]);
});

test("the plan of each state: a cell state waits, a run state presses with its answer", async () => {
  const app = await scope();
  const inputs = { go: z.object({ name: z.string().regex(/^[a-z]{2}$/), note: z.string() }) };

  const plans = app.run(showPlans, { input: { map, contracts: [contract], inputs } });
  expect(plans.map((plan) => [plan.state, plan.press, plan.replies])).toEqual([
    ["idle", null, {}],
    ["done", null, {}],
    ["refused", null, {}],
    [
      "idle · go failed",
      { name: "go", fields: { name: "aa", note: "" } },
      { "fixture.go": { ok: false, kind: "link", payload: expect.anything() } },
    ],
    ["idle · go pending", { name: "go", fields: { name: "aa", note: "" } }, {}],
  ]);
  expect(plans[1]?.sample).toEqual({ kind: "done" });

  const done = app.run(showPlans, {
    input: {
      map: {
        ...map,
        states: [
          {
            state: "idle · go done",
            column: 1,
            row: 0,
            sample: { kind: "idle" },
            actions: [],
            run: { from: "idle", action: "f.go", press: "nothing", status: "done" },
          },
        ],
        moves: [],
      },
      contracts: [contract],
      inputs: {},
    },
  });
  expect(done[0]?.press).toEqual({ name: "nothing", fields: {} });
  expect(done[0]?.replies).toEqual({ "fixture.go": { ok: true, value: { kind: "done", at: 0 } } });
});

const step = data<{ kind: string }>({ label: "fixture.showStep", initial: { kind: "idle" } });

const api = rpc(contract);

const go = operation({
  label: "fixture.showGo",
  depends: { go: api["fixture.go"], step: step.controller },
  run: async ({ go, step }) => step.set({ kind: (await go.run({ input: null })).kind }),
});

test("the scope of a state holds the cell at its sample, and the backend answers by the plan", async () => {
  const app = await scope();
  const plan = {
    state: "refused",
    sample: { kind: "refused" },
    press: null,
    replies: { "fixture.go": { ok: true as const, value: { kind: "done", at: 1 } } },
  };

  const options = app.run(showScope, { input: { cell: step, actions: [go, "not a unit"], plan } });
  const shown = await createScope(options).ready;
  closers.push(() => shown.close());
  expect(shown.controller(step).get()).toEqual({ kind: "refused" });

  await shown.run(go);
  expect(shown.controller(step).get()).toEqual({ kind: "done" });
});
