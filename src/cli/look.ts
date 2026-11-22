import { readFileSync, writeFileSync } from "node:fs";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "@/access/contract";
import { kit } from "@/kit";
import {
  kitCapsulesOutput,
  kitCheckOutput,
  kitSuccessKinds,
  kitVersion,
  lookGetOutput,
  lookSetOutput,
} from "@/kit/contract";
import type { KitAddress } from "@/kit/contract";
import { lookPatch } from "@/kit/shape";

import { callDeadline, exits, faultExit } from "./exit";
import { stdinText } from "./frames";
import { json, say, stderr } from "./output";

// `easel look get|set|undo` (SPEC-kit.md § Change the look; SPEC-cli.md § Commands by module),
// and `easel kit check <file>` (SPEC-kit.md § Make an app frame, step 5).
// Each prints its answer and exits by the call's success list in kit's contract (SPEC-cli fact
// rule 3): `found`, `updated` and `unchanged` exit 0; `stale`, `unreadable`, `none` and `gone`
// exit 1. A kit fault is told as the shell tells any fault (`faultExit`): a patch with a name
// that the look does not have is `invalid` (65), checked before the call is sent.

/** One look command, as the cmd read it from its flags. `--at` and `--base` as typed. */
export const lookCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get"), out: z.string().optional(), at: z.string().optional() }),
  z.object({ kind: z.literal("set"), file: z.string().min(1), base: z.string() }),
  z.object({ kind: z.literal("undo"), base: z.string() }),
  /** `easel kit check <file|->`: a path that ends in `.tsx` is an app frame. */
  z.object({ kind: z.literal("check"), file: z.string().min(1) }),
  /** `easel kit capsules`: the capsules of the current kit version. */
  z.object({ kind: z.literal("capsules") }),
]);

export type LookCommand = z.infer<typeof lookCommand>;

/** `--base 3` or `--at 3`, as typed: 1 or more. */
const numberFlag = z.string().regex(/^\d+$/).transform(Number).pipe(kitVersion);

const address = z.enum([
  "look.get",
  "look.set",
  "look.undo",
  "kit.check",
  "kit.capsules",
] satisfies KitAddress[]);

