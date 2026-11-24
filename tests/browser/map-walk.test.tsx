import { exits } from "@tinkered/cli/test";
import { createScope, data, operation, rpc } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";
import { z } from "zod";

import type { MapJson } from "@/map/text";
import { walkPost } from "@/map/walk";
import type { WalkData, WalkPost } from "@/map/walk";
import { walkBoot } from "@/map/walk-frame";

const tool = await createScope({ capsules: [exits({ store: localStorage })] }).ready;

const contract = {
  "fixture.walkGo": {
    input: z.object({}),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done") }),
      z.object({ kind: z.literal("refused") }),
    ]),
  },
};

const api = rpc(contract);

const step = data<{ kind: string }>({ label: "fixture.walkStep", initial: { kind: "idle" } });

const go = operation({
  label: "fixture.walkPress",
  depends: { call: api["fixture.walkGo"], step: step.controller },
  run: async ({ call, step }) => step.set(await call.run({ input: {} })),
});

function Screen() {
  const now = useData(step);
  const press = useRun(go);
  return (
    <main>
      <p role="status">{now.kind}</p>
      <button type="button" onClick={() => press.run()}>
        Go
      </button>
    </main>
  );
}

const map: MapJson = {
  cell: "fixture.walkStep",
  start: "idle",
  view: "tests/browser/map-walk.test.tsx",
  calls: [{ call: "fixture.walkGo", answers: ["done", "refused", "link"] }],
  states: ["idle", "done", "refused"].map((state, at) => ({
    state,
    column: at === 0 ? 0 : 1,
    row: at === 0 ? 0 : at - 1,
    sample: { kind: state },
    actions: at === 0 ? ["fixture.walkPress"] : [],
    run: null,
  })),
  moves: [],
  stays: [],
};

const walk: WalkData = {
  name: "fixture",
  map,
  replies: {
    "fixture.walkGo": [
      { kind: "done", reply: { ok: true, value: { kind: "done" } } },
      { kind: "refused", reply: { ok: true, value: { kind: "refused" } } },
      { kind: "link", reply: { ok: false, kind: "link", payload: null } },
    ],
  },
};

function heard() {
  const posts: WalkPost[] = [];
  const hear = (event: MessageEvent) => {
    const post = walkPost.safeParse(event.data);
    if (post.success) posts.push(post.data);
  };
  addEventListener("message", hear);
  onTestFinished(() => removeEventListener("message", hear));
  return posts;
}

function hostWith(json: string | null) {
  const host = document.body.appendChild(document.createElement("div"));
  const element = document.createElement("script");
  element.type = "application/json";
  element.id = "easel-walk";
  element.textContent = json;

  if (json !== null) document.head.append(element);
  onTestFinished(() => {
    host.remove();
    element.remove();
  });
  return host;
}

const order = (message: object) => postMessage({ easel: "walk", ...message }, "*");

test("a walk document with no map does not start", async () => {
  const host = hostWith(null);
  const input = { page: document, to: window, host, View: Screen, cell: step, actions: [go] };

  expect(await tool.run(walkBoot, { input })).toEqual({ kind: "noMap" });
});

test("the walk document runs the real press; a call waits for the pick of its answer; go sets the cell", async () => {
  const posts = heard();
  const host = hostWith(JSON.stringify(walk));
  const input = { page: document, to: window, host, View: Screen, cell: step, actions: [go] };

  expect(await tool.run(walkBoot, { input })).toEqual({ kind: "walking", map: "fixture" });
  await expect.element(page.getByRole("status")).toHaveTextContent("idle");
  await expect
    .poll(() => posts.at(-1))
    .toEqual({
      easel: "walk",
      kind: "state",
      state: "idle",
      value: { kind: "idle" },
    });

  await page.getByRole("button", { name: "Go" }).click();
  await expect
    .poll(() => posts.at(-1))
    .toEqual({ easel: "walk", kind: "waits", calls: [{ id: 1, call: "fixture.walkGo" }] });
  await expect.element(page.getByRole("status")).toHaveTextContent("idle");

  order({ kind: "answer", id: 9, answer: "done" });
  order({ kind: "answer", id: 1, answer: "unknown" });
  order({ kind: "answer", id: 1, answer: "refused" });
  await expect.element(page.getByRole("status")).toHaveTextContent("refused");
  expect(posts).toContainEqual({
    easel: "walk",
    kind: "state",
    state: "refused",
    value: { kind: "refused" },
  });

  await page.getByRole("button", { name: "Go" }).click();
  await expect
    .poll(() => posts.at(-1))
    .toEqual({ easel: "walk", kind: "waits", calls: [{ id: 2, call: "fixture.walkGo" }] });
  order({ kind: "go", value: { kind: "idle" } });
  await expect.element(page.getByRole("status")).toHaveTextContent("idle");
  expect(posts).toContainEqual({ easel: "walk", kind: "waits", calls: [] });
  await expect.poll(() => posts.at(-1)).toMatchObject({ kind: "state", state: "idle" });
});
