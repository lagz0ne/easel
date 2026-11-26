import { readFileSync } from "node:fs";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { mapCard, mapCardHtml, mapGraph } from "@/map/card";
import { mapJson } from "@/map/text";
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

const graphText = [
  "f.go exits{value} reads{} writes{fixture.step.set} calls{?,f.wait}",
  "f.ask exits{value} reads{?} writes{?} calls{}",
  "",
  "not a line of the graph",
].join("\n");

const map: MapJson = {
  cell: "fixture.step",
  start: "idle",
  view: "src/fixture.tsx",
  calls: [{ call: "fixture.go", answers: ["done", "refused", "again", "link"] }],
  states: [
    {
      state: "idle",
      column: 0,
      row: 0,
      sample: { kind: "idle", count: 2, tags: ["a"] },
      actions: ["f.go", "f.open"],
      run: null,
    },
    { state: "done", column: 1, row: 0, sample: { kind: "done" }, actions: [], run: null },
    { state: "refused", column: 1, row: 1, sample: "<refused>", actions: ["f.ask"], run: null },
    {
      state: "idle · go failed",
      column: 1,
      row: 2,
      sample: { kind: "idle" },
      actions: [],
      run: { from: "idle", action: "f.go", press: "go", status: "failed" },
    },
    {
      state: "idle · go pending",
      column: 1,
      row: 3,
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
      to: "done",
      action: "f.go",
      answer: { call: "fixture.go", kind: "done", fault: false },
      effects: ["f.post"],
    },
    { from: "idle", to: "idle · go pending", action: "f.go", answer: null, effects: [] },
    {
      from: "idle",
      to: "idle · go failed",
      action: "f.go",
      answer: { call: "fixture.go", kind: "link", fault: true },
      effects: [],
    },
    {
      from: "done",
      to: "refused",
      action: "f.go",
      answer: { call: "fixture.wait", kind: "refused", fault: false },
      effects: ["f.post", "f.note"],
    },
    { from: "refused", to: "idle", action: "f.ask", answer: null, effects: [] },
  ],
  stays: [
    {
      state: "idle",
      action: "f.go",
      answer: { call: "fixture.go", kind: "again", fault: false },
      effects: [],
    },
  ],
};

test("the graph gives the reads, the writes and the calls of each label, and keeps a ? as it is", async () => {
  const app = await scope();
  const graph = app.run(mapGraph, { input: graphText });

  expect(graph).toEqual({
    "f.go": { reads: [], writes: ["fixture.step.set"], calls: ["?", "f.wait"] },
    "f.ask": { reads: ["?"], writes: ["?"], calls: [] },
  });
});

test("the card of a state shows its sample, each action with its graph, and each answer in the order of the contract with the state that it leads to", async () => {
  const app = await scope();
  const graph = app.run(mapGraph, { input: graphText });

  expect(app.run(mapCard, { input: { map, name: "fix", state: "idle", graph } })).toEqual({
    title: "fix · idle",
    about: "The state idle of the cell fixture.step, in the view src/fixture.tsx.",
    sections: [
      { head: "Shows", lines: ["kind: idle", "count: 2", 'tags: ["a"]'] },
      {
        head: "Action f.go",
        lines: [
          "reads: nothing",
          "writes: fixture.step.set",
          "calls: not known, f.wait",
          "fixture.go done → done, effects: f.post",
          "fixture.go again → stays on idle",
          "fixture.go link fault → idle · go failed",
          "no answer yet → idle · go pending",
        ],
      },
      {
        head: "Action f.open",
        lines: [
          "reads, writes, calls: not known: tinker.graph has no line for f.open",
          "no move and no stay",
        ],
      },
      {
        head: "Not known",
        lines: ["tinker.graph shows ? for a call of the server: lagz0ne/tinkered#59"],
      },
    ],
  });
});

test("the card of a state tells an action that goes on from an earlier state, and the end of the map", async () => {
  const app = await scope();
  const graph = app.run(mapGraph, { input: graphText });

  const done = app.run(mapCard, { input: { map, name: "fix", state: "done", graph } });
  expect(done.sections).toEqual([
    { head: "Shows", lines: ["kind: done"] },
    {
      head: "Action f.go, from an earlier state",
      lines: ["fixture.wait refused → refused, effects: f.post, f.note"],
    },
  ]);

  const refused = app.run(mapCard, { input: { map, name: "fix", state: "refused", graph } });
  expect(refused.sections).toEqual([
    { head: "Shows", lines: ["<refused>"] },
    {
      head: "Action f.ask",
      lines: ["reads: not known", "writes: not known", "calls: nothing", "no call → idle"],
    },
    {
      head: "Not known",
      lines: ["tinker.graph shows ? for a call of the server: lagz0ne/tinkered#59"],
    },
  ]);

  const alone: MapJson = { ...map, moves: [], stays: [] };
  const end = app.run(mapCard, { input: { map: alone, name: "fix", state: "done", graph } });
  expect(end.sections).toEqual([
    { head: "Shows", lines: ["kind: done"] },
    { head: "Moves", lines: ["no move: the end of the map"] },
  ]);
});

