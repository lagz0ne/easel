import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";

import { checkArgs, derivedMaps, mapFindings, placedFindings } from "@/map/check-run.server";
import { deriveOf } from "@/map/source.server";

const root = join(import.meta.dirname, "..");
const folder = mkdtempSync(join(tmpdir(), "map-source-"));
const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;

afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  await scope.close();
});

test("deriveOf finds the cell of a label in src/ with its view and its actions, and says missing for a label that no cell has", async () => {
  const found = await scope.run(deriveOf, { input: { root, label: "home.signInStep" } });
  expect(found.kind).toBe("derived");
  if (found.kind !== "derived") return;

  expect(found.derived.cell.file).toBe(join(root, "src/home/signin.ts"));
  expect(found.derived.view).toBe(join(root, "src/home/home.tsx"));
  expect(found.derived.map.cell).toBe("home.signInStep");
  expect(found.derived.actions.length).toBeGreaterThan(0);

  expect(await scope.run(deriveOf, { input: { root, label: "no.such.cell" } })).toEqual({
    kind: "missing",
  });
}, 60_000);

test("each finding of a map gets the file and the line that a person must change", async () => {
  const checked = await scope.run(derivedMaps, { input: root });
  expect(checked.map((each) => each.name)).toEqual(["sign-in"]);

  const designed = join(folder, "maps.designed");
  const lines = readFileSync(join(root, "maps.designed"), "utf8").split("\n").filter(Boolean);
  writeFileSync(designed, `${lines.slice(0, 3).join("\n")}\nsign-in: state nowhere\n`);
  const findings = scope.run(mapFindings, { input: { checked, designed } });
  const placed = await scope.run(placedFindings, {
    input: { root, findings, checked, designed },
  });

  expect(new Set(placed.map((each) => each.rule))).toEqual(
    new Set(["map/gone", "map/state", "map/answer"]),
  );
  expect(placed.find((each) => each.rule === "map/gone")).toMatchObject({
    path: designed,
    line: 4,
  });
  for (const each of placed) expect(each.line).toBeGreaterThan(0);
  const pressed = placed.find((each) => each.what.includes("askForCode failed has no designed"));
  expect(pressed).toMatchObject({ path: "src/home/home.tsx", rule: "map/state" });
  expect(pressed?.line).toBeGreaterThan(1);
}, 60_000);

test("the map check takes --write and --designed <file>, and refuses any other argument", () => {
  const ask = (args: string[]) => scope.run(checkArgs, { input: { args, root } });

  expect(ask([])).toEqual({
    kind: "check",
    write: false,
    designed: join(root, "maps.designed"),
    shown: "maps.designed",
  });
  expect(ask(["--write", "--designed", "/tmp/m.designed"])).toEqual({
    kind: "check",
    write: true,
    designed: "/tmp/m.designed",
    shown: "/tmp/m.designed",
  });
  expect(ask(["--designed"])).toEqual({ kind: "wrong" });
  expect(ask(["--json"])).toEqual({ kind: "wrong" });
});
