import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { operation, tag } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "@/access/contract";
import { frames } from "@/frames";
import {
  canvasKey,
  canvasName,
  frame,
  frameId,
  frameName,
  framesSuccessKinds,
  maxDocBytes,
  maxMadeCssBytes,
  maxSentDocBytes,
  pageKey,
  pictureRegion,
  pictureScale,
  placeAt,
  putOutput,
  size,
  version,
} from "@/frames/contract";
import type { FramesAddress } from "@/frames/contract";
import { sharePassword } from "@/frames/share";
import { entryFile, type FrameFiles, findingShape, frameFiles, maxAppBytes } from "@/kit/schema";

import { callDeadline, exits, faultExit } from "./exit";
import { server } from "./hosts";
import { json, say, stderr } from "./output";

export const stdinText = tag<(() => Promise<string>) | null>({
  label: "cli.stdinText",
  default: null,
});

export const framesCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canvas new"), name: z.string() }),
  z.object({ kind: z.literal("canvas ls") }),
  z.object({
    kind: z.literal("put"),
    canvas: canvasKey,
    file: z.string().min(1),
    name: frameName.optional(),
    size: z.string().optional(),
    id: z.string().optional(),
    base: z.string().optional(),
    ready: z.boolean().optional(),
    page: pageKey.optional(),
    at: z.string().optional(),
  }),
  z.object({ kind: z.literal("ls"), canvas: canvasKey }),
  z.object({ kind: z.literal("get"), canvas: canvasKey, id: frameId, out: z.string().optional() }),
  z.object({ kind: z.literal("rm"), canvas: canvasKey, id: frameId }),
  z.object({
    kind: z.literal("shot"),
    canvas: canvasKey,
    id: frameId,
    out: z.string().min(1),
    scale: z.string().optional(),
    region: z.string().optional(),
  }),
  z.object({ kind: z.literal("ready"), canvas: canvasKey, id: frameId }),
  z.object({ kind: z.literal("explore"), canvas: canvasKey, id: frameId }),
]);

export type FramesCommand = z.infer<typeof framesCommand>;

export const shareCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("share"),
    canvas: canvasKey,
    password: z.string().optional(),
    noPassword: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("unshare"), canvas: canvasKey }),
]);

export type ShareCommand = z.infer<typeof shareCommand>;

const sizeFlag = z
  .string()
  .regex(/^\d+x\d+$/)
  .transform((typed) => typed.split("x").map(Number))
  .transform(([w = 0, h = 0]) => ({ w, h }))
  .pipe(size);

const baseFlag = z.string().regex(/^\d+$/).transform(Number).pipe(version);

export const atFlag = z
  .string()
  .regex(/^\d+,\d+$/)
  .transform((typed) => typed.split(",").map(Number))
  .transform(([x = 0, y = 0]) => ({ x, y }))
  .pipe(z.object({ x: placeAt, y: placeAt }));

export const badAt =
  "--at takes x,y in CSS pixels, each a whole number from 0 to 100000, as 0,1200";

const badFlag = {
  size: "--size takes WxH in CSS pixels, each 1 to 16000, as 390x844",
  id: "--id takes a frame's id, 12 of 0-9 and a-f: `easel ls <canvas>` prints them",
  base: "--base takes the version you got, 1 or more: `easel get` prints it",
  at: badAt,
} as const;

const address = z.enum([
  "canvas.create",
  "canvas.list",
  "frame.put",
  "frame.list",
  "frame.get",
  "frame.delete",
  "canvas.share",
  "canvas.unshare",
  "frame.shot",
  "frame.ready",
  "frame.explore",
  "frame.move",
  "page.list",
  "page.create",
  "page.rename",
  "page.order",
  "page.delete",
] satisfies FramesAddress[]);

export const framesDeadline = operation({
  label: "cli.framesDeadline",
  input: address,
  run: (_, { input, clock, signal }) => {
    const stop = new AbortController();
    const late = loginApi.fault.make(input, "link", { late: callDeadline }, undefined);
    clock.sleep(callDeadline, AbortSignal.any([signal, stop.signal])).then(
      () => stop.abort(late),
      () => undefined,
    );

    return stop;
  },
});

export const framesExitOf = operation({
  label: "cli.framesExitOf",
  input: z.object({ address, kind: z.string().optional() }),
  run: (_, { input }) => {
    const list: "always" | readonly string[] = framesSuccessKinds[input.address];
    const ok = list === "always" || list.some((kind) => kind === input.kind);

    return ok ? exits.ok : exits.no;
  },
});

