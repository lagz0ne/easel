import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { preset } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import type { MapJson } from "@/map/text";
import { pickPlace, requestMode } from "@/viewer/draft";
import { askForIt, leaveWalk, walkPick, walkPosted, walkStep } from "@/viewer/walk";
import { walking } from "@/viewer/walking";
import type { Walk } from "@/viewer/walking";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const map: MapJson = {
  cell: "fixture.step",
  start: "idle",
  view: "src/fixture.tsx",
  calls: [],
  states: ["idle", "done"].map((state, column) => ({
    state,
    column,
    row: 0,
    sample: { kind: state },
    actions: [],
    run: null,
  })),
  moves: [
    {
      from: "idle",
      to: "done",
      action: "fixture.press",
      answer: { call: "fixture.go", kind: "done", fault: false },
      effects: [],
    },
  ],
  stays: [],
};

const shownIdle: Walk = {
  map: "fixture",
  path: [{ state: "idle", value: { kind: "idle" } }],
  told: { kind: "none" },
  waits: [],
};

const place = {
  page: "map",
  frameId: "a00000000001",
  frameName: "fixture · idle",
  version: 1,
  kit: null,
  x: 10,
  y: 20,
  box: { x: 0, y: 0, w: 1024, h: 840 },
};

async function askingIn() {
  const app = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS })],
    presets: [preset(walking, shownIdle), preset(requestMode, true)],
  }).ready;
  closers.push(() => app.close());
  return app;
}

test("a state that the code posts while a request is in work does not show: the walk gives the frame the shown value again", async () => {
  const app = await askingIn();
  const post = { easel: "walk", kind: "state", state: "done", value: { kind: "done" } };

  expect(app.run(walkPosted, { input: { post, map } })).toEqual({
    kind: "held",
    value: { kind: "idle" },
  });
  expect(app.controller(walking).get()).toEqual(shownIdle);
});

test("Leave keeps the walk while a request draft is open", async () => {
  const app = await askingIn();
  app.run(pickPlace, { input: { canvas: "home", place } });

  expect(app.run(leaveWalk)).toEqual({ kind: "stays" });
  expect(app.controller(walking).get()).toEqual(shownIdle);
});

test("the walk does nothing for a post that is not of the walk, a Back at the first step, a pick of no wait, or Ask for it with nothing told", async () => {
  const app = await askingIn();
  const ask = { canvas: "home", place, text: "Add the state." };

  expect(app.run(walkPosted, { input: { post: { easel: "part" }, map } })).toEqual({
    kind: "ignored",
  });
  expect(app.run(walkStep, { input: "back" })).toEqual({ kind: "stays" });
  expect(app.run(walkPick, { input: { id: 1, answer: "done" } })).toEqual({ kind: "stays" });
  expect(app.run(askForIt, { input: ask })).toEqual({ kind: "stays" });
  expect(app.controller(walking).get()).toEqual(shownIdle);
});
