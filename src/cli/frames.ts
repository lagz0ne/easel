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
  pictureRegion,
  pictureScale,
  putOutput,
  size,
  version,
} from "@/frames/contract";
import type { FramesAddress } from "@/frames/contract";
import { sharePassword } from "@/frames/share";
import { entryFile, type FrameFiles, frameFiles, maxAppBytes } from "@/kit/schema";

import { callDeadline, exits, faultExit } from "./exit";
import { server } from "./hosts";
import { json, say, stderr } from "./output";

// `easel canvas new|ls`, `easel put`, `easel ls`, `easel get`, `easel rm`, `easel share`, `easel unshare` and `easel shot`
// (SPEC-frames.md § Make a canvas, § Make and change frames, § Share a canvas). Each prints its answer and exits by
// the call's success list in frames' contract (SPEC-cli.md fact rule 3). A frames fault is told
// as the shell tells any fault (`faultExit`): refused 2, invalid 65, link 69, failed 70.

/** The text of stdin, for `easel put <canvas> -`; the cmd gives it. None: `-` is bad usage. */
export const stdinText = tag<(() => Promise<string>) | null>({
  label: "cli.stdinText",
  default: null,
});

/** One frames command, as the cmd read it from its flags. */
export const framesCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canvas new"), name: z.string() }),
  z.object({ kind: z.literal("canvas ls") }),
  z.object({
    kind: z.literal("put"),
    canvas: canvasKey,
    /** A path, or `-` for stdin. */
    file: z.string().min(1),
    name: frameName.optional(),
    /** `--size`, `--id` and `--base` as typed: `put` reads them, and names a bad one (64). */
    size: z.string().optional(),
    id: z.string().optional(),
    base: z.string().optional(),
  }),
  z.object({ kind: z.literal("ls"), canvas: canvasKey }),
  z.object({ kind: z.literal("get"), canvas: canvasKey, id: frameId, out: z.string().optional() }),
  z.object({ kind: z.literal("rm"), canvas: canvasKey, id: frameId }),
  /** `--scale` and `--region` as typed: `shot` reads them, and names a bad one (64). */
  z.object({
    kind: z.literal("shot"),
    canvas: canvasKey,
    id: frameId,
    out: z.string().min(1),
    scale: z.string().optional(),
    region: z.string().optional(),
  }),
]);

export type FramesCommand = z.infer<typeof framesCommand>;

/** `easel share` and `easel unshare`, as the cmd read them from their flags. */
export const shareCommand = z.discriminatedUnion("kind", [
  /** `--password` as typed, and `--no-password`: `share` reads them, and names a bad one (64). */
  z.object({
    kind: z.literal("share"),
    canvas: canvasKey,
    password: z.string().optional(),
    noPassword: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("unshare"), canvas: canvasKey }),
]);

export type ShareCommand = z.infer<typeof shareCommand>;

/** `--size 390x844`, as typed. */
const sizeFlag = z
  .string()
  .regex(/^\d+x\d+$/)
  .transform((typed) => typed.split("x").map(Number))
  .transform(([w = 0, h = 0]) => ({ w, h }))
  .pipe(size);

/** `--base 3`, as typed. */
const baseFlag = z.string().regex(/^\d+$/).transform(Number).pipe(version);

/** What each bad flag of `easel put` says: one line that names it. */
const badFlag = {
  size: "--size takes WxH in CSS pixels, each 1 to 16000, as 390x844",
  id: "--id takes a frame's id, 12 of 0-9 and a-f: `easel ls <canvas>` prints them",
  base: "--base takes the version you got, 1 or more: `easel get` prints it",
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
] satisfies FramesAddress[]);

/**
 * One call's deadline: after `callDeadline` (60 s) its signal aborts with a `link` fault, as the
 * shell's `deadline` does. The caller aborts the controller when the answer comes.
 */