export const framesFault = operation({
  label: "cli.framesFault",
  input: z.unknown(),
  depends: { faultExit },
  run: ({ faultExit }, { input: error }) => {
    const known = frames.api.fault.is(error)
      ? loginApi.fault.make(
          error.address,
          error.fault,
          error.payload,
          error.traceId,
          error.execution,
        )
      : error;

    return faultExit.run({ input: known });
  },
});

export const usage = operation({
  label: "cli.framesUsage",
  input: z.string(),
  depends: { say },
  run: ({ say }, { input: text }) => {
    say.run({ input: { json: { usage: text }, text, error: true } });
    return exits.usage;
  },
});

export const canvasNew = operation({
  label: "cli.canvasNew",
  input: z.object({ name: z.string() }),
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    create: frames.api["canvas.create"],
  },
  run: async ({ say, exitOf, framesFault, deadline, create }, { input }) => {
    const named = canvasName.safeParse(input.name);
    if (!named.success) {
      const why = named.error.issues.map((issue) => issue.message);
      say.run({
        input: {
          json: { invalid: { name: why } },
          text: `not a canvas name: ${why.join("; ")}`,
          error: true,
        },
      });
      return exits.invalid;
    }
    const stop = deadline.run({ input: "canvas.create" });
    const reply = await create.settle({ input: { name: named.data }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "created":
        say.run({ input: { json: answer, text: answer.key } });
        break;
      case "taken":
        say.run({
          input: {
            json: answer,
            text: `a canvas with that key exists: pick another name, or use it (\`easel canvas ls\`)`,
            error: true,
          },
        });
        break;
    }

    return exitOf.run({ input: { address: "canvas.create", kind: answer.kind } });
  },
});

