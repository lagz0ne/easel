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
import type { RunStatus } from "@/map/units";
import { pressMarks, readView } from "@/map/view";

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

function browserStart(kind: string) {
  return { call: "browser.start", kind, fault: false };
}

async function mapOf(...args: string[]) {
  const child = Bun.spawn([process.execPath, "cmds/map.ts", ...args], {
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
    ["code · copyApproveCommand done", 2, 3],
    ["slow", 1, 4],
    ["lost", 1, 5],
    ["name · askForCode pending", 1, 6],
    ["name · askForCode failed", 1, 7],
  ]);
  expect(map.states.find((state) => state.state === "name · askForCode failed")).toEqual({
    state: "name · askForCode failed",
    column: 1,
    row: 7,
    sample: { kind: "name" },
    actions: [],
    run: { from: "name", action: "home.askForCode", press: "askForCode", status: "failed" },
  });
  expect(map.states.find((state) => state.state === "code")?.run).toBeNull();
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
  expect(map.moves).toContainEqual({
    from: "name",
    to: "name · askForCode failed",
    action: "home.askForCode",
    answer: { call: "browser.start", kind: "link", fault: true },
    effects: [],
  });
  expect(map.moves).toContainEqual({
    from: "name",
    to: "name · askForCode pending",
    action: "home.askForCode",
    answer: null,
    effects: [],
  });
  expect(map.moves).toContainEqual({
    from: "code",
    to: "code · copyApproveCommand done",
    action: "home.copyApproveCommand",
    answer: null,
    effects: ["home.writeClipboard"],
  });
  expect(map.stays).toEqual([
    { state: "name", action: "home.codeAtOnce", answer: browserStart("name"), effects: [] },
    { state: "name", action: "home.askForCode", answer: browserStart("name"), effects: [] },
  ]);
  expect(map.calls).toEqual([
    { call: "browser.start", answers: ["pending", "name", "slow", "link"] },
    { call: "browser.wait", answers: ["approved", "pending", "denied", "expired", "slow", "link"] },
  ]);
});

test("the map prints as text: the places, then each move, each stay and each call", async () => {
  const { code, out } = await mapOf("home.signInStep");
  expect(code).toBe(0);
  const wide = (text: string) => text.padEnd(32);
  expect(out.split("\n").slice(0, 12)).toEqual([
    "map home.signInStep, start name, view src/home/home.tsx",
    "",
    ["", "step 0", "step 1", "step 2"].map(wide).join("").trimEnd(),
    ["row 0", "name", "code", "in"].map(wide).join("").trimEnd(),
    ["row 1", "", "", "denied"].map(wide).join("").trimEnd(),
    ["row 2", "", "", "expired"].map(wide).join("").trimEnd(),
    ["row 3", "", "", "code · copyApproveCommand done"].map(wide).join("").trimEnd(),
    ["row 4", "", "slow"].map(wide).join("").trimEnd(),
    ["row 5", "", "lost"].map(wide).join("").trimEnd(),
    ["row 6", "", "name · askForCode pending"].map(wide).join("").trimEnd(),
    ["row 7", "", "name · askForCode failed"].map(wide).join("").trimEnd(),
    "",
  ]);
  expect(out).toMatch(
    /\n {2}name +-> name · askForCode failed +home\.askForCode, browser\.start fault link\n/,
  );
});

test("a label that no module of src/ has exits 1, and a wrong argument exits 64", async () => {
  expect(await mapOf("fixture.none")).toEqual({
    code: 1,
    out: "",
    err: "map: no cell fixture.none in src/\n",
  });
  const wrong = await mapOf("--json");
  expect(wrong.code).toBe(64);
  expect(wrong.err).toContain("bun cmds/map.ts <cell label> [--json]");
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
          { name: "codeAtOnce", from: "./signin", open: true, reads: [] },
          { name: "askForCode", from: "./signin", open: false, reads: ["pending", "failed"] },
        ],
      },
      {
        state: "code",
        actions: [{ name: "copyApproveCommand", from: "./signin", open: false, reads: ["done"] }],
      },
      ...["lost", "denied", "expired", "slow"].map((state) => ({
        state,
        actions: [{ name: "askAgain", from: "./signin", open: false, reads: [] }],
      })),
      { state: "in", actions: [] },
    ],
  });
});

