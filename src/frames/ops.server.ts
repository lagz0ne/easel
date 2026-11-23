import { operation, transport } from "@tinkered/core";
import { z } from "zod";

import { user } from "@/access/guards.server";
import { makeApp, makeFrame } from "@/kit/make.server";
import { runtimeAddress, runtimeOf } from "@/kit/runtime.server";
import {
  entryFile,
  folderOf,
  folderText,
  type FrameFiles,
  maxAppBytes,
  refusingRules,
  utf8Bytes,
} from "@/kit/schema";
import { frameKit } from "@/kit/store.server";

import {
  framesApi,
  framesBoard,
  frames,
  keyOfName,
  maxDocBytes,
  maxFindings,
  maxMadeCssBytes,
  type PutInput,
  putInput,
} from "./contract";
import { shotFrame } from "./pictures.server";
import { endedRefusal, lockedRefusal, passMeta } from "./share";
import { passCanvas, shareCanvas, unshareCanvas } from "./share.server";
import { canvases, dropFrame, readDoc, saveCanvas, saveFrame } from "./store.server";

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

const appOf = operation({
  label: "frames.appOf",
  input: z.object({ js: z.string().nullable(), kit: z.number().nullable() }),
  depends: { runtimeOf, runtimeAddress },
  run: async ({ runtimeOf, runtimeAddress }, { input: { js, kit } }) => {
    if (js === null || kit === null) return null;

    const runtime = await runtimeOf.run({ input: kit });
    if (runtime === null) return null;
    const address = runtimeAddress.run({ input: { kit, sha: runtime.sha } });
    return { js, kit, runtime: { address, imports: runtime.imports } };
  },
});

export const loadDocs = operation({
  label: "frames.loadDocs",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { readDoc, appOf },
  run: async ({ readDoc, appOf }, { input }) => {
    const row = await readDoc.run({ input });
    if (!row) return [];

    const app = await appOf.run({ input: { js: row.js, kit: row.kit } });
    const { canvas, id, version, html, css } = row;
    return [{ canvas, id, version, html, css, app }];
  },
});

export const loadServerClock = operation({
  label: "frames.loadServerClock",
  input: z.object({ canvas: z.string() }),
  run: (_, { input, clock }) => [{ canvas: input.canvas, now: clock.currentTimeMillis() }],
});

export const createCanvas = operation({
  label: "canvas.create.do",
  input: framesApi["canvas.create"].input,
  depends: { saveCanvas },
  run: async ({ saveCanvas }, { input }) =>
    saveCanvas.run({ input: { name: input.name, key: keyOfName.parse(input.name) } }),
});

export const listCanvases = operation({
  label: "canvas.list.do",
  input: framesApi["canvas.list"].input,
  depends: { all: canvases.atScope.controller },
  run: ({ all }) => ({ canvases: all.get().toSorted((a, b) => a.created - b.created) }),
});

const newFrameId = operation({
  label: "frames.newFrameId",
  run: (_, { random }) => random.uuid().replaceAll("-", "").slice(0, 12),
});

const defaultSize = { w: 1440, h: 900 };

const makeDoc = operation({
  label: "frames.makeDoc",
  input: z.string(),
  depends: { frameKit, makeFrame },
  run: async ({ frameKit, makeFrame }, { input: html }) => {
    const kit = await frameKit.run();
    const made = await makeFrame.run({ input: { html, kit } });
    if (made.kind === "off") {
      return { kind: "made" as const, css: null, kit: null, js: null, findings: [] };
    }
    if (Buffer.byteLength(made.css, "utf8") > maxMadeCssBytes) return { kind: "tooBig" as const };

    const { css, findings } = made;
    return { kind: "made" as const, css, kit: kit.version, js: null, findings };
  },
});

const makeAppDoc = operation({
  label: "frames.makeAppDoc",
  input: z.custom<FrameFiles>(),
  depends: { frameKit, runtimeOf, makeApp },
  run: async ({ frameKit, runtimeOf, makeApp }, { input: files }) => {
    const kit = await frameKit.run();
    const runtime = await runtimeOf.run({ input: kit.version });
    if (runtime === null) throw new Error("frames: the current kit version is not stored");

    const names = Object.keys(runtime.imports);
    const made = await makeApp.run({ input: { files, kit, names } });
    if (made.kind === "unparsed" || made.findings.some((f) => refusingRules.has(f.rule))) {
      return { kind: "offKit" as const, findings: made.findings };
    }
    if (utf8Bytes.parse(made.css) > maxMadeCssBytes) return { kind: "tooBig" as const };

    const { css, js, findings } = made;
    return { kind: "made" as const, css, kit: kit.version, js, findings };
  },
});