export const canvasLs = operation({
  label: "cli.canvasLs",
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    list: frames.api["canvas.list"],
  },
  run: async ({ say, exitOf, framesFault, deadline, list }) => {
    const stop = deadline.run({ input: "canvas.list" });
    const reply = await list.settle({ input: null, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const { canvases } = reply.value;
    const text = canvases.length
      ? canvases
          .map(
            (c) =>
              `${c.key}\t${c.name}\tmade ${new Date(c.created).toISOString()}${c.shared ? "\tshared" : ""}`,
          )
          .join("\n")
      : "no canvas yet: make one with `easel canvas new <name>`";
    say.run({ input: { json: reply.value, text } });
    return exitOf.run({ input: { address: "canvas.list" } });
  },
});

const readFolder = operation({
  label: "cli.readFolder",
  input: z.string(),
  run: (_, { input: dir }) => {
    const paths = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .map((path) => path.split("\\").join("/"))
      .filter((path) => /\.tsx?$/.test(path))
      .filter(
        (path) => !path.split("/").some((part) => part.startsWith(".") || part === "node_modules"),
      )
      .sort();
    const files = Object.fromEntries(
      paths.map((path) => [path, readFileSync(join(dir, path), "utf8")]),
    );
    const read = frameFiles.safeParse(files);
    if (read.success) return { kind: "files" as const, files: read.data };

    const issue = read.error.issues[0];
    const where = issue?.path.length ? `${String(issue.path[0])}: ` : "";
    const bad = `${dir} is not a frame: ${where}${issue?.message ?? "no files"}`;
    return { kind: "bad" as const, bad };
  },
});

const readDocument = operation({
  label: "cli.readDocument",
  input: z.string(),
  depends: { stdin: stdinText, readFolder },
  run: async ({ stdin, readFolder }, { input: file }) => {
    if (file === "-") return stdin ? { kind: "text" as const, text: await stdin() } : null;
    try {
      if (statSync(file).isDirectory()) return readFolder.run({ input: file });
      return { kind: "text" as const, text: readFileSync(file, "utf8") };
    } catch {
      return null;
    }
  },
});

const typedFlags = z.object({
  size: sizeFlag.optional(),
  id: frameId.optional(),
  base: baseFlag.optional(),
  at: atFlag.optional(),
});

const putFlags = operation({
  label: "cli.putFlags",
  input: framesCommand.options[2],
  run: (_, { input }) => {
    const { size, id, base, at } = input;
    const read = typedFlags.safeParse({ size, id, base, at });
    if (read.success) return { bad: null, ...read.data };

    const flag = z.enum(["size", "id", "base", "at"]).parse(read.error.issues[0]?.path[0]);
    return { bad: badFlag[flag] };
  },
});

const putUsage = operation({
  label: "cli.putUsage",
  input: framesCommand.options[2],
  run: (_, { input }) => {
    if ((input.id === undefined) !== (input.base === undefined)) {
      return "--id needs --base, the version you got: `easel get` prints it";
    }

    const boxed = [input.name, input.size, input.page, input.at].some((flag) => flag !== undefined);
    return input.id !== undefined && boxed
      ? "--name, --size, --page and --at do not go with --id: a put with --id writes the document only; `easel move` moves a frame"
      : null;
  },
});

const tooBigText = operation({
  label: "cli.tooBigText",
  input: z.object({ maxBytes: z.number(), app: z.boolean() }),
  run: (_, { input: { maxBytes, app } }) =>
    app
      ? `the app frame is too big: over ${maxAppBytes} bytes of UTF-8, or its made CSS would be. Keep one frame in one file of at most 256 KiB, and use kit classes`
      : maxBytes === maxMadeCssBytes
        ? `the document is too big: its made CSS would be over ${maxMadeCssBytes} bytes. Use fewer class names: kit classes, and the scales of the look`
        : `the document is too big: over ${maxBytes} bytes of UTF-8, or over ${maxSentDocBytes} as JSON, where each " \\ and control character counts 2 to 6. Inline less, or load assets over https`,
});

const goneText = operation({
  label: "cli.goneText",
  input: z.object({ canvas: z.string(), id: z.string().optional(), page: z.string().optional() }),
  run: (_, { input: { canvas, id, page } }) => {
    if (id !== undefined) return `no frame ${id} on ${canvas}: a put with --id never makes a frame`;
    if (page === undefined) return `no canvas ${canvas}: make it with \`easel canvas new\``;
    return `no canvas ${canvas}, or no page ${page} on it: \`easel pages ${canvas}\` lists the pages`;
  },
});

const offKitText = operation({
  label: "cli.offKitText",
  input: z.object({ findings: z.array(z.unknown()), more: z.number() }),
  run: (_, { input: { findings, more } }) => {
    const count = findings.length + more;
    return `offKit: nothing was written; the app frame has ${count} ${count === 1 ? "finding" : "findings"} to fix first (below)`;
  },
});

const unsettledText = operation({
  label: "cli.unsettledText",
  input: z.object({ findings: z.array(z.unknown()), more: z.number() }),
  run: (_, { input: { findings, more } }) => {
    const count = findings.length + more;
    return `unsettled: nothing changed; the frame has ${count} ${count === 1 ? "finding" : "findings"} to settle first (below). A ready frame uses only the texts of the team and the look`;
  },
});

type PutAnswer = z.infer<typeof putOutput>;

const foundText = operation({
  label: "cli.foundText",
  input: z.custom<Extract<PutAnswer, { findings: unknown }>>(),
  depends: { offKitText, unsettledText },
  run: ({ offKitText, unsettledText }, { input: answer }) => {
    switch (answer.kind) {
      case "created":
      case "updated":
      case "unchanged":
        return { text: `${answer.kind} ${answer.id} v${answer.version}`, error: false };
      case "offKit":
        return { text: offKitText.run({ input: answer }), error: true };
      case "unsettled":
        return { text: unsettledText.run({ input: answer }), error: true };
    }
  },
});

const putText = operation({
  label: "cli.putText",
  input: z.object({
    canvas: z.string(),
    id: z.string().optional(),
    page: z.string().optional(),
    answer: putOutput,
    app: z.boolean(),
  }),
  depends: { tooBigText, foundText, goneText },
  run: ({ tooBigText, foundText, goneText }, { input: { canvas, id, page, answer, app } }) => {
    if ("findings" in answer) return foundText.run({ input: answer });

    switch (answer.kind) {
      case "stale":
        return {
          text: `stale: ${answer.id} is at v${answer.version}, nothing was written. Get it again (\`easel get ${canvas} ${answer.id} -o <file>\`), make your change on it, and put with --base ${answer.version}`,
          error: true,
        };
      case "gone":
        return { text: goneText.run({ input: { canvas, id, page } }), error: true };
      case "tooBig":
        return { text: tooBigText.run({ input: { maxBytes: answer.maxBytes, app } }), error: true };
    }
  },
});

const putFindings = operation({
  label: "cli.putFindings",
  input: z.object({ file: z.string(), folder: z.boolean(), answer: putOutput }),
  depends: { stderr: stderr.required, asJson: json },
  run: ({ stderr, asJson }, { input: { file, folder, answer } }) => {
    if (asJson || !("findings" in answer)) return;

    for (const f of answer.findings) {
      const at = folder ? join(file, f.file ?? entryFile) : file;
      stderr.write(`${at}:${f.line}:${f.col} ${f.rule} ${f.what}. Fix: ${f.fix}\n`);
    }
    if (answer.more > 0) stderr.write(`and ${answer.more} more\n`);
  },
});

const putDoc = z.union([
  z.object({ html: z.string() }),
  z.object({ tsx: z.string(), ready: z.boolean().optional() }),
  z.object({ files: z.custom<FrameFiles>(), ready: z.boolean().optional() }),
]);

const docOf = operation({
  label: "cli.docOf",
  input: z.object({
    read: z.union([
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("files"), files: z.custom<FrameFiles>() }),
    ]),
    app: z.boolean(),
    ready: z.boolean().optional(),
  }),
  run: (_, { input: { read, app, ready } }): z.infer<typeof putDoc> => {
    if (read.kind === "files") return { files: read.files, ready };
    return app ? { tsx: read.text, ready } : { html: read.text };
  },
});

