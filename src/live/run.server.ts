import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capsule, operation } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { z } from "zod";

import { localChromium } from "@/speed/page.server";

import { designLook, livePut, putDesign, putTake, readLive } from "./board.server";
import { startFixture, stopFixture } from "./fixture.server";
import type { Fixture } from "./fixture.server";
import { livePlace } from "./plan";
import { screens, statusName } from "./screens";
import {
  ciWarnings,
  fixtureAnswers,
  fixtureAsks,
  fixtureEnv,
  fixtureFrames,
  fixtureName,
  fixturePins,
  keptDir,
  liveBinary,
  liveCanvas,
  liveNoise,
  liveOutput,
  liveWaits,
  reopenNote,
  setupViewport,
  statusSize,
  viewerName,
  writerEnv,
} from "./settings";
import { liveStatusHtml } from "./status";
import type { LiveStatus, TakeRecord } from "./status";
import { takeAll } from "./takes.server";
import type { Shot } from "./takes.server";
import { liveFindings } from "./values";

const shots = z.custom<Shot[]>();
const browser = z.custom<Browser>();
const built = { build: z.number().int().positive(), commit: z.string() };

export const liveReport = operation({
  label: "liveScreens.report",
  input: z.object({ status: z.custom<LiveStatus>(), looked: z.boolean() }),
  depends: { output: liveOutput, warn: ciWarnings },
  run: ({ output, warn }, { input: { status, looked } }) => {
    const takeLines = status.takes.map(
      (t) => `live-screens: ${t.screen} ${t.take}: ${t.word}${t.why ? `: ${t.why}` : ""}`,
    );
    const lookLines = looked
      ? []
      : ["live-screens: the look of design-system was not read: no check of the values"];
    const findingLines = status.findings.map(
      (f) =>
        `live-screens: V6 ${f.screen} ${f.take}: the ${f.kind} ${f.value} is not in the design system${f.where ? ` (${f.where})` : ""}`,
    );

    const bad = status.takes.filter((t) => t.word === "failed" || t.word === "differs").length;
    const values = status.findings.length;
    const warnings =
      values > 0 && warn
        ? [`::warning::${values} values of the live screens are not in the design system (V6)`]
        : [];
    const good = status.takes.length - bad;
    const last = `live-screens: build ${status.build}: ${good} of ${status.takes.length} takes good, ${values} values not in the design system: ${bad > 0 ? "red" : "OK"}`;

    const lines = [...takeLines, ...lookLines, ...findingLines, ...warnings, last];
    output.write(lines.map((line) => `${line}\n`).join(""));
    return { takes: status.takes.length, bad, values };
  },
});

export const liveDry = operation({
  label: "liveScreens.dry",
  input: z.object({ ...built, shots, dry: z.string(), work: z.string() }),
  depends: { designLook, liveFindings, liveStatusHtml, liveReport },
  run: (deps, { input: { build, commit, shots, dry, work } }) => {
    mkdirSync(dry, { recursive: true });
    for (const shot of shots) {
      const name = `${shot.screen.key}-${shot.take.key.replace(" ", "-")}.png`;
      if (shot.png) writeFileSync(join(dry, name), shot.png);
    }

    const read = deps.designLook.run({ input: work });
    const look = read.kind === "read" ? read.look : null;
    const values = shots.flatMap((s) => (s.values ? [s.values] : []));
    const findings = look ? deps.liveFindings.run({ input: { look, values } }) : [];
    const takes: TakeRecord[] = shots.map((s) => ({
      screen: s.screen.key,
      take: s.take.key,
      word: s.png ? "new" : "failed",
      after: s.png ? build : null,
      before: null,
      ...(s.why ? { why: s.why } : {}),
    }));
    const status = { build, commit, designs: {}, takes, values, findings };
    writeFileSync(join(dry, "status.html"), deps.liveStatusHtml.run({ input: status }));
    return deps.liveReport.run({ input: { status, looked: look !== null } });
  },
});

export const livePutAll = operation({
  label: "liveScreens.putAll",
  input: z.object({ ...built, shots, browser, work: z.string() }),
  depends: {
    readLive,
    putDesign,
    putTake,
    designLook,
    liveFindings,
    liveStatusHtml,
    livePlace,
    livePut,
    liveReport,
  },
  run: async (deps, { input: { build, commit, shots, browser, work } }) => {
    const live = deps.readLive.run({ input: work });
    const designs: Record<string, number> = { ...live.old?.designs };
    for (const row of screens.keys()) {
      await deps.putDesign.run({ input: { browser, live, designs, row, work } });
    }

    const takes: TakeRecord[] = [];
    for (const shot of shots) {
      takes.push(await deps.putTake.run({ input: { browser, live, shot, work, build } }));
    }

    const read = deps.designLook.run({ input: work });
    if (read.kind === "none") throw new Error(read.why);

    const look = read.look;
    const values = shots.flatMap((s) => (s.values ? [s.values] : []));
    const findings = deps.liveFindings.run({ input: { look, values } });
    const status: LiveStatus = { build, commit, designs, takes, values, findings };
    const file = join(work, "status.html");
    writeFileSync(file, deps.liveStatusHtml.run({ input: status }));

    const at = deps.livePlace.run({ input: { role: "status" } });
    const page = live.page;
    deps.livePut.run({ input: { file, at, name: statusName, page, frame: live.statusFrame } });
    return deps.liveReport.run({ input: { status, looked: true } });
  },
});

export const liveScreensRun = operation({
  label: "liveScreens.run",
  input: z.object({
    ...built,
    dry: z.string().optional(),
    screen: z.string().optional(),
    take: z.string().optional(),
  }),
  depends: {
    localChromium,
    startFixture,
    stopFixture,
    takeAll,
    liveDry,
    livePutAll,
    output: liveOutput,
  },
  run: async (deps, { input, clock }) => {
    const { build, commit, dry } = input;
    const work = mkdtempSync(join(tmpdir(), "easel-live-"));

    const executablePath = deps.localChromium.run();
    const browser = await chromium.launch({ executablePath });
    const started: Fixture[] = [];
    try {
      const begun = clock.currentTimeMillis();
      const at = { browser, work, build };
      const fixture = await deps.startFixture.run({ input: { ...at, chromium: executablePath } });
      started.push(fixture);

      const took = clock.currentTimeMillis() - begun;
      deps.output.write(`live-screens: the fixture took ${took} ms\n`);

      const only = { screen: input.screen, take: input.take };
      const shots = await deps.takeAll.run({ input: { browser, fixture, build, ...only } });
      if (dry) return deps.liveDry.run({ input: { build, commit, shots, dry, work } });

      return await deps.livePutAll.run({ input: { build, commit, shots, browser, work } });
    } finally {
      await browser.close();
      for (const fixture of started) await deps.stopFixture.run({ input: fixture.server });
      rmSync(work, { recursive: true, force: true });
    }
  },
});

export const liveScreens = capsule({
  label: "liveScreens",
  config: {
    output: liveOutput,
    binary: liveBinary,
    writerEnv,
    fixtureEnv,
    canvas: liveCanvas,
    kept: keptDir,
    warn: ciWarnings,
    fixtureName,
    viewer: viewerName,
    pins: fixturePins,
    statusSize,
    viewport: setupViewport,
    waits: liveWaits,
    asks: fixtureAsks,
    answers: fixtureAnswers,
    note: reopenNote,
    frames: fixtureFrames,
    noise: liveNoise,
  },
  exports: { liveScreensRun },
});
