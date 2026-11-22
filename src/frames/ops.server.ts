import { operation, transport } from "@tinkered/core";
import { z } from "zod";

import { user } from "@/access/guards.server";
import { makeFrame } from "@/kit/make.server";
import { frameKit } from "@/kit/store.server";

import {
  framesApi,
  framesBoard,
  frames,
  keyOfName,
  maxDocBytes,
  maxFindings,
  maxMadeCssBytes,
  putInput,
} from "./contract";
import { shotFrame } from "./pictures.server";
import { endedRefusal, lockedRefusal, passMeta } from "./share";
import { passCanvas, shareCanvas, unshareCanvas } from "./share.server";
import { canvases, dropFrame, readDoc, saveCanvas, saveFrame } from "./store.server";

// frames' calls (after the `user` guard, fact rule 1) and the board's guard and load. V1: any
// signed-in user may write any canvas; one team per server (decision C9).

/**
 * Every board read (fact rule 6): a live user, or a live pass for the part's canvas. A read whose
 * meta carries a pass is judged by the pass alone: one a password set or changed ended is refused
 * `{ locked: true }`, and the page asks the password; any other that is not live for that canvas
 * is refused `{ ended: true }`, and the page says the link has ended. Any other read goes to
 * `user`: no token, or a dead one, is refused `{ signIn: true }`.
 */
export const mayRead = operation({
  label: "frames.mayRead",
  input: transport.hook.start,
  depends: { user, passCanvas },
  run: async ({ user, passCanvas }, { input }) => {
    const sent = passMeta.safeParse(input.meta);
    if (!sent.success) return user.run({ input });

    const held = await passCanvas.run({ input: sent.data.pass });
    if (held === null || framesBoard.part(input)?.canvas !== held.canvas) {
      return input.refuse(endedRefusal);
    }
    switch (held.state) {
      case "live":
        return undefined;
      case "locked":
        return input.refuse(lockedRefusal);
    }
  },
});

/**
 * The board's `docs` load: one frame's current document and its made CSS, read from its row
 * (decision C12). The CSS is the stored one: a show never makes CSS (K11).
 */
export const loadDocs = operation({
  label: "frames.loadDocs",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { readDoc },
  run: async ({ readDoc }, { input }) => {
    const row = await readDoc.run({ input });

    return row
      ? [{ canvas: row.canvas, id: row.id, version: row.version, html: row.html, css: row.css }]
      : [];
  },
});

/** The board's `serverClock` load: the time of the server now, for a tab's clock offset. */
export const loadServerClock = operation({
  label: "frames.loadServerClock",
  input: z.object({ canvas: z.string() }),
  run: (_, { input, clock }) => [{ canvas: input.canvas, now: clock.currentTimeMillis() }],
});

/** `canvas.create`: the name's key, if no canvas has it (decision C3). */
export const createCanvas = operation({
  label: "canvas.create.do",
  input: framesApi["canvas.create"].input,
  depends: { saveCanvas },
  run: async ({ saveCanvas }, { input }) =>
    saveCanvas.run({ input: { name: input.name, key: keyOfName.parse(input.name) } }),
});

/** `canvas.list`: every canvas, oldest first. */
export const listCanvases = operation({
  label: "canvas.list.do",
  input: framesApi["canvas.list"].input,
  depends: { all: canvases.atScope.controller },
  run: ({ all }) => ({ canvases: all.get().toSorted((a, b) => a.created - b.created) }),
});

/** A new frame's id: 48 random bits, as 12 hex digits. */
const newFrameId = operation({
  label: "frames.newFrameId",
  run: (_, { random }) => random.uuid().replaceAll("-", "").slice(0, 12),
});

/** A frame's size when `--size` is not given: a desktop page (SPEC-frames § Make and change frames). */
const defaultSize = { w: 1440, h: 900 };

/**
 * The kit check and the make step of a put's document, against the current kit version
 * ([kit](SPEC-kit.md)), before the write (kit judged rule 2): its made CSS, the kit version it was
 * made for, and the findings. A frame that turns the kit off gets no CSS (null) and no finding.
 * Made CSS over 256 KiB answers `tooBig`.
 */
const makeDoc = operation({
  label: "frames.makeDoc",
  input: z.string(),
  depends: { frameKit, makeFrame },
  run: async ({ frameKit, makeFrame }, { input: html }) => {
    const kit = await frameKit.run();
    const made = await makeFrame.run({ input: { html, kit } });
    if (made.kind === "off") return { kind: "made" as const, css: null, kit: null, findings: [] };
    if (Buffer.byteLength(made.css, "utf8") > maxMadeCssBytes) return { kind: "tooBig" as const };

    return { kind: "made" as const, css: made.css, kit: kit.version, findings: made.findings };
  },
});