const loadDoc = operation({
  label: "cli.loadDoc",
  input: z.object({ file: z.string(), ready: z.boolean().optional() }),
  depends: { readDocument, docOf },
  run: async ({ readDocument, docOf }, { input: { file, ready } }) => {
    const read = await readDocument.run({ input: file });
    if (!read) {
      return { bad: file === "-" ? "stdin cannot be read" : `cannot read ${file}` } as const;
    }
    if (read.kind === "bad") return { bad: read.bad } as const;

    const folder = read.kind === "files";
    const app = folder || file.endsWith(".tsx");
    const notApp = "--ready is for an app frame: a .tsx file or a folder";
    if (ready && !app) return { bad: notApp } as const;
    return { bad: null, folder, app, doc: docOf.run({ input: { read, app, ready } }) } as const;
  },
});

const sentDoc = operation({
  label: "cli.sentDoc",
  input: putDoc,
  run: (_, { input: doc }) => {
    if ("html" in doc) return { bytes: Buffer.byteLength(doc.html, "utf8"), maxBytes: maxDocBytes };
    const texts = "tsx" in doc ? [doc.tsx] : Object.values(doc.files);
    const bytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
    return { bytes, maxBytes: maxAppBytes };
  },
});

const sendPut = operation({
  label: "cli.sendPut",
  input: z.object({
    command: z.object({
      canvas: canvasKey,
      name: frameName.optional(),
      size: size.optional(),
      id: frameId.optional(),
      base: version.optional(),
      page: pageKey.optional(),
      x: placeAt.optional(),
      y: placeAt.optional(),
    }),
    doc: putDoc,
  }),
  depends: { framesFault, deadline: framesDeadline, putCall: frames.api["frame.put"], sentDoc },
  run: async ({ framesFault, deadline, putCall, sentDoc }, { input: { command, doc } }) => {
    const { bytes, maxBytes } = sentDoc.run({ input: doc });
    const sentBytes = Buffer.byteLength(JSON.stringify(doc), "utf8");
    if (bytes > maxBytes || sentBytes > maxSentDocBytes) {
      return { answered: true as const, answer: { kind: "tooBig" as const, maxBytes } };
    }

    const { canvas, id, base, name, size, page, x, y } = command;
    const sent =
      id !== undefined && base !== undefined
        ? { canvas, ...doc, id, base }
        : { canvas, ...doc, name, size, page, x, y };
    const stop = deadline.run({ input: "frame.put" });
    const reply = await putCall.settle({ input: sent, signal: stop.signal });
    stop.abort();

    if (reply.status === "cancelled") {
      return { answered: false as const, exit: framesFault.run({ input: reply.reason }) };
    }
    if (reply.status === "failed") {
      return { answered: false as const, exit: framesFault.run({ input: reply.error }) };
    }
    return { answered: true as const, answer: reply.value };
  },
});

