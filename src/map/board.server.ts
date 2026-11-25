import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { operation } from "@tinkered/core";
import type { Browser } from "playwright";
import { z } from "zod";

import { mapShot, mapsName } from "@/live/screens";
import type { MapEntry } from "@/live/screens";

import { mapBoard, mapColumns, mapFrameName, mapGap, mapOrder, mapRelation } from "./canvas";
import type { Relation } from "./canvas";
import { easelBinary, easelEnv, mapsCanvas } from "./screens-settings";
import { samePixels } from "./shots.server";
import type { Card, Done, Shot } from "./shots.server";
import { walkFrameName, walkPageName } from "./walk";

const listed = z.object({
  rev: z.number(),
  frames: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      page: z.string().nullable(),
      version: z.number(),
      w: z.number(),
      h: z.number(),
      section: z.string().nullable().optional(),
    }),
  ),
});

const laidOut = z.object({
  sections: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      gap: z.number(),
      columns: z.array(z.array(z.string())),
    }),
  ),
});

const written = z.object({ id: z.string(), version: z.number() });

const pages = z.object({ pages: z.array(z.object({ key: z.string(), name: z.string() })) });

export type Frame = z.infer<typeof listed>["frames"][number];

export type Board = {
  entry: MapEntry;
  page: string;
  section: string;
  gone: string;
  columns: string[][];
  byName: Map<string, Frame>;
  ids: Record<string, string>;
  words: string[];
  work: string;
};

const board = z.custom<Board>();

export const easelCall = operation({
  label: "mapScreens.easelCall",
  input: z.array(z.string()),
  depends: { binary: easelBinary, env: easelEnv },
  run: ({ binary, env }, { input: command }): unknown => {
    const out = Bun.spawnSync([binary, ...command, "--json"], { env: { ...env } });
    if (out.exitCode !== 0) {
      const said = `${out.stdout.toString()}${out.stderr.toString()}`;
      throw new Error(`map-screens: easel ${command.join(" ")}: ${said}`);
    }
    return JSON.parse(out.stdout.toString().trim().split("\n").at(-1) ?? "null");
  },
});

export const pageKey = operation({
  label: "mapScreens.pageKey",
  input: z.string(),
  depends: { easelCall, canvas: mapsCanvas },
  run: ({ easelCall, canvas }, { input: name }) => {
    const all = pages.parse(easelCall.run({ input: ["pages", canvas] })).pages;
    const found = all.find((page) => page.name === name);
    if (found) return found.key;

    const made = easelCall.run({ input: ["page", "new", canvas, name] });
    return z.object({ key: z.string() }).parse(made).key;
  },
});

export const framesOn = operation({
  label: "mapScreens.framesOn",
  input: z.string(),
  depends: { easelCall, canvas: mapsCanvas },
  run: ({ easelCall, canvas }, { input: page }) => {
    const all = listed.parse(easelCall.run({ input: ["ls", canvas] })).frames;
    return new Map(all.filter((frame) => frame.page === page).map((frame) => [frame.name, frame]));
  },
});

export const placeFlags = operation({
  label: "mapScreens.placeFlags",
  input: z.object({ to: z.custom<Relation>(), page: z.string() }),
  run: (_, { input: { to, page } }) => {
    switch (to.kind) {
      case "section":
        return ["--page", page, "--section", to.section];
      case "after":
        return ["--after", to.id];
      case "below":
        return ["--below", to.id];
    }
  },
});

export const putShot = operation({
  label: "mapScreens.putShot",
  input: z.object({
    browser: z.custom<Browser>(),
    frame: z.custom<Frame>().optional(),
    file: z.string(),
    png: z.custom<Buffer>(),
    work: z.string(),
  }),
  depends: { easelCall, samePixels, canvas: mapsCanvas },
  run: async (deps, { input: { browser, frame, file, png, work } }) => {
    if (!frame) return null;

    const old = join(work, `old-${frame.id}.png`);
    deps.easelCall.run({ input: ["get", deps.canvas, frame.id, "-o", old] });
    const same = await deps.samePixels.run({ input: { browser, a: readFileSync(old), b: png } });
    if (same) return "same";

    const base = String(frame.version);
    deps.easelCall.run({ input: ["put", deps.canvas, file, "--id", frame.id, "--base", base] });
    return "next";
  },
});

export const placeNew = operation({
  label: "mapScreens.placeNew",
  input: z.object({ board, name: z.string(), file: z.string(), flags: z.array(z.string()) }),
  depends: { mapRelation, placeFlags, easelCall, canvas: mapsCanvas },
  run: (deps, { input: { board, name, file, flags } }) => {
    const { page, section, columns, ids, words } = board;
    const to = deps.mapRelation.run({ input: { section, columns, ids, state: name } });
    const where = deps.placeFlags.run({ input: { to, page } });
    const command = ["put", deps.canvas, file, "--name", name, ...flags, ...where];

    const made = written.parse(deps.easelCall.run({ input: command }));
    ids[name] = made.id;
    words.push(`${name}: new`);
  },
});

