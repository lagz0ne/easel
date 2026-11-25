import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";
import { z } from "zod";

import { designedFile } from "@/map/check";
import { mapScreens } from "@/map/screens.server";

const root = join(import.meta.dirname, "..");
const folder = mkdtempSync(join(tmpdir(), "map-screens-"));
const binary = join(folder, "easel");

writeFileSync(
  binary,
  `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dirname, "support/fake-easel-cli.ts")}" "$@"\n`,
);

chmodSync(binary, 0o755);

const said: string[] = [];
const output = { write: (text: string) => said.push(text) };
const env = { ...process.env, FAKE_EASEL_DIR: folder };

const scope = await createScope({
  capsules: [exits({ file: process.env.TINKER_EXITS }), mapScreens({ root, output, binary, env })],
}).ready;

afterAll(async () => {
  await scope.close();
  rmSync(folder, { recursive: true, force: true });
});

const designed = join(root, designedFile);

const fakeState = z.object({
  pages: z.array(z.object({ key: z.string(), name: z.string() })),
  frames: z.array(z.object({ name: z.string(), page: z.string().nullable() })),
});

const stateNow = () =>
  fakeState.parse(JSON.parse(readFileSync(join(folder, "state.json"), "utf8")));

const linesOf = () => said.join("").split("\n").filter(Boolean);

test("the maps go on their page: a picture and a card for each state, the walk and the list; the next run puts nothing new", async () => {
  said.length = 0;
  const first = await scope.run(mapScreens.mapScreensRun, { input: { designed } });
  expect(first).toEqual({ maps: 1, failed: 0 });
  const made = linesOf();
  expect(made.some((line) => /^map-screens: sign-in · \S.* new$/.test(line))).toBe(true);
  expect(made).toContain("map-screens: sign-in · walk: new");
  expect(made).toContain("map-screens: Maps: new");
  expect(made.at(-1)).toBe("map-screens: 1 maps, 0 pictures failed: OK");

  const page = stateNow().pages.find((each) => each.name === "Map · sign-in");
  const stray = join(folder, "stray.html");
  writeFileSync(stray, "<p>gone</p>");
  Bun.spawnSync(
    [binary, "put", "product", stray, "--name", "stray", "--page", page?.key ?? "", "--json"],
    { env },
  );

  said.length = 0;
  const second = await scope.run(mapScreens.mapScreensRun, { input: { designed } });
  expect(second).toEqual({ maps: 1, failed: 0 });
  const again = linesOf();
  expect(again.filter((line) => line.endsWith(": new"))).toEqual([]);
  expect(again).toContain("map-screens: sign-in · walk: same");
  expect(again).toContain("map-screens: Maps: same");
  expect(again).toContain("map-screens: stray: not in the map now");
  expect(stateNow().frames.filter((frame) => frame.page === page?.key).length).toBeGreaterThan(3);
}, 240_000);

test("a dry run writes the pictures, the cards, the walk and the list, and puts nothing", async () => {
  const dry = join(folder, "dry");
  const calls = stateNow();
  said.length = 0;

  const ran = await scope.run(mapScreens.mapScreensRun, {
    input: { designed, dry, only: "sign-in" },
  });
  expect(ran).toEqual({ maps: 1, failed: 0 });
  const files = readdirSync(dry);
  expect(files).toContain("maps.html");
  expect(files).toContain("sign-in · walk.html");
  expect(files.some((file) => file.endsWith(".png"))).toBe(true);
  expect(files.some((file) => file.endsWith(" · card.html"))).toBe(true);
  expect(linesOf().some((line) => line.endsWith(": taken"))).toBe(true);
  expect(stateNow()).toEqual(calls);
  expect(existsSync(join(root, "dist"))).toBe(true);
}, 240_000);