test("a destructured run gives its reads, and a run that the view does not read gives none", async () => {
  const app = await scope();
  const source = `import { useData, useRun } from "@tinkered/react";
import { go, stop, step } from "./step";
function Go() {
  const { run, isPending, data } = useRun(go);
  const halt = useRun(stop);
  return <button disabled={isPending} onClick={() => run()}>{data ? "Again" : "Go"}{halt.status}</button>;
}
export function Step() {
  const now = useData(step);
  switch (now.kind) {
    case "idle":
      return <Go />;
  }
}`;

  expect(app.run(readView, { input: { file: "step.tsx", source, cell: "step" } })).toEqual({
    kind: "found",
    states: [
      {
        state: "idle",
        actions: [
          { name: "go", from: "./step", open: false, reads: ["pending", "done"] },
          { name: "stop", from: "./step", open: false, reads: [] },
        ],
      },
    ],
  });
});

test("each press of the view gets a mark on the element that runs it, and no other change", async () => {
  const app = await scope();
  const file = join(root, "src/home/home.tsx");
  const source = await Bun.file(file).text();

  const marked = app.run(pressMarks, { input: { file, source } });
  expect(marked).toContain('<form data-map-press="askForCode"\n        className="e-home-form"');
  expect(marked).toContain('<button data-map-press="askForCode"\n        type="button"');
  expect(marked).toContain('<button data-map-press="copyApproveCommand" type="button"');
  expect(marked).toContain('<button data-map-press="askAgain" type="button"');
  expect(marked.replaceAll(/ data-map-press="\w+"/g, "")).toBe(source);

  const plain = "export function A() {\n  return <p>a</p>;\n}\n";
  expect(app.run(pressMarks, { input: { file: "a.tsx", source: plain } })).toBe(plain);
});

test("a run of the view that fails, waits or ends with no move gives a state of its run", async () => {
  const app = await scope();
  const reads: RunStatus[] = ["pending", "failed"];
  const offers = {
    kind: "view" as const,
    states: [{ state: "idle", actions: [{ unit: goWithTwo, name: "goWithTwo", reads }] }],
  };

  const found = await app.run(deriveMap, {
    input: { cell: step, offers, contracts: [twoAnswers] },
  });

  expect(found.states.map((state) => [state.state, state.run])).toEqual([
    ["idle", null],
    ["done", null],
    [
      "idle · goWithTwo pending",
      { from: "idle", action: "fixture.goWithTwo", press: "goWithTwo", status: "pending" },
    ],
    ["refused", null],
    [
      "idle · goWithTwo failed",
      { from: "idle", action: "fixture.goWithTwo", press: "goWithTwo", status: "failed" },
    ],
  ]);
  expect(found.stays).toEqual([]);
  expect(found.moves.map((move) => [move.to, move.answer?.kind ?? null, move.rank])).toEqual([
    ["done", "done", [0, 0]],
    ["idle · goWithTwo pending", null, [1000, 0, 0]],
    ["refused", "refused", [1, 0]],
    ["idle · goWithTwo failed", "link", [1000, 0, 1]],
  ]);
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

test("an example of the schema is the sample of its field, as Prism takes it", async () => {
  const app = await scope();
  const shown = {
    "fixture.make": {
      input: z.null(),
      output: madeAnswers["fixture.make"].output.extend({
        code: z
          .string()
          .regex(/^[BCDF]{4}-\d{2}$/)
          .meta({ examples: ["DCBF-42"] }),
      }),
    },
  };

  const found = await app.run(deriveMap, {
    input: { cell: made, offers: { kind: "all", actions: [goMade] }, contracts: [shown] },
  });
  expect(found.states[1]?.sample).toEqual({
    kind: "made",
    request: "0".repeat(32),
    code: "DCBF-42",
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
      {
        state: "idle",
        column: 0,
        row: 0,
        sample: { kind: "idle" },
        actions: ["fixture.go"],
        run: null,
      },
      { state: "done", column: 1, row: 0, sample: { kind: "done" }, actions: [], run: null },
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