export const putState = operation({
  label: "mapScreens.putState",
  input: z.object({
    browser: z.custom<Browser>(),
    board,
    state: z.string(),
    shot: z.custom<Shot>().optional(),
  }),
  depends: { mapFrameName, putShot, placeNew },
  run: async (deps, { input: { browser, board, state, shot } }) => {
    const { entry, columns, ids, words, work } = board;
    const name = deps.mapFrameName.run({ input: { map: entry.name, state } });
    const frame = board.byName.get(name);
    if (frame) ids[name] = frame.id;
    if (!shot?.png) return void words.push(`${name}: failed: ${shot?.why ?? "no picture"}`);

    const file = join(work, `${entry.name}-${columns.flat().indexOf(name)}.png`);
    writeFileSync(file, shot.png);
    const put = await deps.putShot.run({ input: { browser, frame, file, png: shot.png, work } });
    if (put) return void words.push(`${name}: ${put}`);

    deps.placeNew.run({ input: { board, name, file, flags: [] } });
  },
});

export const putCard = operation({
  label: "mapScreens.putCard",
  input: z.object({ board, card: z.custom<Card>() }),
  depends: { placeNew, easelCall, canvas: mapsCanvas },
  run: (deps, { input: { board, card } }) => {
    const { entry, columns, ids, words, work } = board;
    const frame = board.byName.get(card.name);
    const file = join(work, `${entry.name}-${columns.flat().indexOf(card.name)}.html`);
    writeFileSync(file, card.html);
    const size = `${card.size.w}x${card.size.h}`;
    if (!frame) {
      return deps.placeNew.run({
        input: { board, name: card.name, file, flags: ["--size", size] },
      });
    }

    ids[card.name] = frame.id;
    const old = join(work, `old-${frame.id}.html`);
    deps.easelCall.run({ input: ["get", deps.canvas, frame.id, "-o", old] });
    const sameText = readFileSync(old, "utf8") === card.html;
    const sameSize = frame.w === card.size.w && frame.h === card.size.h;
    const base = String(frame.version);
    if (!sameText) {
      deps.easelCall.run({ input: ["put", deps.canvas, file, "--id", frame.id, "--base", base] });
    }
    if (!sameSize) deps.easelCall.run({ input: ["move", deps.canvas, frame.id, "--size", size] });
    words.push(`${card.name}: ${sameText && sameSize ? "same" : "next"}`);
  },
});

export const putWalk = operation({
  label: "mapScreens.putWalk",
  input: z.object({ board, html: z.string() }),
  depends: { walkFrameName, easelCall, canvas: mapsCanvas },
  run: (deps, { input: { board, html } }) => {
    const { entry, page, ids, words, work } = board;
    const { canvas } = deps;
    const name = deps.walkFrameName.run({ input: entry.name });
    const frame = board.byName.get(name);
    const file = join(work, `${entry.name}-walk.html`);
    writeFileSync(file, html);
    if (!frame) {
      const section = ["--page", page, "--section", `${entry.name}: the walk`];
      const size = ["--size", `${mapShot.width}x${mapShot.height}`];
      const command = ["put", canvas, file, "--name", name, ...section, ...size];
      ids[name] = written.parse(deps.easelCall.run({ input: command })).id;
      return void words.push(`${name}: new`);
    }

    ids[name] = frame.id;
    const old = join(work, `old-${frame.id}.html`);
    deps.easelCall.run({ input: ["get", canvas, frame.id, "-o", old] });
    const same = readFileSync(old, "utf8") === html;
    const base = String(frame.version);
    if (!same) {
      deps.easelCall.run({ input: ["put", canvas, file, "--id", frame.id, "--base", base] });
    }
    words.push(`${name}: ${same ? "same" : "next"}`);
  },
});

export const moveGone = operation({
  label: "mapScreens.moveGone",
  input: board,
  depends: { easelCall, framesOn, canvas: mapsCanvas },
  run: (deps, { input: board }) => {
    const { page, gone, ids, words } = board;
    const before = laidOut.parse(
      deps.easelCall.run({ input: ["layout", deps.canvas, "--page", page] }),
    );
    const goneIds = before.sections.find((each) => each.name === gone)?.columns.flat();
    const known = new Set([...Object.values(ids), ...(goneIds ?? [])]);

    for (const frame of deps.framesOn.run({ input: page }).values()) {
      if (known.has(frame.id)) continue;

      const command = ["move", deps.canvas, frame.id, "--page", page, "--section", gone];
      deps.easelCall.run({ input: command });
      words.push(`${frame.name}: not in the map now`);
    }
  },
});

