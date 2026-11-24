import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { walkBackend, walkBackends } from "@/map/walk";
import { backendSwitch, walkHold } from "@/viewer/walk-backend";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function app() {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => scope.close());
  return scope;
}

test("the switch of the backend is the tag backend: its values come from the parse, and examples is the first", () => {
  expect(backendSwitch).toEqual({
    name: walkBackend.label,
    values: walkBackends.options,
    default: "examples",
  });
  expect(backendSwitch.name).toBe("backend");
  expect(backendSwitch.values).toEqual(["examples", "live"]);
});

test("with example answers the screen runs, whatever the live server does", async () => {
  const scope = await app();
  for (const server of ["none", "starting", "ready", "failed", "gone"] as const) {
    expect(scope.run(walkHold, { input: { backend: "examples", server } })).toEqual({
      kind: "runs",
    });
  }
});

test("with the live server the screen runs only on a ready server; else the walk is held and says why", async () => {
  const scope = await app();
  const hold = (server: "none" | "starting" | "ready" | "failed" | "gone") =>
    scope.run(walkHold, { input: { backend: "live", server } });

  expect(hold("ready")).toEqual({ kind: "runs" });
  expect(hold("none")).toEqual({
    kind: "held",
    why: "No live server is set up for this easel.",
  });
  expect(hold("starting")).toEqual({
    kind: "held",
    why: "The live server of this build starts.",
  });
  expect(hold("failed")).toEqual({ kind: "held", why: "The live server did not start." });
  expect(hold("gone")).toEqual({
    kind: "held",
    why: "The live server stopped. The walk starts again when it is ready.",
  });
});
