import { operation, transport } from "@tinkered/core";
import { z } from "zod";

import { user } from "@/access/guards.server";
import { checkApp } from "@/kit/app.server";
import { makeApp, makeFrame } from "@/kit/make.server";
import { runtimeAddress, runtimeOf } from "@/kit/runtime.server";
import {
  entryFile,
  type Finding,
  folderOf,
  folderText,
  type FrameFiles,
  maxAppBytes,
  refusingRules,
  settleRules,
  utf8Bytes,
} from "@/kit/schema";
import { frameKit } from "@/kit/store.server";
import { loadShots } from "@/queue/shots.server";
import { releaseClient } from "@/release";

import {
  framesApi,
  framesBoard,
  frames,
  imageInput,
  keyOfName,
  maxDocBytes,
  maxFindings,
  maxMadeCssBytes,
  type PutInput,
  putInput,
} from "./contract";
import { deleteCanvas } from "./delete.server";
import { imageAddress, imageDoc, readImage, sanitizedImage } from "./images.server";
import { createPage, deletePage, listPages, orderPages, renamePage } from "./pages.server";
import { shotFrame } from "./pictures.server";
import { pageLayout, readSeats, setSection } from "./sections.server";
import { endedRefusal, lockedRefusal, passMeta } from "./share";
import { passCanvas, shareCanvas, unshareCanvas } from "./share.server";
import {
  canvases,
  dropFrame,
  frameWrite,
  markFrame,
  moveFrame,
  type PlaceWrite,
  readDoc,
  readStatus,
  readStatuses,
  saveCanvas,
  saveFrame,
} from "./store.server";

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
  depends: { readDoc, appOf, imageAddress, imageDoc },
  run: async ({ readDoc, appOf, imageAddress, imageDoc }, { input }) => {
    const row = await readDoc.run({ input });
    if (!row) return [];
    if (row.image) {
      const { canvas, id, version, name, gen } = row;
      const src = imageAddress.run({ input: { canvas, sha: row.image.sha, gen } });
      const html = imageDoc.run({ input: { src, name } });
      return [{ canvas, id, version, html, css: null, app: null }];
    }

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
  input: z.object({ files: z.custom<FrameFiles>(), ready: z.boolean() }),
  depends: { frameKit, runtimeOf, makeApp },
  run: async ({ frameKit, runtimeOf, makeApp }, { input: { files, ready } }) => {
    const kit = await frameKit.run();
    const runtime = await runtimeOf.run({ input: kit.version });
    if (runtime === null) throw new Error("frames: the current kit version is not stored");

    const names = Object.keys(runtime.imports);
    const { texts } = kit;
    const made = await makeApp.run({ input: { files, kit, names, texts, exploring: !ready } });
    const refusing = made.findings.filter((f) => refusingRules.has(f.rule));
    if (made.kind === "unparsed" || refusing.length > 0) {
      const notes = made.findings.filter((f) => !refusingRules.has(f.rule));
      return { kind: "offKit" as const, findings: [...refusing, ...notes] };
    }
    const unsettled = made.unfixed.filter((f) => settleRules.has(f.rule));
    if (ready && unsettled.length > 0) return { kind: "unsettled" as const, findings: unsettled };
    if (utf8Bytes.parse(made.css) > maxMadeCssBytes) return { kind: "tooBig" as const };

    const { css, js, findings, fixed } = made;
    return { kind: "made" as const, css, kit: kit.version, js, findings, fixed };
  },
});

const textOf = z.custom<PutInput>().transform((put) => {
  if ("image" in put) return "";
  if ("files" in put) return folderText.parse(put.files);
  return "tsx" in put ? put.tsx : put.html;
});

const filesOf = z.custom<PutInput>().transform((put): FrameFiles | null => {
  if ("image" in put) return null;
  if ("files" in put) return put.files;
  return "tsx" in put ? { [entryFile]: put.tsx } : null;
});

const bytesOf = z.custom<PutInput>().transform((put) => {
  const files = filesOf.parse(put);
  if (files === null) return utf8Bytes.parse(textOf.parse(put));
  return Object.values(files).reduce((sum, text) => sum + utf8Bytes.parse(text), 0);
});