/** One call's deadline: after `callDeadline` (60 s) its signal aborts with a `link` fault. */
const lookDeadline = operation({
  label: "cli.lookDeadline",
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

/** 0 when kit's contract lists the kind as a success, else 1. */
const lookExitOf = operation({
  label: "cli.lookExitOf",
  input: z.object({ address, kind: z.string() }),
  run: (_, { input }) => {
    const list: readonly string[] = kitSuccessKinds[input.address];
    return list.includes(input.kind) ? exits.ok : exits.no;
  },
});

/** A call that did not answer, told as the shell tells it: a kit fault is made again as one it knows. */
const lookFault = operation({
  label: "cli.lookFault",
  input: z.unknown(),
  depends: { faultExit },
  run: ({ faultExit }, { input: error }) => {
    const known = kit.api.fault.is(error)
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

/** Bad flags or a file that is not JSON: the text says what to do, and the run exits 64. */
const lookUsage = operation({
  label: "cli.lookUsage",
  input: z.string(),
  depends: { say },
  run: ({ say }, { input: text }) => {
    say.run({ input: { json: { usage: text }, text, error: true } });
    return exits.usage;
  },
});

/** What `look set` and `look undo` print for a stale base: get the look again. */
const staleText = operation({
  label: "cli.lookStale",
  input: z.object({ rev: z.number(), kit: z.number() }),
  run: (_, { input: { rev, kit } }) =>
    `stale: the look is at revision ${rev} (kit version ${kit}): get it again with \`easel look get\`, and make the change on it`,
});

/** What `easel look get` prints for its answer, and the file it writes with `-o`. */
const tellGet = operation({
  label: "cli.lookTellGet",
  input: z.object({
    answer: lookGetOutput,
    out: z.string().optional(),
    at: z.number().optional(),
  }),
  depends: { say },
  run: ({ say }, { input: { answer, out, at } }) => {
    if (answer.kind === "gone") {
      say.run({ input: { json: answer, text: `no kit version ${at} is stored`, error: true } });
      return;
    }

    const file = `${JSON.stringify(answer.look, null, 2)}\n`;
    const line = `look revision ${answer.rev}, kit version ${answer.kit}`;
    if (out === undefined) {
      say.run({ input: { json: answer, text: `${file}${line}` } });
      return;
    }

    writeFileSync(out, file);
    const json = { kind: answer.kind, kit: answer.kit, rev: answer.rev, file: out };
    say.run({ input: { json, text: `${line} written to ${out}` } });
  },
});

/**
 * `easel look get [-o <file>] [--at <kit version>]` (`look.get`): the look as DTCG JSON, and its
 * revision and kit version. With `-o`, the file gets the JSON, and the line says where.
 */
export const lookGet = operation({
  label: "cli.lookGet",
  input: lookCommand.options[0],
  depends: {
    tellGet,
    usage: lookUsage,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    call: kit.api["look.get"],
  },
  run: async ({ tellGet, usage, exitOf, fault, deadline, call }, { input }) => {
    const at = numberFlag.optional().safeParse(input.at);
    if (!at.success) return usage.run({ input: "--at takes a kit version, 1 or more" });

    const stop = deadline.run({ input: "look.get" });
    const reply = await call.settle({ input: { at: at.data }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    tellGet.run({ input: { answer: reply.value, out: input.out, at: at.data } });
    return exitOf.run({ input: { address: "look.get", kind: reply.value.kind } });
  },
});

/** A patch file: its text from the path, or stdin for `-`; null when it cannot be read. */
const readPatch = operation({
  label: "cli.readPatch",
  input: z.string(),
  depends: { stdin: stdinText },
  run: async ({ stdin }, { input: file }) => {
    if (file === "-") return stdin ? await stdin() : null;
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
});

/** A text as JSON; null when it is not JSON. */
const jsonOf = z.string().transform((text, ctx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    ctx.addIssue({ code: "custom", message: "not JSON" });
    return z.NEVER;
  }
});

/** The words of `look set`, read: its patch and base, or the exit of the one line that says what is wrong. */
const readSet = operation({
  label: "cli.lookReadSet",
  input: lookCommand.options[1],
  depends: { say, usage: lookUsage, readPatch },
  run: async ({ say, usage, readPatch }, { input }) => {
    const base = numberFlag.safeParse(input.base);
    if (!base.success) {
      const text = "--base takes the look's revision, 1 or more: `easel look get` prints it";
      return { ok: false as const, exit: usage.run({ input: text }) };
    }
    const text = await readPatch.run({ input: input.file });
    if (text === null) {
      return { ok: false as const, exit: usage.run({ input: `cannot read ${input.file}` }) };
    }
    const json = jsonOf.safeParse(text);
    if (!json.success) {
      return { ok: false as const, exit: usage.run({ input: `${input.file} is not JSON` }) };
    }

    // As rpc checks it before it sends: a name that the look does not have is `invalid` (65).
    const patch = lookPatch.safeParse(json.data);
    if (patch.success) return { ok: true as const, input: { look: patch.data, base: base.data } };

    const issues = patch.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const told = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    const shown = { json: { invalid: issues }, text: `not a change of the look: ${told}` };
    say.run({ input: { ...shown, error: true } });
    return { ok: false as const, exit: exits.invalid };
  },
});

/** What `easel look set` prints for its answer: `unreadable` with each failing pair, a line each. */
const tellSet = operation({
  label: "cli.lookTellSet",
  input: lookSetOutput,
  depends: { say, staleText },
  run: ({ say, staleText }, { input: answer }) => {
    switch (answer.kind) {
      case "updated":
      case "unchanged": {
        const text = `${answer.kind}: look revision ${answer.rev}, kit version ${answer.kit}`;
        return say.run({ input: { json: answer, text } });
      }
      case "stale":
        return say.run({
          input: { json: answer, text: staleText.run({ input: answer }), error: true },
        });
      case "unreadable": {
        const lines = answer.fails.map(
          (p) => `${p.text} on ${p.on}: ${p.ratio}:1, needs ${p.min}:1 (${p.where})`,
        );
        const head = "unreadable: nothing is saved; each pair needs WCAG AA";
        return say.run({ input: { json: answer, text: [head, ...lines].join("\n"), error: true } });
      }
    }
  },
});

/**
 * `easel look set <file|-> --base <rev>` (`look.set`): a JSON Merge Patch of the look's values.
 * `unreadable` prints each failing pair on stderr, one a line, as
 * `primary-foreground on primary: 1.53:1, needs 4.5:1 (the kit rule .btn-primary)`.
 */
export const lookSet = operation({
  label: "cli.lookSet",
  input: lookCommand.options[1],
  depends: {
    readSet,
    tellSet,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    call: kit.api["look.set"],
  },
  run: async ({ readSet, tellSet, exitOf, fault, deadline, call }, { input }) => {
    const read = await readSet.run({ input });
    if (!read.ok) return read.exit;

    const stop = deadline.run({ input: "look.set" });
    const reply = await call.settle({ input: read.input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    tellSet.run({ input: reply.value });
    return exitOf.run({ input: { address: "look.set", kind: reply.value.kind } });
  },
});

/** `easel look undo --base <rev>` (`look.undo`): one step back, as a new kit version. */
export const lookUndo = operation({
  label: "cli.lookUndo",
  input: lookCommand.options[2],
  depends: {
    say,
    usage: lookUsage,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    staleText,
    call: kit.api["look.undo"],
  },
  run: async ({ say, usage, exitOf, fault, deadline, staleText, call }, { input }) => {
    const base = numberFlag.safeParse(input.base);
    if (!base.success) {
      return usage.run({
        input: "--base takes the look's revision, 1 or more: `easel look get` prints it",
      });
    }

    const stop = deadline.run({ input: "look.undo" });
    const reply = await call.settle({ input: { base: base.data }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "updated":
        say.run({
          input: {
            json: answer,
            text: `updated: look revision ${answer.rev}, kit version ${answer.kit}`,
          },
        });
        break;
      case "stale":
        say.run({ input: { json: answer, text: staleText.run({ input: answer }), error: true } });
        break;
      case "none":
        say.run({
          input: { json: answer, text: "none: the look has no change to undo", error: true },
        });
        break;
    }

    return exitOf.run({ input: { address: "look.undo", kind: answer.kind } });
  },
});

/**
 * What `easel kit check` prints: the count on stdout, and each finding on stderr, one a line, as
 * `put` prints them (SPEC-cli.md § Learn the kit); with `--json`, the answer only.
 */
const tellCheck = operation({
  label: "cli.kitTellCheck",
  input: z.object({ file: z.string(), answer: kitCheckOutput }),
  depends: { say, stderr: stderr.required, asJson: json },
  run: ({ say, stderr, asJson }, { input: { file, answer } }) => {
    switch (answer.kind) {
      case "tooBig":
        return say.run({
          input: {
            json: answer,
            text: `the document is too big: over ${answer.maxBytes} bytes of UTF-8. Split it, or inline less`,
            error: true,
          },
        });
      case "checked": {
        const count = answer.findings.length + answer.more;
        const text = `checked: ${count} ${count === 1 ? "finding" : "findings"}, kit version ${answer.kit}`;
        say.run({ input: { json: answer, text } });
        if (asJson) return;

        for (const f of answer.findings) {
          stderr.write(`${file}:${f.line}:${f.col} ${f.rule} ${f.what}. Fix: ${f.fix}\n`);
        }
        if (answer.more > 0) stderr.write(`and ${answer.more} more\n`);
      }
    }
  },
});

/**
 * `easel kit check <file|->` (`kit.check`): the check of a put, against the current kit version,
 * and nothing written. A file whose name ends in `.tsx` goes as an app frame (`tsx`), any other,
 * or stdin, as HTML. The findings do not change the exit code (SPEC-cli.md § Learn the kit).
 */
export const kitCheck = operation({
  label: "cli.kitCheck",
  input: lookCommand.options[3],
  depends: {
    usage: lookUsage,
    readPatch,
    tellCheck,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    call: kit.api["kit.check"],
  },
  run: async ({ usage, readPatch, tellCheck, exitOf, fault, deadline, call }, { input }) => {
    const text = await readPatch.run({ input: input.file });
    if (text === null) {
      const said = input.file === "-" ? "stdin cannot be read" : `cannot read ${input.file}`;
      return usage.run({ input: said });
    }

    const sent = input.file.endsWith(".tsx") ? { tsx: text } : { html: text };
    const stop = deadline.run({ input: "kit.check" });
    const reply = await call.settle({ input: sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    tellCheck.run({ input: { file: input.file, answer: reply.value } });
    return exitOf.run({ input: { address: "kit.check", kind: reply.value.kind } });
  },
});

type Capsules = Extract<z.infer<typeof kitCapsulesOutput>, { kind: "found" }>;

const schemaShape = z
  .object({
    type: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    items: z.unknown().optional(),
    propertyNames: z.object({ pattern: z.string() }).optional(),
    additionalProperties: z.unknown().optional(),
  })
  .loose();

/**
 * A JSON Schema as a short type for a person: `"en" | "vi"`, `string`, `array`, or a map with the
 * pattern of its names. `--json` gives the whole schema.
 */
const schemaText = operation({
  label: "cli.kitSchemaText",
  input: z.unknown(),
  run: (_, { input }) => {
    const schema = schemaShape.safeParse(input);
    if (!schema.success) return "any";

    const { type, propertyNames } = schema.data;
    if (schema.data.enum) return schema.data.enum.map((one) => JSON.stringify(one)).join(" | ");
    if (type === "object" && propertyNames) return `a map of ${propertyNames.pattern} to values`;
    return type ?? "any";
  },
});

/** The text of one export: its name, kind and what it does, then its use, edges and texts. */
const exportText = operation({
  label: "cli.kitExportText",
  input: z.custom<Capsules["capsules"][number]["exports"][number]>(),
  depends: { schemaText },
  run: ({ schemaText }, { input: one }) => {
    const lines = [`  ${one.name} (${one.kind}): ${one.does}`];
    lines.push(
      ...one.use.split("\n").map((line, i) => `      ${i === 0 ? "use: " : "     "}${line}`),
    );

    if (one.depends.length > 0) {
      const edges = one.depends.map((edge) => `${edge.as} ${edge.how} ${edge.unit}`).join(", ");
      lines.push(`      depends: ${edges}`);
    }

    if (one.input !== undefined) lines.push(`      input: ${schemaText.run({ input: one.input })}`);
    for (const [key, text] of Object.entries(one.texts ?? {})) {
      lines.push(`      text ${key}: ${JSON.stringify(text)}`);
    }
    return lines.join("\n");
  },
});

/** What `easel kit capsules` prints for a person: the start, then each capsule and its exports. */
const capsulesText = operation({
  label: "cli.kitCapsulesText",
  input: z.custom<Capsules>(),
  depends: { exportText, schemaText },
  run: ({ exportText, schemaText }, { input: answer }) => {
    const start =
      answer.start.kind === "started"
        ? "they start with the look of this kit version"
        : `they do not start: ${answer.start.refused} ${JSON.stringify(answer.start.payload)}`;
    const blocks = answer.capsules.map((one) => {
      const config = one.config.map(
        (key) =>
          `  config ${key.key}${key.required ? " (required)" : ""}: ${schemaText.run({ input: key.schema })}`,
      );
      const exports = one.exports.map((row) => exportText.run({ input: row }));
      return [`${one.label}: ${one.does}`, `  install: ${one.install}`, ...config, ...exports].join(
        "\n",
      );
    });
    const head = `kit version ${answer.kit}: ${answer.capsules.length} capsules; ${start}`;
    return [head, ...blocks].join("\n\n");
  },
});

/**
 * `easel kit capsules` (`kit.capsules`): the capsules of the current kit version, each with what
 * it does, its install, its config and its exports; with `--json`, the answer only.
 */
export const kitCapsules = operation({
  label: "cli.kitCapsules",
  input: lookCommand.options[4],
  depends: {
    say,
    capsulesText,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    call: kit.api["kit.capsules"],
  },
  run: async ({ say, capsulesText, exitOf, fault, deadline, call }) => {
    const stop = deadline.run({ input: "kit.capsules" });
    const reply = await call.settle({ input: {}, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    const answer = reply.value;
    say.run({ input: { json: answer, text: capsulesText.run({ input: answer }) } });
    return exitOf.run({ input: { address: "kit.capsules", kind: answer.kind } });
  },
});

/** Runs one `easel look` command, or `easel kit check|capsules`; answers its exit code. */
export const lookRun = operation({
  label: "cli.look",
  input: lookCommand,
  depends: { lookGet, lookSet, lookUndo, kitCheck, kitCapsules },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "get":
        return ops.lookGet.run({ input });
      case "set":
        return ops.lookSet.run({ input });
      case "undo":
        return ops.lookUndo.run({ input });
      case "check":
        return ops.kitCheck.run({ input });
      case "capsules":
        return ops.kitCapsules.run({ input });
    }
  },
});