export const put = operation({
  label: "cli.put",
  input: framesCommand.options[2],
  depends: {
    say,
    usage,
    putUsage,
    putFlags,
    loadDoc,
    sendPut,
    putText,
    putFindings,
    exitOf: framesExitOf,
  },
  run: async (units, { input }) => {
    const { say, usage, putUsage, putFlags, loadDoc, sendPut } = units;
    const { putText, putFindings, exitOf } = units;
    const bad = putUsage.run({ input });
    if (bad !== null) return usage.run({ input: bad });

    const flags = putFlags.run({ input });
    if (flags.bad !== null) return usage.run({ input: flags.bad });

    const loaded = await loadDoc.run({ input: { file: input.file, ready: input.ready } });
    if (loaded.bad !== null) return usage.run({ input: loaded.bad });

    const { size, id, base } = flags;
    const place = { page: input.page, x: flags.at?.x, y: flags.at?.y };
    const command = { canvas: input.canvas, name: input.name, size, id, base, ...place };
    const { folder, app, doc } = loaded;
    const sent = await sendPut.run({ input: { command, doc } });
    if (!sent.answered) return sent.exit;

    const { answer } = sent;
    const { canvas, page } = input;
    const told = putText.run({ input: { canvas, id: input.id, page, answer, app } });
    say.run({ input: { json: answer, ...told } });
    putFindings.run({ input: { file: input.file, folder, answer } });
    return exitOf.run({ input: { address: "frame.put", kind: answer.kind } });
  },
});

export const ls = operation({
  label: "cli.ls",
  input: framesCommand.options[3],
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    list: frames.api["frame.list"],
  },
  run: async ({ say, exitOf, framesFault, deadline, list }, { input }) => {
    const stop = deadline.run({ input: "frame.list" });
    const reply = await list.settle({ input: { canvas: input.canvas }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "found":
        say.run({
          input: {
            json: answer,
            text: answer.frames.length
              ? answer.frames
                  .map(
                    (f) =>
                      `${f.id}\t${f.name}\t${f.page}\t${f.x},${f.y} ${f.w}x${f.h}\tv${f.version}\t${f.status}`,
                  )
                  .join("\n")
              : `no frame on ${input.canvas} yet: \`easel put ${input.canvas} <file>\``,
          },
        });
        break;
      case "gone":
        say.run({ input: { json: answer, text: `no canvas ${input.canvas}`, error: true } });
        break;
    }

    return exitOf.run({ input: { address: "frame.list", kind: answer.kind } });
  },
});

const writtenOf = operation({
  label: "cli.writtenOf",
  input: frame,
  run: (_, { input }) => {
    if ("files" in input) {
      const { files, ...info } = input;
      return { html: null, files, info };
    }
    if ("tsx" in input) {
      const { tsx, ...info } = input;
      return { html: tsx, files: null, info };
    }

    const { html, ...info } = input;
    return { html, files: null, info };
  },
});

const writeFolder = operation({
  label: "cli.writeFolder",
  input: z.object({ out: z.string(), files: frameFiles }),
  run: (_, { input: { out, files } }) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(out, path)), { recursive: true });
      writeFileSync(join(out, path), text);
    }
  },
});

const gotOut = operation({
  label: "cli.gotOut",
  input: z.object({
    answer: z.object({ kind: z.literal("found"), frame }),
    out: z.string().optional(),
  }),
  depends: { writtenOf, writeFolder },
  run: ({ writtenOf, writeFolder }, { input: { answer, out } }) => {
    const { html, files, info } = writtenOf.run({ input: answer.frame });
    const entries = Object.entries(files ?? {});
    if (out === undefined) {
      const text = files
        ? entries.map(([path, one]) => `==> ${path} <==\n${one}`).join("\n")
        : html;
      return { json: answer, text: text ?? "" };
    }

    if (files) writeFolder.run({ input: { out, files } });
    else writeFileSync(out, html ?? "");
    const where = files ? `${join(out, "/")} (${entries.length} files)` : out;
    return {
      json: { kind: answer.kind, frame: info, file: out },
      text: `${info.id} v${info.version} written to ${where}`,
    };
  },
});

export const get = operation({
  label: "cli.get",
  input: framesCommand.options[4],
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    getCall: frames.api["frame.get"],
    gotOut,
  },
  run: async ({ say, exitOf, framesFault, deadline, getCall, gotOut }, { input }) => {
    const stop = deadline.run({ input: "frame.get" });
    const reply = await getCall.settle({
      input: { canvas: input.canvas, id: input.id },
      signal: stop.signal,
    });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "found":
        say.run({ input: gotOut.run({ input: { answer, out: input.out } }) });
        break;
      case "gone":
        say.run({
          input: { json: answer, text: `no frame ${input.id} on ${input.canvas}`, error: true },
        });
        break;
    }

    return exitOf.run({ input: { address: "frame.get", kind: answer.kind } });
  },
});