const boxOf = z
  .object({ put: z.custom<PutInput>(), image: sanitizedImage.nullable() })
  .transform(({ put, image }) => {
    if (image) return { w: image.w, h: image.h };
    return ("size" in put && put.size) || defaultSize;
  });

const askedPlace = z.object({
  after: z.string().optional(),
  below: z.string().optional(),
  section: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  page: z.string().optional(),
});

const placeOf = askedPlace.transform((asked): PlaceWrite => {
  if (asked.after !== undefined) return { kind: "after", id: asked.after };
  if (asked.below !== undefined) return { kind: "below", id: asked.below };
  if (asked.section !== undefined) return { kind: "section", name: asked.section };
  return { kind: "exact", x: asked.x ?? null, y: asked.y ?? null };
});

const writeOf = operation({
  label: "frames.writeOf",
  input: z.object({
    put: putInput,
    html: z.string(),
    css: z.string().nullable(),
    kit: z.number().nullable(),
    js: z.string().nullable(),
    image: sanitizedImage.nullable(),
    mode: z.enum(["ready", "exploring", "html"]),
  }),
  depends: { newFrameId },
  run: ({ newFrameId }, { input: { put, html, css, kit, js, image, mode } }) => {
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
        image,
        mode,
      };
    }

    const box = boxOf.parse({ put, image });
    const name = put.name ?? "untitled";
    return {
      kind: "new" as const,
      canvas: put.canvas,
      id: newFrameId.run(),
      name,
      page: put.page ?? null,
      place: placeOf.parse(put),
      rev: put.rev ?? null,
      ...box,
      html,
      css,
      kit,
      js,
      image,
      mode,
    };
  },
});

const storedText = z
  .object({
    put: z.custom<PutInput>(),
    fixed: z.record(z.string(), z.string()),
    ready: z.boolean(),
  })
  .transform(({ put, fixed, ready }) => {
    if (!ready) return textOf.parse(put);
    return "files" in put ? folderText.parse(fixed) : (fixed[entryFile] ?? textOf.parse(put));
  });

const modeOf = z
  .boolean()
  .transform((ready) => (ready ? ("ready" as const) : ("exploring" as const)));

const readyOf = operation({
  label: "frames.readyOf",
  input: putInput,
  depends: { readStatus },
  run: async ({ readStatus }, { input }) => {
    if ("ready" in input && input.ready) return true;
    if (!("id" in input)) return false;
    return (await readStatus.run({ input: { canvas: input.canvas, id: input.id } })) === "ready";
  },
});

const madeAppOf = operation({
  label: "frames.madeAppOf",
  input: z.object({ put: putInput, files: z.custom<FrameFiles>() }),
  depends: { makeAppDoc, readyOf },
  run: async ({ makeAppDoc, readyOf }, { input: { put, files } }) => {
    const ready = await readyOf.run({ input: put });
    const made = await makeAppDoc.run({ input: { files, ready } });
    if (made.kind === "tooBig") return { kind: "tooBig" as const, maxBytes: maxMadeCssBytes };
    if (made.kind !== "made") return made;

    const html = storedText.parse({ put, fixed: made.fixed, ready });
    return { ...made, html, mode: modeOf.parse(ready), image: null };
  },
});

const madeImageOf = operation({
  label: "frames.madeImageOf",
  input: imageInput,
  depends: { readImage },
  run: async ({ readImage }, { input }) => {
    const read = await readImage.run({ input });
    if (read.kind !== "image") return read;

    const none = { css: null, kit: null, js: null, findings: [] };
    return { kind: "made" as const, ...none, html: "", mode: "html" as const, image: read };
  },
});

const madeOf = operation({
  label: "frames.madeOf",
  input: putInput,
  depends: { makeDoc, madeAppOf, madeImageOf },
  run: async ({ makeDoc, madeAppOf, madeImageOf }, { input }) => {
    if ("image" in input) return madeImageOf.run({ input: input.image });
    const files = filesOf.parse(input);
    const maxBytes = files === null ? maxDocBytes : maxAppBytes;
    if (bytesOf.parse(input) > maxBytes) return { kind: "tooBig" as const, maxBytes };
    if (files !== null) return madeAppOf.run({ input: { put: input, files } });

    const made = await makeDoc.run({ input: textOf.parse(input) });
    if (made.kind === "tooBig") return { kind: "tooBig" as const, maxBytes: maxMadeCssBytes };
    return { ...made, html: textOf.parse(input), mode: "html" as const, image: null };
  },
});

