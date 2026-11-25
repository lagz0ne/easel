import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { capsule, operation } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { z } from "zod";

import { maps, mapsName } from "@/live/screens";
import { localChromium } from "@/speed/page.server";

import { putList, putMap, writeDry } from "./board.server";
import { mapGraph } from "./card";
import { mapsListHtml } from "./check";
import {
  easelBinary,
  easelEnv,
  mapsCanvas,
  rasterNoise,
  screensOutput,
  screensRoot,
  shotTime,
  shotTimeoutMs,
} from "./screens-settings";
import { arrowLifts, mapOne } from "./shots.server";
import type { Done } from "./shots.server";

const putDone = operation({
  label: "mapScreens.putDone",
  input: z.object({
    browser: z.custom<Browser>(),
    done: z.custom<Done>(),
    dry: z.string().optional(),
    work: z.string(),
  }),
  depends: { putMap, writeDry },
  run: async ({ putMap, writeDry }, { input: { browser, done, dry, work } }) => {
    const checks = done.findings.map((f) => `map-screens: check: ${f.rule} ${f.what}`);
    if (dry) return [...checks, ...writeDry.run({ input: { dir: dry, done } })];

    const put = await putMap.run({ input: { browser, done, work } });
    return [...checks, ...put.words.map((word) => `map-screens: ${word}`)];
  },
});

const listOf = operation({
  label: "mapScreens.listOf",
  input: z.object({
    done: z.custom<readonly Done[]>(),
    dry: z.string().optional(),
    work: z.string(),
  }),
  depends: { mapsListHtml, putList },
  run: ({ mapsListHtml, putList }, { input: { done, dry, work } }) => {
    const rows = done.map(({ entry, map, findings }) => ({
      name: entry.name,
      cell: map.cell,
      start: map.start,
      states: map.states.length,
      findings,
    }));
    const html = mapsListHtml.run({ input: rows });
    if (dry) {
      writeFileSync(join(dry, "maps.html"), html);
      return [];
    }
    if (!rows.length) return [];
    return [`map-screens: ${mapsName}: ${putList.run({ input: { html, work } })}`];
  },
});

export const mapScreensRun = operation({
  label: "mapScreens.run",
  input: z.object({
    dry: z.string().optional(),
    only: z.string().optional(),
    designed: z.string(),
  }),
  depends: {
    localChromium,
    arrowLifts,
    mapGraph,
    mapOne,
    putDone,
    listOf,
    root: screensRoot,
    output: screensOutput,
  },
  run: async (deps, { input: { dry, only, designed } }) => {
    const { root, output } = deps;
    mkdirSync(join(root, "dist"), { recursive: true });
    const work = mkdtempSync(join(root, "dist", "map-show-"));
    const executablePath = deps.localChromium.run();
    const browser = await chromium.launch({ executablePath });

    try {
      const chosen = maps.filter((entry) => !only || entry.name === only);
      const lifts = await deps.arrowLifts.run({ input: browser });
      const graph = deps.mapGraph.run({ input: readFileSync(join(root, "tinker.graph"), "utf8") });
      const done: Done[] = [];
      for (const entry of chosen) {
        done.push(
          await deps.mapOne.run({ input: { browser, lifts, graph, entry, work, designed } }),
        );
      }

      let failed = 0;
      for (const each of done) {
        failed += each.shots.filter((shot) => !shot.png).length;
        const lines = await deps.putDone.run({ input: { browser, done: each, dry, work } });
        output.write(lines.map((line) => `${line}\n`).join(""));
      }
      const listed = deps.listOf.run({ input: { done, dry, work } });
      const verdict = failed ? "red" : "OK";
      const last = `map-screens: ${done.length} maps, ${failed} pictures failed: ${verdict}`;
      output.write([...listed, last].map((line) => `${line}\n`).join(""));
      return { maps: done.length, failed };
    } finally {
      await browser.close();
      rmSync(work, { recursive: true, force: true });
    }
  },
});

export const mapScreens = capsule({
  label: "mapScreens",
  config: {
    root: screensRoot,
    output: screensOutput,
    binary: easelBinary,
    env: easelEnv,
    canvas: mapsCanvas,
    time: shotTime,
    timeout: shotTimeoutMs,
    noise: rasterNoise,
  },
  exports: { mapScreensRun },
});