export const putOrder = operation({
  label: "mapScreens.putOrder",
  input: board,
  depends: { easelCall, mapOrder, placeFlags, canvas: mapsCanvas },
  run: (deps, { input: board }) => {
    const { page, section, columns, ids, words } = board;
    const { canvas } = deps;
    const layout = laidOut.parse(deps.easelCall.run({ input: ["layout", canvas, "--page", page] }));
    const laid = layout.sections.find((each) => each.name === section);
    const want = columns.map((column) => column.flatMap((name) => ids[name] ?? []));
    const now = laid?.columns ?? [];
    const moves = deps.mapOrder.run({ input: { section, want, now } });

    for (const move of moves) {
      const where = deps.placeFlags.run({ input: { to: move.to, page } });
      deps.easelCall.run({ input: ["move", canvas, move.id, ...where] });
    }
    if (moves.length) words.push(`order: ${moves.length} moves`);
    if (laid && laid.gap !== mapGap) {
      const gap = String(mapGap);
      deps.easelCall.run({ input: ["section", canvas, section, "--page", page, "--gap", gap] });
      words.push(`gap: ${mapGap}`);
    }
  },
});

export const putMap = operation({
  label: "mapScreens.putMap",
  input: z.object({ browser: z.custom<Browser>(), done: z.custom<Done>(), work: z.string() }),
  depends: {
    walkPageName,
    pageKey,
    mapColumns,
    mapBoard,
    framesOn,
    putState,
    putCard,
    putWalk,
    moveGone,
    putOrder,
  },
  run: async (deps, { input: { browser, done, work } }) => {
    const { entry, map, shots, cards, walk } = done;
    const page = deps.pageKey.run({ input: deps.walkPageName.run({ input: entry.name }) });
    const states = deps.mapColumns.run({ input: map.states });
    const columns = deps.mapBoard.run({ input: { map: entry.name, columns: states } });
    const board: Board = {
      entry,
      page,
      section: `${entry.name}: the map of ${entry.cell}`,
      gone: `${entry.name}: states that the map does not have now`,
      columns,
      byName: deps.framesOn.run({ input: page }),
      ids: {},
      words: [],
      work,
    };

    for (const [at, column] of states.entries()) {
      for (const state of column) {
        const shot = shots.find((each) => each.state === state);
        await deps.putState.run({ input: { browser, board, state, shot } });
      }
      for (const name of columns[at * 2 + 1] ?? []) {
        const card = cards.find((each) => each.name === name);
        if (card) deps.putCard.run({ input: { board, card } });
      }
    }

    deps.putWalk.run({ input: { board, html: walk } });
    deps.moveGone.run({ input: board });
    deps.putOrder.run({ input: board });
    return { page, words: board.words };
  },
});

export const putList = operation({
  label: "mapScreens.putList",
  input: z.object({ html: z.string(), work: z.string() }),
  depends: { pageKey, framesOn, easelCall, canvas: mapsCanvas },
  run: (deps, { input: { html, work } }) => {
    const { canvas } = deps;
    const page = deps.pageKey.run({ input: "Live" });
    const frame = deps.framesOn.run({ input: page }).get(mapsName);
    const file = join(work, "maps.html");
    writeFileSync(file, html);
    if (!frame) {
      const at = ["--page", page, "--size", "960x400"];
      deps.easelCall.run({ input: ["put", canvas, file, "--name", mapsName, ...at] });
      return "new";
    }

    const old = join(work, "old-maps.html");
    deps.easelCall.run({ input: ["get", canvas, frame.id, "-o", old] });
    if (readFileSync(old, "utf8") === html) return "same";

    const base = String(frame.version);
    deps.easelCall.run({ input: ["put", canvas, file, "--id", frame.id, "--base", base] });
    return "next";
  },
});

export const writeDry = operation({
  label: "mapScreens.writeDry",
  input: z.object({ dir: z.string(), done: z.custom<Done>() }),
  depends: { mapFrameName, walkFrameName },
  run: (deps, { input: { dir, done } }) => {
    const { entry, shots, cards, walk } = done;
    mkdirSync(dir, { recursive: true });
    const lines = shots.map((shot) => {
      const name = deps.mapFrameName.run({ input: { map: entry.name, state: shot.state } });
      if (shot.png) writeFileSync(join(dir, `${name}.png`), shot.png);
      return `map-screens: ${name}: ${shot.png ? "taken" : `failed: ${shot.why}`}`;
    });

    for (const card of cards) writeFileSync(join(dir, `${card.name}.html`), card.html);
    const walkName = deps.walkFrameName.run({ input: entry.name });
    writeFileSync(join(dir, `${walkName}.html`), walk);
    return lines;
  },
});
