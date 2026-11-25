import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { caseOverBoard } from "@/viewer/cases";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function app() {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => scope.close());
  return scope;
}

test("SPEC-cases decision 4: each switch and the fixture that a case sets win over the board value; a switch that the case does not set keeps the board value", async () => {
  const scope = await app();
  const board = { theme: "dark", locale: "vi", fixture: "empty" };
  const values = { fixture: "many", switches: { locale: "en" } };

  expect(scope.run(caseOverBoard, { input: { board, values } })).toEqual({
    theme: "dark",
    locale: "en",
    fixture: "many",
  });
});

test("SPEC-cases decision 4: a case with no fixture leaves the fixture of the board", async () => {
  const scope = await app();
  const board = { fixture: "empty" };
  const values = { fixture: null, switches: { theme: "dark" } };

  expect(scope.run(caseOverBoard, { input: { board, values } })).toEqual({
    fixture: "empty",
    theme: "dark",
  });
});
