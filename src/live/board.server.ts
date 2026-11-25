import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { operation } from "@tinkered/core";
import type { Browser } from "playwright";
import { z } from "zod";

import { liveName, livePlace, livePlan } from "./plan";
import { livePage, screens, statusName } from "./screens";
import { keptDir, liveBinary, liveCanvas, statusSize, writerEnv } from "./settings";
import { liveStatusRead } from "./status";
import type { LiveStatus, TakeRecord } from "./status";
import { liveCaptioned, liveSamePixels } from "./takes.server";
import type { Shot } from "./takes.server";
import { liveLook } from "./values";

const listed = z.object({
  frames: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      page: z.string().nullable(),
      version: z.number(),
    }),
  ),
});

const written = z.object({ id: z.string(), version: z.number() });

const pages = z.object({ pages: z.array(z.object({ key: z.string(), name: z.string() })) });

export type Frame = z.infer<typeof listed>["frames"][number];

export type Live = {
  page: string;
  frames: Frame[];
  byName: Map<string, Frame>;
  old: LiveStatus | null;
  statusFrame: Frame | undefined;
};

type ShotFrames = {
  row: number;
  afterName: string;
  beforeName: string;
  afterFrame: Frame | undefined;
  beforeFrame: Frame | undefined;
  base: Omit<TakeRecord, "word">;
};

const browser = z.custom<Browser>();
const live = z.custom<Live>();
const frame = z.custom<Frame>();
const shotFrames = z.custom<ShotFrames>();
const spot = z.object({ x: z.number(), y: z.number() });

export const easelAnswer = operation({
  label: "liveScreens.easelAnswer",
  input: z.array(z.string()),
  depends: { binary: liveBinary, env: writerEnv },
  run: ({ binary, env }, { input: command }) => {
    const out = Bun.spawnSync([binary, ...command, "--json"], { env: { ...env } });
    if (out.exitCode !== 0) {
      const said = `${out.stdout.toString()}${out.stderr.toString()}`;
      return {
        kind: "refused",
        said: `live-screens: easel ${command.join(" ")}: ${said}`,
      } as const;
    }

    const last = out.stdout.toString().trim().split("\n").at(-1) ?? "null";
    const value: unknown = JSON.parse(last);
    return { kind: "answered", value } as const;
  },
});

export const liveEasel = operation({
  label: "liveScreens.easel",
  input: z.array(z.string()),
  depends: { easelAnswer },
  run: ({ easelAnswer }, { input: command }): unknown => {
    const answer = easelAnswer.run({ input: command });
    switch (answer.kind) {
      case "answered":
        return answer.value;
      case "refused":
        throw new Error(answer.said);
    }
  },
});

export const designLook = operation({
  label: "liveScreens.designLook",
  input: z.string(),
  depends: { easelAnswer, liveEasel, liveLook },
  run: ({ easelAnswer, liveEasel, liveLook }, { input: work }) => {
    const listing = easelAnswer.run({ input: ["ls", "design-system"] });
    if (listing.kind === "refused") return { kind: "none", why: listing.said } as const;

    const frames = listed.parse(listing.value).frames;
    const sheets = frames.map((each) => {
      const file = join(work, `ds-${each.id}.html`);
      liveEasel.run({ input: ["get", "design-system", each.id, "-o", file] });
      const found = readFileSync(file, "utf8").matchAll(
        /<style data-doop-tokens>([\s\S]*?)<\/style>/g,
      );
      return [...found].map((match) => `${match[1] ?? ""}\n`).join("");
    });
    return { kind: "read", look: liveLook.run({ input: sheets.join("") }) } as const;
  },
});

export const livePageKey = operation({
  label: "liveScreens.pageKey",
  depends: { liveEasel, canvas: liveCanvas },
  run: ({ liveEasel, canvas }) => {
    const all = pages.parse(liveEasel.run({ input: ["pages", canvas] })).pages;
    const found = all.find((page) => page.name === livePage.name);
    if (found) return found.key;

    const made = liveEasel.run({ input: ["page", "new", canvas, livePage.name] });
    return z.object({ key: z.string() }).parse(made).key;
  },
});