export const rm = operation({
  label: "cli.rm",
  input: framesCommand.options[5],
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    drop: frames.api["frame.delete"],
  },
  run: async ({ say, exitOf, framesFault, deadline, drop }, { input }) => {
    const stop = deadline.run({ input: "frame.delete" });
    const reply = await drop.settle({
      input: { canvas: input.canvas, id: input.id },
      signal: stop.signal,
    });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "deleted":
        say.run({ input: { json: answer, text: `deleted ${input.id}` } });
        break;
      case "gone":
        say.run({
          input: { json: answer, text: `no frame ${input.id} on ${input.canvas}`, error: true },
        });
        break;
    }

    return exitOf.run({ input: { address: "frame.delete", kind: answer.kind } });
  },
});

const unsettledLines = operation({
  label: "cli.unsettledLines",
  input: z.object({ findings: z.array(findingShape), more: z.number() }),
  depends: { stderr: stderr.required, asJson: json },
  run: ({ stderr, asJson }, { input: { findings, more } }) => {
    if (asJson) return;

    for (const f of findings) {
      stderr.write(
        `${f.file ?? entryFile}:${f.line}:${f.col} ${f.rule} ${f.what}. Fix: ${f.fix}\n`,
      );
    }
    if (more > 0) stderr.write(`and ${more} more\n`);
  },
});

export const ready = operation({
  label: "cli.ready",
  input: framesCommand.options[7],
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    unsettledText,
    unsettledLines,
    deadline: framesDeadline,
    mark: frames.api["frame.ready"],
  },
  run: async (units, { input }) => {
    const { say, exitOf, framesFault, unsettledText, unsettledLines, deadline, mark } = units;
    const stop = deadline.run({ input: "frame.ready" });
    const reply = await mark.settle({
      input: { canvas: input.canvas, id: input.id },
      signal: stop.signal,
    });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "ready":
        say.run({ input: { json: answer, text: `ready ${input.id} v${answer.version}` } });
        break;
      case "unchanged":
        say.run({
          input: { json: answer, text: `unchanged ${input.id} v${answer.version}: it is ready` },
        });
        break;
      case "unsettled":
        say.run({
          input: { json: answer, text: unsettledText.run({ input: answer }), error: true },
        });
        unsettledLines.run({ input: answer });
        break;
      case "gone":
        say.run({
          input: { json: answer, text: `no frame ${input.id} on ${input.canvas}`, error: true },
        });
        break;
    }

    return exitOf.run({ input: { address: "frame.ready", kind: answer.kind } });
  },
});

export const explore = operation({
  label: "cli.explore",
  input: framesCommand.options[8],
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    mark: frames.api["frame.explore"],
  },
  run: async ({ say, exitOf, framesFault, deadline, mark }, { input }) => {
    const stop = deadline.run({ input: "frame.explore" });
    const reply = await mark.settle({
      input: { canvas: input.canvas, id: input.id },
      signal: stop.signal,
    });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "exploring":
        say.run({ input: { json: answer, text: `exploring ${input.id}` } });
        break;
      case "unchanged":
        say.run({ input: { json: answer, text: `unchanged ${input.id}: it is exploring` } });
        break;
      case "gone":
        say.run({
          input: { json: answer, text: `no frame ${input.id} on ${input.canvas}`, error: true },
        });
        break;
    }

    return exitOf.run({ input: { address: "frame.explore", kind: answer.kind } });
  },
});

const shareFlags = z
  .object({
    canvas: z.string(),
    password: z.string().optional(),
    noPassword: z.boolean().optional(),
  })
  .refine((flags) => !(flags.password !== undefined && flags.noPassword), {
    message: "--password and --no-password do not go together",
  })
  .refine(
    (flags) => flags.password === undefined || sharePassword.safeParse(flags.password).success,
    {
      message: `--password takes ${sharePassword.minLength ?? 8} to ${sharePassword.maxLength ?? 1024} characters`,
    },
  )
  .transform(({ canvas, password, noPassword }) =>
    noPassword
      ? { canvas, password: null }
      : password === undefined
        ? { canvas }
        : { canvas, password },
  );