const savePut = operation({
  label: "frames.savePut",
  input: frameWrite,
  depends: { saveFrame, invalidate: framesBoard.invalidate },
  run: async ({ saveFrame, invalidate }, { input: write }) => {
    const answer = await saveFrame.run({ input: write });
    switch (answer.kind) {
      case "stale":
      case "gone":
      case "changed":
      case "placed":
      case "unchanged":
        return answer;
      case "created":
      case "updated":
        await invalidate.run({ input: { docs: { canvas: write.canvas, id: answer.id } } });
        return answer;
    }
  },
});

export const putFrame = operation({
  label: "frame.put.do",
  input: framesApi["frame.put"].input,
  depends: { savePut, madeOf, writeOf },
  run: async ({ savePut, madeOf, writeOf }, { input }) => {
    const made = await madeOf.run({ input });
    if (made.kind === "tooBig" || made.kind === "badImage") return made;
    if (made.kind === "offKit" || made.kind === "unsettled") {
      const findings = made.findings.slice(0, maxFindings);
      return { kind: made.kind, findings, more: made.findings.length - findings.length };
    }

    const { html, css, kit, js, mode, image } = made;
    const write = writeOf.run({ input: { put: input, html, css, kit, js, image, mode } });
    const answer = await savePut.run({ input: write });
    if (!("layout" in answer)) return answer;

    const findings = made.findings.slice(0, maxFindings);
    return { ...answer, findings, more: made.findings.length - findings.length };
  },
});

export const listFrames = operation({
  label: "frame.list.do",
  input: framesApi["frame.list"].input,
  depends: {
    all: canvases.atScope.controller,
    cells: frames.atScope.controller,
    readStatuses,
    readSeats,
  },
  run: async ({ all, cells, readStatuses, readSeats }, { input }) => {
    if (!all.of({ key: input.canvas }).get()) return { kind: "gone" as const };

    const list = cells.where({ canvas: input.canvas }).get();
    const statuses = await readStatuses.run({ input });
    const { rev, seats } = await readSeats.run({ input });
    return {
      kind: "found" as const,
      rev,
      frames: list.map(({ id, name, page, x, y, w, h, version }) => ({
        id,
        name,
        page,
        x,
        y,
        w,
        h,
        version,
        status: statuses.get(id) ?? "exploring",
        section: seats.get(id) ?? null,
      })),
    };
  },
});

export const getFrame = operation({
  label: "frame.get.do",
  input: framesApi["frame.get"].input,
  depends: { readDoc, imageAddress },
  run: async ({ readDoc, imageAddress }, { input }) => {
    const row = await readDoc.run({ input });
    if (!row) return { kind: "gone" as const };

    const { canvas, css: _css, js, kit: _kit, html, image, gen, ...info } = row;
    if (image) {
      const url = imageAddress.run({ input: { canvas, sha: image.sha, gen } });
      const shown = { mimeType: image.type, w: info.w, h: info.h, bytes: image.bytes, url };
      return { kind: "found" as const, frame: { ...info, image: shown } };
    }
    const files = js === null ? null : folderOf.parse(html);
    const frame =
      js === null ? { ...info, html } : files ? { ...info, files } : { ...info, tsx: html };
    return { kind: "found" as const, frame };
  },
});

const htmlNotReady: Finding = {
  line: 1,
  col: 1,
  rule: "kit/shape",
  what: "only an app frame can be ready: this frame is HTML",
  fix: "put the frame again as TSX (a .tsx file or a folder), then mark it ready",
};