export const livePut = operation({
  label: "liveScreens.put",
  input: z.object({
    file: z.string(),
    at: spot,
    name: z.string(),
    page: z.string(),
    frame: frame.optional(),
  }),
  depends: { liveEasel, canvas: liveCanvas, size: statusSize },
  run: ({ liveEasel, canvas, size }, { input: { file, at, name, page, frame } }) => {
    const command = frame
      ? ["put", canvas, file, "--id", frame.id, "--base", String(frame.version)]
      : ["put", canvas, file, "--name", name, "--page", page, "--at", `${at.x},${at.y}`];
    const sized = !frame && name === statusName ? ["--size", size] : [];
    return written.parse(liveEasel.run({ input: [...command, ...sized] }));
  },
});

export const frameFile = operation({
  label: "liveScreens.frameFile",
  input: z.object({ id: z.string(), work: z.string(), end: z.string() }),
  depends: { liveEasel, canvas: liveCanvas },
  run: ({ liveEasel, canvas }, { input: { id, work, end } }) => {
    const file = join(work, `old-${id}.${end}`);
    liveEasel.run({ input: ["get", canvas, id, "-o", file] });
    return file;
  },
});

export const readLive = operation({
  label: "liveScreens.readLive",
  input: z.string(),
  depends: { liveEasel, livePageKey, frameFile, liveStatusRead, canvas: liveCanvas },
  run: (deps, { input: work }): Live => {
    const page = deps.livePageKey.run();
    const frames = listed.parse(deps.liveEasel.run({ input: ["ls", deps.canvas] })).frames;
    const byName = new Map(frames.filter((f) => f.page === page).map((f) => [f.name, f]));
    const statusFrame = byName.get(statusName);
    if (!statusFrame) return { page, frames, byName, old: null, statusFrame };

    const file = deps.frameFile.run({ input: { id: statusFrame.id, work, end: "html" } });
    const read = deps.liveStatusRead.run({ input: readFileSync(file, "utf8") });
    const old = read.kind === "read" ? read.status : null;
    return { page, frames, byName, old, statusFrame };
  },
});

export const putDesign = operation({
  label: "liveScreens.putDesign",
  input: z.object({
    browser,
    live,
    designs: z.custom<Record<string, number>>(),
    row: z.number(),
    work: z.string(),
  }),
  depends: { liveEasel, liveName, livePlace, livePut, liveCaptioned, canvas: liveCanvas },
  run: async (deps, { input: { browser, live, designs, row, work } }) => {
    const screen = screens[row];
    const designed = live.frames.find((f) => f.id === screen?.design.id);
    if (!screen || !designed) return;

    const name = deps.liveName.run({ input: { role: "design", design: screen.design.name } });
    const current = live.byName.get(name);
    if (current && designs[screen.design.id] === designed.version) return;

    const shotFile = join(work, `design-${screen.key}.webp`);
    const shot = ["shot", deps.canvas, screen.design.id, "-o", shotFile, "--scale", "1"];
    deps.liveEasel.run({ input: shot });
    const text = `design v${designed.version}`;
    const png = await deps.liveCaptioned.run({
      input: { browser, png: readFileSync(shotFile), text },
    });
    const file = join(work, `design-${screen.key}.png`);
    writeFileSync(file, png);

    const at = deps.livePlace.run({ input: { role: "design", row } });
    deps.livePut.run({ input: { file, at, name, page: live.page, frame: current } });
    designs[screen.design.id] = designed.version;
  },
});