test("the card of a run state names the run, its answer, and the state whose moves it has", async () => {
  const app = await scope();
  const graph = app.run(mapGraph, { input: graphText });

  const failed = app.run(mapCard, {
    input: { map, name: "fix", state: "idle · go failed", graph },
  });
  expect(failed).toEqual({
    title: "fix · idle · go failed",
    about: "The run of f.go from idle, failed. A state of the view, not of the cell fixture.step.",
    sections: [
      { head: "Shows", lines: ["kind: idle", "the press go: failed"] },
      {
        head: "Action f.go",
        lines: [
          "reads: nothing",
          "writes: fixture.step.set",
          "calls: not known, f.wait",
          "the answer here: fixture.go link fault",
          "the moves of idle: see the card of idle",
        ],
      },
      {
        head: "Not known",
        lines: ["tinker.graph shows ? for a call of the server: lagz0ne/tinkered#59"],
      },
    ],
  });

  const pending = app.run(mapCard, {
    input: { map, name: "fix", state: "idle · go pending", graph },
  });
  expect(pending.sections[1]?.lines[3]).toBe("the answer here: no answer yet");
});

test("the card of a state that the map does not have refuses", async () => {
  const app = await scope();
  expect(() => app.run(mapCard, { input: { map, name: "fix", state: "gone", graph: {} } })).toThrow(
    "map: no state gone in the map of fixture.step",
  );
});

test("the html of a card escapes its text, and is as tall as its lines or as the picture beside it", async () => {
  const app = await scope();
  const card = {
    title: "fix · <idle>",
    about: "about & more",
    sections: [{ head: "Shows", lines: ['tags: ["a"]', "one"] }],
  };

  const tall = app.run(mapCardHtml, { input: { card, least: 900 } });
  expect(tall.html).toContain("fix · &lt;idle&gt;");
  expect(tall.html).toContain("about &amp; more");
  expect(tall.html).toContain("tags: [&quot;a&quot;]");
  expect(tall.html).not.toContain("<idle>");
  expect(tall.size).toEqual({ w: 720, h: 900 });

  const short = app.run(mapCardHtml, { input: { card, least: 0 } });
  expect(short.size).toEqual({ w: 720, h: 64 + 28 + 20 + 24 + 24 + 2 * 20 });
  expect(short.html).toBe(app.run(mapCardHtml, { input: { card, least: 0 } }).html);
});

test("the cards of the sign-in come from its code and from tinker.graph, with no fact by hand", async () => {
  const app = await scope();
  const root = new URL("..", import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, "cmds/map.ts", "home.signInStep", "--json"], {
    cwd: root,
    stdout: "pipe",
  });
  const signIn = mapJson.parse(JSON.parse(await new Response(child.stdout).text()));
  const graph = app.run(mapGraph, { input: readFileSync(`${root}tinker.graph`, "utf8") });
  const cardOf = (state: string) =>
    app.run(mapCard, { input: { map: signIn, name: "sign-in", state, graph } });

  expect(cardOf("name").sections[1]).toEqual({
    head: "Action home.codeAtOnce",
    lines: [
      "reads, writes, calls: not known: tinker.graph has no line for home.codeAtOnce",
      "browser.start pending → code",
      "browser.start name → stays on name",
      "browser.start slow → slow",
      "browser.start link fault → lost",
    ],
  });
  expect(cardOf("name").sections[2]?.lines.slice(0, 3)).toEqual([
    "reads: nothing",
    "writes: home.signInStep.set",
    "calls: not known, home.waitForApproval",
  ]);
  expect(cardOf("code").sections.map((section) => section.head)).toEqual([
    "Shows",
    "Action home.copyApproveCommand",
    "Action home.codeAtOnce, from an earlier state",
    "Action home.askForCode, from an earlier state",
  ]);
  expect(cardOf("code").sections[3]?.lines).toEqual([
    "browser.wait approved → in, effects: home.postForm",
    "browser.wait denied → denied",
    "browser.wait expired → expired",
  ]);
  expect(cardOf("in").sections).toEqual([
    { head: "Shows", lines: ["kind: in"] },
    { head: "Moves", lines: ["no move: the end of the map"] },
  ]);
}, 15_000);