const noCanvas = operation({
  label: "cli.noCanvas",
  input: z.object({ canvas: z.string(), answer: z.object({ kind: z.literal("gone") }) }),
  depends: { say },
  run: ({ say }, { input }) =>
    say.run({
      input: {
        json: input.answer,
        text: `no canvas ${input.canvas}: make it with \`easel canvas new\``,
        error: true,
      },
    }),
});

export const share = operation({
  label: "cli.share",
  input: shareCommand.options[0],
  depends: {
    say,
    usage,
    noCanvas,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    origin: server.required,
    shareCall: frames.api["canvas.share"],
  },
  run: async (
    { say, usage, noCanvas, exitOf, framesFault, deadline, origin, shareCall },
    { input },
  ) => {
    const flags = shareFlags.safeParse(input);
    if (!flags.success) {
      return usage.run({ input: flags.error.issues.map((issue) => issue.message).join("; ") });
    }

    const stop = deadline.run({ input: "canvas.share" });
    const reply = await shareCall.settle({ input: flags.data, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "shared": {
        const url = new URL(answer.path, origin).href;
        say.run({ input: { json: { kind: answer.kind, url }, text: url } });
        break;
      }
      case "gone":
        noCanvas.run({ input: { canvas: input.canvas, answer } });
        break;
    }

    return exitOf.run({ input: { address: "canvas.share", kind: answer.kind } });
  },
});

export const unshare = operation({
  label: "cli.unshare",
  input: shareCommand.options[1],
  depends: {
    say,
    noCanvas,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    unshareCall: frames.api["canvas.unshare"],
  },
  run: async ({ say, noCanvas, exitOf, framesFault, deadline, unshareCall }, { input }) => {
    const stop = deadline.run({ input: "canvas.unshare" });
    const reply = await unshareCall.settle({
      input: { canvas: input.canvas },
      signal: stop.signal,
    });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "unshared":
        say.run({
          input: { json: answer, text: `${input.canvas} is not shared: its link has ended` },
        });
        break;
      case "gone":
        noCanvas.run({ input: { canvas: input.canvas, answer } });
        break;
    }

    return exitOf.run({ input: { address: "canvas.unshare", kind: answer.kind } });
  },
});

export const pictureFetch = tag<(request: Request) => Promise<Response>>({
  label: "cli.pictureFetch",
  default: () => Promise.reject(new Error("easel shot: no fetch given")),
});

export const shotTries = 3;

const shotFlags = z.object({
  scale: z
    .enum(["0.25", "0.5", "1", "2"], "--scale takes 0.25, 0.5, 1 or 2")
    .default("1")
    .transform(Number)
    .pipe(pictureScale),
  region: z
    .string()
    .regex(/^\d+,\d+,\d+,\d+$/, "--region takes x,y,w,h in the frame's CSS pixels, as 0,0,390,844")
    .transform((typed) => typed.split(",").map(Number))
    .transform(([x = 0, y = 0, w = 0, h = 0]) => ({ x, y, w, h }))
    .pipe(pictureRegion)
    .optional(),
});

const fetchPicture = operation({
  label: "cli.fetchPicture",
  input: z.string(),
  depends: { send: pictureFetch },
  run: async ({ send }, { input: url, clock, signal }) => {
    let status = 0;
    for (let tried = 1; tried <= shotTries; tried++) {
      const stop = new AbortController();
      const late = clock.sleep(callDeadline, AbortSignal.any([signal, stop.signal])).then(
        () => stop.abort(),
        () => undefined,
      );
      const got = await send(new Request(url, { signal: stop.signal }))
        .then(async (response) => ({
          status: response.status,
          wait: Number(response.headers.get("retry-after") ?? 1),
          bytes: response.status === 200 ? new Uint8Array(await response.arrayBuffer()) : null,
        }))
        .catch(() => ({ status: 0, wait: 1, bytes: null }));
      stop.abort();
      await late;
      status = got.status;
      if (got.bytes !== null) return { status, bytes: got.bytes };
      if ((status !== 0 && status !== 503) || tried === shotTries) break;

      const wait = Number.isFinite(got.wait) ? Math.min(Math.max(got.wait, 0), 5) : 1;
      await clock.sleep(wait * 1000, signal);
    }
    return { status, bytes: null };
  },
});

const badShotFlag = {
  scale: "--scale takes 0.25, 0.5, 1 or 2",
  region:
    "--region takes x,y,w,h in the frame's CSS pixels, each 0 to 16000, w and h at least 1, as 0,0,390,844",
} as const;