export const framesOfShot = operation({
  label: "liveScreens.framesOfShot",
  input: z.object({ live, shot: z.custom<Shot>() }),
  depends: { liveName },
  run: ({ liveName }, { input: { live, shot } }): ShotFrames => {
    const design = shot.screen.design.name;
    const take = shot.take.key;
    const was = live.old?.takes.find((t) => t.screen === shot.screen.key && t.take === take);

    const afterName = liveName.run({ input: { role: "live", design, take } });
    const beforeName = liveName.run({ input: { role: "before", design, take } });
    const afterFrame = live.byName.get(afterName);
    const after = afterFrame ? (was?.after ?? null) : null;

    return {
      row: screens.indexOf(shot.screen),
      afterName,
      beforeName,
      afterFrame,
      beforeFrame: live.byName.get(beforeName),
      base: { screen: shot.screen.key, take, after, before: was?.before ?? null },
    };
  },
});

export const comparedTake = operation({
  label: "liveScreens.comparedTake",
  input: z.object({ browser, frames: shotFrames, png: z.custom<Buffer>(), work: z.string() }),
  depends: { frameFile, liveSamePixels, kept: keptDir },
  run: async (deps, { input: { browser, frames, png, work } }): Promise<TakeRecord> => {
    const { afterFrame, base } = frames;
    if (!afterFrame) return { ...base, word: "failed", why: "the After cannot be read" };

    const file = deps.frameFile.run({ input: { id: afterFrame.id, work, end: "png" } });
    const after = readFileSync(file);
    const same = await deps.liveSamePixels.run({ input: { browser, a: after, b: png } });
    if (same) return { ...base, word: "same" };

    const stem = join(deps.kept, `easel-live-${base.screen}-${base.take.replace(" ", "-")}`);
    writeFileSync(`${stem}-after.png`, after);
    writeFileSync(`${stem}-take.png`, png);
    return { ...base, word: "differs", why: "a take of the same build has other pixels" };
  },
});

export const putNext = operation({
  label: "liveScreens.putNext",
  input: z.object({ live, frames: shotFrames, file: z.string(), work: z.string() }),
  depends: { frameFile, livePlace, livePut },
  run: (deps, { input: { live, frames, file, work } }) => {
    const { row, afterFrame, base } = frames;
    const page = live.page;
    if (afterFrame) {
      const before = deps.frameFile.run({ input: { id: afterFrame.id, work, end: "png" } });
      const at = deps.livePlace.run({ input: { role: "before", row, take: base.take } });
      deps.livePut.run({
        input: { file: before, at, name: frames.beforeName, page, frame: frames.beforeFrame },
      });
    }

    const at = deps.livePlace.run({ input: { role: "live", row, take: base.take } });
    deps.livePut.run({ input: { file, at, name: frames.afterName, page, frame: afterFrame } });
  },
});

export const putTake = operation({
  label: "liveScreens.putTake",
  input: z.object({ browser, live, shot: z.custom<Shot>(), work: z.string(), build: z.number() }),
  depends: { framesOfShot, livePlan, livePlace, livePut, putNext, comparedTake },
  run: async (deps, { input: { browser, live, shot, work, build } }): Promise<TakeRecord> => {
    const frames = deps.framesOfShot.run({ input: { live, shot } });
    const { base } = frames;
    if (!shot.png) return { ...base, word: "failed", why: shot.why ?? "no picture" };

    const file = join(work, `take-${shot.screen.key}-${shot.take.key.replace(" ", "-")}.png`);
    writeFileSync(file, shot.png);
    const plan = deps.livePlan.run({ input: { build, after: base.after } });
    const { row, afterName: name, afterFrame: frame } = frames;
    switch (plan.kind) {
      case "new": {
        const at = deps.livePlace.run({ input: { role: "live", row, take: base.take } });
        deps.livePut.run({ input: { file, at, name, page: live.page, frame } });
        return { ...base, word: "new", after: build };
      }
      case "next":
        deps.putNext.run({ input: { live, frames, file, work } });
        return { ...base, word: "next", after: build, before: plan.before };
      case "compare":
        return deps.comparedTake.run({ input: { browser, frames, png: shot.png, work } });
      case "same":
        return { ...base, word: "same" };
      case "differs":
        return { ...base, word: "differs", why: "a take of the same build has other pixels" };
    }
  },
});
