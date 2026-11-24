import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import type { MapJson } from "@/map/text";
import {
  walkDataOf,
  walkDocument,
  walkFrameName,
  walkNameOf,
  walkPageName,
  walkPicks,
} from "@/map/walk";
import type { WalkData } from "@/map/walk";

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
    {
      state: "idle · go failed",
      column: 1,
      row: 1,
      sample: { kind: "idle" },
      actions: [],
      run: { from: "idle", action: "f.go", press: "go", status: "failed" },
    },
  ],
  moves: [
    {
      from: "idle",
      to: "done",
      action: "f.go",
      answer: { call: "fixture.go", kind: "done", fault: false },
      effects: [],
    },
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

const data: WalkData = {
  name: "fixture",
  map: {
    ...map,
    states: map.states.map((state) =>
      state.state === "done" ? { ...state, sample: "</script>" } : state,
    ),
  },
  replies: { "fixture.go": [{ kind: "done", reply: { ok: true, value: { kind: "done" } } }] },
};

const built = `<!doctype html>
<html lang="en">
  <head>
    <title>Walk</title>
    <link rel="stylesheet" crossorigin href="./chunk-a.css">
  </head>
  <body>
    <div id="app"></div>
    <script type="module" crossorigin src="./chunk-b.js"></script>
  </body>
</html>`;

test("the walk names: the page of the map, its walk frame, and the map of a walk frame", async () => {
  const app = await scope();

  expect(app.run(walkPageName, { input: "sign-in" })).toBe("Map · sign-in");
  expect(app.run(walkFrameName, { input: "sign-in" })).toBe("sign-in · walk");
  expect(app.run(walkNameOf, { input: "sign-in · walk" })).toBe("sign-in");
  expect(app.run(walkNameOf, { input: "sign-in · name" })).toBeNull();
  expect(app.run(walkNameOf, { input: " · walk" })).toBeNull();
});

test("the walk document is one HTML file with its JS, its CSS and its map, and the map reads back", async () => {
  const app = await scope();
  const js = `const end = "</script>"; document.body.dataset.end = end;`;
  const css = "body{color:red}";

  const html = app.run(walkDocument, { input: { html: built, js, css, data } });

  expect(html).not.toContain("chunk-a.css");
  expect(html).not.toContain("chunk-b.js");
  expect(html).toContain("<style>body{color:red}</style>");
  expect(html).toContain(`const end = "<\\/script>"`);
  expect(html.match(/<\/script>/g)).toHaveLength(2);
  expect(app.run(walkDataOf, { input: html })).toEqual({ kind: "found", data });
});

test("a document with no map, or with a map that does not parse, has no walk", async () => {
  const app = await scope();

  expect(app.run(walkDataOf, { input: built })).toEqual({ kind: "none" });
  const broken = `<script type="application/json" id="easel-walk">{"name":</script>`;
  expect(app.run(walkDataOf, { input: broken })).toEqual({ kind: "none" });
  const other = `<script type="application/json" id="easel-walk">{"name":1}</script>`;
  expect(app.run(walkDataOf, { input: other })).toEqual({ kind: "none" });
});

test("the picks of a call that waits: each answer in the order of the contract, with its state", async () => {
  const app = await scope();

  expect(app.run(walkPicks, { input: { map, from: "idle", call: "fixture.go" } })).toEqual([
    { answer: "done", to: "done" },
    { answer: "refused", to: null },
    { answer: "link", to: null },
  ]);
  expect(app.run(walkPicks, { input: { map, from: "idle", call: "fixture.none" } })).toEqual([]);
});