const shotFailure = operation({
  label: "cli.shotFailure",
  input: z.object({ status: z.number(), id: z.string() }),
  run: (_, { input: { status, id } }) => {
    if (status === 0 || status === 503) {
      return {
        exit: exits.unreachable,
        text: `the server did not draw it in ${shotTries} tries: it is busy, or out of reach. Try again in a minute`,
      };
    }
    if (status === 404) {
      return { exit: exits.no, text: `no picture of ${id}: it was deleted, or its link ended` };
    }
    if (status === 400) {
      return {
        exit: exits.invalid,
        text: "the region is off the frame, or the picture is over 8 megapixels or 16000 px a side: use a smaller --scale or --region",
      };
    }
    return { exit: exits.failed, text: `the picture failed: HTTP ${status}` };
  },
});

export const shot = operation({
  label: "cli.shot",
  input: framesCommand.options[6],
  depends: {
    say,
    usage,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    origin: server.required,
    shotCall: frames.api["frame.shot"],
    fetchPicture,
    shotFailure,
  },
  run: async (
    { say, usage, exitOf, framesFault, deadline, origin, shotCall, fetchPicture, shotFailure },
    { input },
  ) => {
    const flags = shotFlags.safeParse({ scale: input.scale, region: input.region });
    if (!flags.success) {
      const scale = flags.error.issues.some((issue) => issue.path[0] === "scale");
      return usage.run({ input: scale ? badShotFlag.scale : badShotFlag.region });
    }

    const stop = deadline.run({ input: "frame.shot" });
    const call = { canvas: input.canvas, id: input.id, ...flags.data };
    const reply = await shotCall.settle({ input: call, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    if (answer.kind !== "ready") {
      const text =
        answer.kind === "off"
          ? "pictures are off: the server has no Chromium (EASEL_CHROMIUM)"
          : `no frame ${input.id} on ${input.canvas}`;
      say.run({ input: { json: answer, text, error: true } });
      return exitOf.run({ input: { address: "frame.shot", kind: answer.kind } });
    }

    const got = await fetchPicture.run({ input: new URL(answer.url, origin).href });
    if (got.bytes !== null) {
      writeFileSync(input.out, got.bytes);
      say.run({
        input: {
          json: { kind: answer.kind, version: answer.version, file: input.out },
          text: `${input.id} v${answer.version} written to ${input.out}`,
        },
      });
      return exitOf.run({ input: { address: "frame.shot", kind: answer.kind } });
    }

    const told = shotFailure.run({ input: { status: got.status, id: input.id } });
    say.run({
      input: { json: { kind: "failed", status: got.status }, text: told.text, error: true },
    });
    return told.exit;
  },
});

const canvasCommand = z.discriminatedUnion("kind", [
  framesCommand.options[0],
  framesCommand.options[1],
]);

const frameCommand = z.discriminatedUnion("kind", [
  framesCommand.options[2],
  framesCommand.options[3],
  framesCommand.options[4],
  framesCommand.options[5],
  framesCommand.options[6],
  framesCommand.options[7],
  framesCommand.options[8],
]);

const canvasRun = operation({
  label: "cli.canvasCommand",
  input: canvasCommand,
  depends: { canvasNew, canvasLs },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "canvas new":
        return ops.canvasNew.run({ input });
      case "canvas ls":
        return ops.canvasLs.run();
    }
  },
});

const frameRun = operation({
  label: "cli.frameCommand",
  input: frameCommand,
  depends: { put, ls, get, rm, shot, ready, explore },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "put":
        return ops.put.run({ input });
      case "ls":
        return ops.ls.run({ input });
      case "get":
        return ops.get.run({ input });
      case "rm":
        return ops.rm.run({ input });
      case "shot":
        return ops.shot.run({ input });
      case "ready":
        return ops.ready.run({ input });
      case "explore":
        return ops.explore.run({ input });
    }
  },
});

export const shareRun = operation({
  label: "cli.shareRun",
  input: shareCommand,
  depends: { share, unshare },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "share":
        return ops.share.run({ input });
      case "unshare":
        return ops.unshare.run({ input });
    }
  },
});

export const framesRun = operation({
  label: "cli.frames",
  input: framesCommand,
  depends: { canvasRun, frameRun },
  run: ({ canvasRun, frameRun }, { input }) => {
    const whole = canvasCommand.safeParse(input);
    return whole.success
      ? canvasRun.run({ input: whole.data })
      : frameRun.run({ input: frameCommand.parse(input) });
  },
});