const framesDeadline = operation({
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

/** 0 when frames' contract lists the kind as a success, else 1. No kind: `always` says. */
export const framesExitOf = operation({
  label: "cli.framesExitOf",
  input: z.object({ address, kind: z.string().optional() }),
  run: (_, { input }) => {
    const list: "always" | readonly string[] = framesSuccessKinds[input.address];
    const ok = list === "always" || list.some((kind) => kind === input.kind);

    return ok ? exits.ok : exits.no;
  },
});

/**
 * A call that did not answer, told as the shell tells it. A frames fault is made again as one
 * the shell knows, with its address, payload, trace and execution; anything else goes as it is.
 */
const framesFault = operation({
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

/** Bad flags: the text says what to do, and the run exits 64 before it calls. */
const usage = operation({
  label: "cli.framesUsage",
  input: z.string(),
  depends: { say },
  run: ({ say }, { input: text }) => {
    say.run({ input: { json: { usage: text }, text, error: true } });
    return exits.usage;
  },
});

/** `easel canvas new <name>` (`canvas.create`): prints the key. */
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
    // rpc checks the input before it sends: a name with no letter or digit gives no key, and is
    // `invalid` (65, decision C3), told here as the shell tells the server's invalid fault.
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

/** `easel canvas ls` (`canvas.list`): key, name, when it was made, and whether it is shared. */
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

/**
 * The files of a folder frame (SPEC-cli.md § Frames): each `.ts` and `.tsx` file in the folder and
 * in its folders, by its path from the folder, with `/` between the parts. A folder whose name
 * starts with `.`, and `node_modules`, are left out. `bad` says why the files are not a frame.
 */
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

/**
 * The document of `easel put`: the file's text, stdin's for `-`, or the files of a folder. Null:
 * it cannot be read.
 */
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

/** `easel put`'s flags as typed: `--size 390x844`, `--id 4cfd45337798`, `--base 3`. */
const typedFlags = z.object({
  size: sizeFlag.optional(),
  id: frameId.optional(),
  base: baseFlag.optional(),
});

/** `easel put`'s flags, read: the size, id and base, or the one line that says what is wrong. */
const putFlags = operation({
  label: "cli.putFlags",
  input: framesCommand.options[2],
  run: (_, { input }) => {
    const read = typedFlags.safeParse({ size: input.size, id: input.id, base: input.base });
    if (read.success) return { bad: null, ...read.data };

    const flag = z.enum(["size", "id", "base"]).parse(read.error.issues[0]?.path[0]);
    return { bad: badFlag[flag] };
  },
});

/** Bad flags for `easel put`, as a text that says what to do; null when they are right (C5). */
const putUsage = operation({
  label: "cli.putUsage",
  input: framesCommand.options[2],
  run: (_, { input }) => {
    if ((input.id === undefined) !== (input.base === undefined)) {
      return "--id needs --base, the version you got: `easel get` prints it";
    }

    const boxed = input.name !== undefined || input.size !== undefined;
    return input.id !== undefined && boxed
      ? "--name and --size do not go with --id: a put with --id writes the document only"
      : null;
  },
});

/** What `easel put` prints for `tooBig`: the document is too big, or its made CSS would be. */
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

/** What `easel put` prints for `gone`: no canvas, or, with `--id`, no frame. */
const goneText = operation({
  label: "cli.goneText",
  input: z.object({ canvas: z.string(), id: z.string().optional() }),
  run: (_, { input: { canvas, id } }) =>
    id === undefined
      ? `no canvas ${canvas}: make it with \`easel canvas new\``
      : `no frame ${id} on ${canvas}: a put with --id never makes a frame`,
});

/** What `easel put` prints for `offKit`: nothing was written, and the count of the findings. */
const offKitText = operation({
  label: "cli.offKitText",
  input: z.object({ findings: z.array(z.unknown()), more: z.number() }),
  run: (_, { input: { findings, more } }) => {
    const count = findings.length + more;
    return `offKit: nothing was written; the app frame has ${count} ${count === 1 ? "finding" : "findings"} to fix first (below)`;
  },
});

/** What `easel put` prints for each answer of `frame.put`, and where. */
const putText = operation({
  label: "cli.putText",
  input: z.object({
    canvas: z.string(),
    id: z.string().optional(),
    answer: putOutput,
    app: z.boolean(),
  }),
  depends: { tooBigText, offKitText, goneText },
  run: ({ tooBigText, offKitText, goneText }, { input: { canvas, id, answer, app } }) => {
    switch (answer.kind) {
      case "created":
      case "updated":
      case "unchanged":
        return { text: `${answer.kind} ${answer.id} v${answer.version}`, error: false };
      case "stale":
        return {
          text: `stale: ${answer.id} is at v${answer.version}, nothing was written. Get it again (\`easel get ${canvas} ${answer.id} -o <file>\`), make your change on it, and put with --base ${answer.version}`,
          error: true,
        };
      case "gone":
        return { text: goneText.run({ input: { canvas, id } }), error: true };
      case "tooBig":
        return { text: tooBigText.run({ input: { maxBytes: answer.maxBytes, app } }), error: true };
      case "offKit":
        return { text: offKitText.run({ input: answer }), error: true };
    }
  },
});

/**
 * The findings of a put, for a person (SPEC-cli.md § Learn the kit): each on stderr, one a line,
 * as `<file>:<line>:<col> <rule> <what>. Fix: <fix>`, then `and <n> more`. With `--json` they are
 * in the answer, so nothing more is printed. Findings do not change the exit code.
 */
const putFindings = operation({
  label: "cli.putFindings",
  input: z.object({ file: z.string(), folder: z.boolean(), answer: putOutput }),
  depends: { stderr: stderr.required, asJson: json },
  run: ({ stderr, asJson }, { input: { file, folder, answer } }) => {
    if (asJson || !("findings" in answer)) return;

    for (const f of answer.findings) {
      // In a folder, a finding names its file; with one file in the folder, it is the entry.
      const at = folder ? join(file, f.file ?? entryFile) : file;
      stderr.write(`${at}:${f.line}:${f.col} ${f.rule} ${f.what}. Fix: ${f.fix}\n`);
    }
    if (answer.more > 0) stderr.write(`and ${answer.more} more\n`);
  },
});

/** The document of a put as `frame.put` takes it: `{ html }`, `{ tsx }` or `{ files }`. */
const putDoc = z.union([
  z.object({ html: z.string() }),
  z.object({ tsx: z.string() }),
  z.object({ files: z.custom<FrameFiles>() }),
]);

/** The document of a put from what `readDocument` read: the files, the TSX, or the html. */
const docOf = operation({
  label: "cli.docOf",
  input: z.object({
    read: z.union([
      z.object({ kind: z.literal("text"), text: z.string() }),
      z.object({ kind: z.literal("files"), files: z.custom<FrameFiles>() }),
    ]),
    app: z.boolean(),
  }),
  run: (_, { input: { read, app } }): z.infer<typeof putDoc> => {
    if (read.kind === "files") return { files: read.files };
    return app ? { tsx: read.text } : { html: read.text };
  },
});

/** The UTF-8 bytes of a document, and its limit: 1 MiB, or 256 KiB for the files of an app frame. */
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

/**
 * `frame.put`'s answer for a document: `tooBig` without a call when it is over 1 MiB of UTF-8, or
 * over `maxSentDocBytes` as JSON (a socket closes on a message over its `maxPayload`), else the
 * server's. A call that did not answer is its exit code.
 */
const sendPut = operation({
  label: "cli.sendPut",
  input: z.object({
    command: z.object({
      canvas: canvasKey,
      name: frameName.optional(),
      size: size.optional(),
      id: frameId.optional(),
      base: version.optional(),
    }),
    /** An app frame goes as `tsx` or `files`, with its own limit of 256 KiB. */
    doc: putDoc,
  }),
  depends: { framesFault, deadline: framesDeadline, putCall: frames.api["frame.put"], sentDoc },
  run: async ({ framesFault, deadline, putCall, sentDoc }, { input: { command, doc } }) => {
    const { bytes, maxBytes } = sentDoc.run({ input: doc });
    const sentBytes = Buffer.byteLength(JSON.stringify(doc), "utf8");
    if (bytes > maxBytes || sentBytes > maxSentDocBytes) {
      return { answered: true as const, answer: { kind: "tooBig" as const, maxBytes } };
    }

    const { canvas, id, base, name, size } = command;
    const sent =
      id !== undefined && base !== undefined
        ? { canvas, ...doc, id, base }
        : { canvas, ...doc, name, size };
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

/**
 * `easel put <canvas> <file|-> [--name N] [--size WxH]` makes a frame; with `--id <id> --base <v>`
 * it writes the frame again at the version the agent read. `--id` needs `--base`, and takes no
 * `--name` or `--size` (decision C5): bad usage, 64, as is a bad flag, told in one line that names
 * it. A document too big to send answers `tooBig` before it is sent.
 */
export const put = operation({
  label: "cli.put",
  input: framesCommand.options[2],
  depends: {
    say,
    usage,
    putUsage,
    putFlags,
    readDocument,
    docOf,
    sendPut,
    putText,
    putFindings,
    exitOf: framesExitOf,
  },
  run: async (units, { input }) => {
    const { say, usage, putUsage, putFlags, readDocument, docOf, sendPut } = units;
    const { putText, putFindings, exitOf } = units;
    const bad = putUsage.run({ input });
    if (bad !== null) return usage.run({ input: bad });

    const flags = putFlags.run({ input });
    if (flags.bad !== null) return usage.run({ input: flags.bad });

    const read = await readDocument.run({ input: input.file });
    if (!read) {
      const text = input.file === "-" ? "stdin cannot be read" : `cannot read ${input.file}`;
      return usage.run({ input: text });
    }
    if (read.kind === "bad") return usage.run({ input: read.bad });

    const { size, id, base } = flags;
    const command = { canvas: input.canvas, name: input.name, size, id, base };
    // A folder is an app frame of its files; a file whose name ends in `.tsx` is an app frame
    // (SPEC-frames § Contract).
    const folder = read.kind === "files";
    const app = folder || input.file.endsWith(".tsx");
    const doc = docOf.run({ input: { read, app } });
    const sent = await sendPut.run({ input: { command, doc } });
    if (!sent.answered) return sent.exit;

    const { answer } = sent;
    const told = putText.run({ input: { canvas: input.canvas, id: input.id, answer, app } });
    say.run({ input: { json: answer, ...told } });
    putFindings.run({ input: { file: input.file, folder, answer } });
    return exitOf.run({ input: { address: "frame.put", kind: answer.kind } });
  },
});

/** `easel ls <canvas>` (`frame.list`): id, name, box and version. */
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
                  .map((f) => `${f.id}\t${f.name}\t${f.x},${f.y} ${f.w}x${f.h}\tv${f.version}`)
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

/**
 * A frame from `frame.get`: the document as it was written (the html, the TSX of an app frame, or
 * the files of a folder frame), and the rest.
 */
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

/**
 * The files of a folder frame, written in the folder `out`, each at its path; the folders that a
 * path needs are made. A file of the folder that the frame does not have stays.
 */
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

/**
 * What `easel get` prints for a frame it found, after it writes `out`: with no `out`, the
 * document (each file of a folder after a line `==> <path> <==`, as `head` prints files); with
 * `out`, the file, or for a folder frame the folder, and the version.
 */
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

/**
 * `easel get <canvas> <id> [-o file]` (`frame.get`): with `-o`, writes the document to the file
 * and prints the version (its JSON leaves the html out); without, prints the document.
 */
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

/** `easel rm <canvas> <id>` (`frame.delete`). */
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

/**
 * What `easel share` sends: the canvas, and the password: a string sets it, `--no-password`
 * (null) removes it, none keeps it.
 */
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

/** A canvas that is not there: how to make it. */
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

/**
 * `easel share <canvas>` (`canvas.share`): prints the link's page on this server,
 * `<server>/s/<link>`. Sharing a shared canvas prints the same link (judged rule 11).
 * `--password <pw>` sets or changes the password (8 characters or more), `--no-password` removes
 * it; with neither, it stays. Both together, or a short password, is bad usage, 64, before any
 * call. The password is never printed.
 */
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

/**
 * `easel unshare <canvas>` (`canvas.unshare`): the link ends, and each tab that has it open says
 * so at once. On a canvas that is not shared it says `unshared` too. Sharing again makes a new
 * link.
 */
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

/**
 * How `easel shot` fetches a picture: the cmd gives the global `fetch`; a test, one that reaches
 * its server's routes with no port. Unset, each fetch fails, as a server out of reach.
 */
export const pictureFetch = tag<(request: Request) => Promise<Response>>({
  label: "cli.pictureFetch",
  default: () => Promise.reject(new Error("easel shot: no fetch given")),
});

/** `easel shot` tries a picture 3 times: a busy server (503) or no answer is tried again. */
export const shotTries = 3;

/** `--scale 0.5`, as typed: one of the four. `--region x,y,w,h`, as typed. */
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

/**
 * One picture, fetched from the server it names, at most 3 tries. A 503 waits its `Retry-After`
 * (at most 5 s), a fetch that fails or runs past the call deadline waits 1 s, then it tries again.
 * Answers the last status (0: no answer at all) and, on 200, the bytes.
 */
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

/** What each bad flag of `easel shot` says: one line that names it. */
const badShotFlag = {
  scale: "--scale takes 0.25, 0.5, 1 or 2",
  region:
    "--region takes x,y,w,h in the frame's CSS pixels, each 0 to 16000, w and h at least 1, as 0,0,390,844",
} as const;

/**
 * The exit and the line for a picture not fetched: busy or out of reach after 3 tries, 69; gone,
 * 1; off the frame or too big, 65; any other status, 70.
 */
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

/**
 * `easel shot <canvas> <id> -o <file> [--scale 0.25|0.5|1|2] [--region x,y,w,h]`: asks the server
 * for the address of the frame's current version (`frame.shot`), fetches it, and writes the WebP
 * to the file. Pictures off or no frame: 1. A busy server after 3 tries: 69. A region off the frame
 * or too big a picture: 65. The address carries a key: it is never printed.
 */
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

/** The commands on a canvas as a whole: make one, list them. */
const canvasCommand = z.discriminatedUnion("kind", [
  framesCommand.options[0],
  framesCommand.options[1],
]);

/** The commands on a canvas's frames. */
const frameCommand = z.discriminatedUnion("kind", [
  framesCommand.options[2],
  framesCommand.options[3],
  framesCommand.options[4],
  framesCommand.options[5],
  framesCommand.options[6],
]);

/** Runs one command on a canvas as a whole; answers its exit code. */
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

/** Runs one command on a canvas's frames; answers its exit code. */
const frameRun = operation({
  label: "cli.frameCommand",
  input: frameCommand,
  depends: { put, ls, get, rm, shot },
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
    }
  },
});

/** Runs `easel share` or `easel unshare`; answers its exit code. */
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

/** Runs one frames command; answers its exit code. The shell's `cli.run` sends each here. */
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