const settleCheck = operation({
  label: "frames.settleCheck",
  input: z.string(),
  depends: { frameKit, checkApp },
  run: async ({ frameKit, checkApp }, { input: html }) => {
    const kit = await frameKit.run();
    const files = folderOf.parse(html) ?? { [entryFile]: html };
    const paths = Object.keys(files).sort();

    const found: Finding[] = [];
    for (const path of paths) {
      const tsx = files[path] ?? "";
      const one = await checkApp.run({ input: { tsx, kit, path, paths, texts: kit.texts } });
      const named = paths.length > 1 ? { file: path } : {};
      found.push(...one.findings.map((f) => ({ ...f, ...named })));
    }
    return found.filter((f) => settleRules.has(f.rule));
  },
});

export const markReady = operation({
  label: "frames.markReady",
  input: z.object({ canvas: z.string(), id: z.string(), version: z.number() }),
  depends: { markFrame },
  run: async ({ markFrame }, { input }) => {
    const marked = await markFrame.run({ input: { ...input, status: "ready" } });
    switch (marked.kind) {
      case "marked":
        return { kind: "ready" as const, version: marked.version };
      case "unchanged":
        return { kind: "unchanged" as const, version: marked.version };
      case "gone":
        return marked;
      case "moved":
        throw new Error(`frames: ${input.id} changed while it was checked; mark it again`);
    }
  },
});

export const readyFrame = operation({
  label: "frame.ready.do",
  input: framesApi["frame.ready"].input,
  depends: { readDoc, settleCheck, markReady },
  run: async ({ readDoc, settleCheck, markReady }, { input }) => {
    const row = await readDoc.run({ input });
    if (!row) return { kind: "gone" as const };
    if (row.js === null) return { kind: "unsettled" as const, findings: [htmlNotReady], more: 0 };
    if (row.status === "ready") return { kind: "unchanged" as const, version: row.version };

    const all = await settleCheck.run({ input: row.html });
    const findings = all.slice(0, maxFindings);
    if (all.length > 0) {
      return { kind: "unsettled" as const, findings, more: all.length - findings.length };
    }
    return markReady.run({ input: { ...input, version: row.version } });
  },
});

export const exploreFrame = operation({
  label: "frame.explore.do",
  input: framesApi["frame.explore"].input,
  depends: { markFrame },
  run: async ({ markFrame }, { input }) => {
    const marked = await markFrame.run({ input: { ...input, status: "exploring" } });
    switch (marked.kind) {
      case "marked":
        return { kind: "exploring" as const };
      case "unchanged":
        return { kind: "unchanged" as const };
      case "gone":
        return marked;
      case "moved":
        throw new Error("frames: a mark with no version never moves");
    }
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

const movePlaceOf = askedPlace.transform((move): PlaceWrite | null => {
  const { after, below, section, x, page } = move;
  const asked = [after, below, section, x, page].some((flag) => flag !== undefined);
  return asked ? placeOf.parse(move) : null;
});

export const moveFrameTo = operation({
  label: "frame.move.do",
  input: framesApi["frame.move"].input,
  depends: { moveFrame },
  run: async ({ moveFrame }, { input }) =>
    moveFrame.run({
      input: {
        canvas: input.canvas,
        id: input.id,
        page: input.page ?? null,
        place: movePlaceOf.parse(input),
        size: input.size ?? null,
        rev: input.rev ?? null,
      },
    }),
});

export const framesOps = {
  "canvas.create": createCanvas,
  "canvas.list": listCanvases,
  "canvas.delete": deleteCanvas,
  "canvas.share": shareCanvas,
  "canvas.unshare": unshareCanvas,
  "frame.put": putFrame,
  "frame.list": listFrames,
  "frame.get": getFrame,
  "frame.delete": deleteFrame,
  "frame.ready": readyFrame,
  "frame.explore": exploreFrame,
  "frame.shot": shotFrame,
  "frame.move": moveFrameTo,
  "section.set": setSection,
  "page.layout": pageLayout,
  "page.list": listPages,
  "page.create": createPage,
  "page.rename": renamePage,
  "page.order": orderPages,
  "page.delete": deletePage,
} as const;

export const loadClient = operation({
  label: "frames.loadClient",
  input: z.object({ canvas: z.string() }),
  depends: { client: releaseClient },
  run: ({ client }, { input }) => [{ canvas: input.canvas, client }],
});

export const framesLoads = {
  docs: loadDocs,
  shots: loadShots,
  serverClock: loadServerClock,
  client: loadClient,
} as const;