/** A put's write: a new frame to the right of the others, or a write on an id at its base. */
const writeOf = operation({
  label: "frames.writeOf",
  input: z.object({
    put: putInput,
    css: z.string().nullable(),
    kit: z.number().nullable(),
  }),
  depends: { newFrameId },
  run: ({ newFrameId }, { input: { put, css, kit } }) =>
    "id" in put
      ? { kind: "on" as const, ...put, css, kit }
      : {
          kind: "new" as const,
          canvas: put.canvas,
          id: newFrameId.run(),
          name: put.name ?? "untitled",
          ...(put.size ?? defaultSize),
          html: put.html,
          css,
          kit,
        },
});

/**
 * `frame.put`: a document over 1 MiB of UTF-8 answers `tooBig` and writes nothing. Then the kit
 * check and the make step run on the document, against the current kit version
 * ([kit](SPEC-kit.md)), before the write (judged rule 2 of kit): made CSS over 256 KiB answers
 * `tooBig` too. Without an id it makes a frame; with one it is one conditional write
 * (`saveFrame`). The frame version keeps its made CSS and its kit version. A put that saves or
 * answers `unchanged` answers the findings too; they do not stop it. After a write, each reader
 * of the frame's document asks for it again.
 */
export const putFrame = operation({
  label: "frame.put.do",
  input: framesApi["frame.put"].input,
  depends: { saveFrame, makeDoc, writeOf, invalidate: framesBoard.invalidate },
  run: async ({ saveFrame, makeDoc, writeOf, invalidate }, { input }) => {
    if (Buffer.byteLength(input.html, "utf8") > maxDocBytes) {
      return { kind: "tooBig" as const, maxBytes: maxDocBytes };
    }
    const made = await makeDoc.run({ input: input.html });
    if (made.kind === "tooBig") return { kind: "tooBig" as const, maxBytes: maxMadeCssBytes };

    const write = writeOf.run({ input: { put: input, css: made.css, kit: made.kit } });
    const answer = await saveFrame.run({ input: write });
    if (answer.kind === "stale" || answer.kind === "gone") return answer;
    if (answer.kind !== "unchanged") {
      await invalidate.run({ input: { docs: { canvas: input.canvas, id: answer.id } } });
    }
    const findings = made.findings.slice(0, maxFindings);
    return { ...answer, findings, more: made.findings.length - findings.length };
  },
});

/** `frame.list`: a canvas's frames, in the order they were made; `gone` with no such canvas. */
export const listFrames = operation({
  label: "frame.list.do",
  input: framesApi["frame.list"].input,
  depends: { all: canvases.atScope.controller, cells: frames.atScope.controller },
  run: ({ all, cells }, { input }) => {
    if (!all.of({ key: input.canvas }).get()) return { kind: "gone" as const };

    const list = cells.where({ canvas: input.canvas }).get();
    return {
      kind: "found" as const,
      frames: list.map(({ id, name, x, y, w, h, version }) => ({ id, name, x, y, w, h, version })),
    };
  },
});

/** `frame.get`: the frame and its document at its current version, from one read of its row. */
export const getFrame = operation({
  label: "frame.get.do",
  input: framesApi["frame.get"].input,
  depends: { readDoc },
  run: async ({ readDoc }, { input }) => {
    const row = await readDoc.run({ input });
    if (!row) return { kind: "gone" as const };

    const { canvas: _canvas, css: _css, ...frame } = row;
    return { kind: "found" as const, frame };
  },
});

/** `frame.delete`: the row and the cell go; each reader of its document hears it is gone. */
export const deleteFrame = operation({
  label: "frame.delete.do",
  input: framesApi["frame.delete"].input,
  depends: { dropFrame, invalidate: framesBoard.invalidate },
  run: async ({ dropFrame, invalidate }, { input }) => {
    const answer = await dropFrame.run({ input });
    if (answer.kind === "deleted") await invalidate.run({ input: { docs: input } });
    return answer;
  },
});

/** The server's side of `framesApi`: `frames.api({ implement: framesOps, onStart: [user] })`. */
export const framesOps = {
  "canvas.create": createCanvas,
  "canvas.list": listCanvases,
  "canvas.share": shareCanvas,
  "canvas.unshare": unshareCanvas,
  "frame.put": putFrame,
  "frame.list": listFrames,
  "frame.get": getFrame,
  "frame.delete": deleteFrame,
  "frame.shot": shotFrame,
} as const;

/** The board's loads: `frames.board({ serve: true, load: framesLoads, onStart: [mayRead] })`. */
export const framesLoads = { docs: loadDocs, serverClock: loadServerClock } as const;