const textOf = z.custom<PutInput>().transform((put) => {
  if ("files" in put) return folderText.parse(put.files);
  return "tsx" in put ? put.tsx : put.html;
});

const filesOf = z.custom<PutInput>().transform((put): FrameFiles | null => {
  if ("files" in put) return put.files;
  return "tsx" in put ? { [entryFile]: put.tsx } : null;
});

const bytesOf = z.custom<PutInput>().transform((put) => {
  const files = filesOf.parse(put);
  if (files === null) return utf8Bytes.parse(textOf.parse(put));
  return Object.values(files).reduce((sum, text) => sum + utf8Bytes.parse(text), 0);
});

const writeOf = operation({
  label: "frames.writeOf",
  input: z.object({
    put: putInput,
    css: z.string().nullable(),
    kit: z.number().nullable(),
    js: z.string().nullable(),
  }),
  depends: { newFrameId },
  run: ({ newFrameId }, { input: { put, css, kit, js } }) => {
    const html = textOf.parse(put);
    if ("id" in put) {
      return {
        kind: "on" as const,
        canvas: put.canvas,
        id: put.id,
        base: put.base,
        html,
        css,
        kit,
        js,
      };
    }

    const box = put.size ?? defaultSize;
    const name = put.name ?? "untitled";
    return {
      kind: "new" as const,
      canvas: put.canvas,
      id: newFrameId.run(),
      name,
      ...box,
      html,
      css,
      kit,
      js,
    };
  },
});

const madeOf = operation({
  label: "frames.madeOf",
  input: putInput,
  depends: { makeDoc, makeAppDoc },
  run: async ({ makeDoc, makeAppDoc }, { input }) => {
    const files = filesOf.parse(input);
    const maxBytes = files === null ? maxDocBytes : maxAppBytes;
    if (bytesOf.parse(input) > maxBytes) return { kind: "tooBig" as const, maxBytes };

    const made =
      files === null
        ? await makeDoc.run({ input: textOf.parse(input) })
        : await makeAppDoc.run({ input: files });
    return made.kind === "tooBig" ? { kind: "tooBig" as const, maxBytes: maxMadeCssBytes } : made;
  },
});

export const putFrame = operation({
  label: "frame.put.do",
  input: framesApi["frame.put"].input,
  depends: { saveFrame, madeOf, writeOf, invalidate: framesBoard.invalidate },
  run: async ({ saveFrame, madeOf, writeOf, invalidate }, { input }) => {
    const made = await madeOf.run({ input });
    if (made.kind === "tooBig") return made;
    if (made.kind === "offKit") {
      const findings = made.findings.slice(0, maxFindings);
      return { kind: "offKit" as const, findings, more: made.findings.length - findings.length };
    }

    const write = writeOf.run({ input: { put: input, css: made.css, kit: made.kit, js: made.js } });
    const answer = await saveFrame.run({ input: write });
    if (answer.kind === "stale" || answer.kind === "gone") return answer;
    if (answer.kind !== "unchanged") {
      await invalidate.run({ input: { docs: { canvas: input.canvas, id: answer.id } } });
    }
    const findings = made.findings.slice(0, maxFindings);
    return { ...answer, findings, more: made.findings.length - findings.length };
  },
});

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

export const getFrame = operation({
  label: "frame.get.do",
  input: framesApi["frame.get"].input,
  depends: { readDoc },
  run: async ({ readDoc }, { input }) => {
    const row = await readDoc.run({ input });
    if (!row) return { kind: "gone" as const };

    const { canvas: _canvas, css: _css, js, kit: _kit, html, ...info } = row;
    const files = js === null ? null : folderOf.parse(html);
    const frame =
      js === null ? { ...info, html } : files ? { ...info, files } : { ...info, tsx: html };
    return { kind: "found" as const, frame };
  },
});

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

export const framesLoads = { docs: loadDocs, serverClock: loadServerClock } as const;
