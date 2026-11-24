import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "@/access/contract";
import { canvasKey } from "@/frames/contract";
import { kit } from "@/kit";
import { textsListOutput, textsSetOutput } from "@/kit/contract";
import { textKey, textsPatch } from "@/kit/texts";
import { words } from "@/words";
import { type TextUse, textsUsesOutput } from "@/words/contract";

import { callDeadline, exits, faultExit } from "./exit";
import {
  jsonOf,
  lookDeadline,
  lookExitOf,
  lookFault,
  lookUsage,
  numberFlag,
  readPatch,
} from "./look";
import { say } from "./output";

export const textsCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ls") }),
  z.object({
    kind: z.literal("set"),
    key: z.string(),
    text: z.string(),
    locale: z.string().optional(),
    base: z.string().optional(),
  }),
  z.object({ kind: z.literal("setFile"), file: z.string().min(1), base: z.string().optional() }),
  z.object({ kind: z.literal("uses"), canvas: z.string().optional() }),
]);

export type TextsCommand = z.infer<typeof textsCommand>;

const baseUsage = "--base takes the revision of the texts, 1 or more: `easel texts ls` prints it";

const locale = z.enum(["en", "vi"]);

const textsTell = operation({
  label: "cli.textsTell",
  input: textsListOutput,
  run: (_, { input: answer }) => {
    const lines = Object.entries(answer.texts).map(([key, text]) => {
      const vi = text.vi === undefined ? "" : `  vi: ${JSON.stringify(text.vi)}`;
      return `${key}  en: ${JSON.stringify(text.en)}${vi}`;
    });
    const noVi =
      answer.noVi.length === 0
        ? "each text key has a vi text"
        : `no vi text: ${answer.noVi.join(", ")}`;
    const tail = `texts revision ${answer.rev}, kit version ${answer.kit}`;
    return [...lines, noVi, tail].join("\n");
  },
});

export const textsLs = operation({
  label: "cli.textsLs",
  input: textsCommand.options[0],
  depends: {
    say,
    textsTell,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    call: kit.api["texts.list"],
  },
  run: async ({ say, textsTell, exitOf, fault, deadline, call }) => {
    const stop = deadline.run({ input: "texts.list" });
    const reply = await call.settle({ input: {}, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    const answer = reply.value;
    say.run({ input: { json: answer, text: textsTell.run({ input: answer }) } });
    return exitOf.run({ input: { address: "texts.list", kind: answer.kind } });
  },
});

const textsInvalid = operation({
  label: "cli.textsInvalid",
  input: z.object({ head: z.string(), issues: z.array(z.custom<z.core.$ZodIssue>()) }),
  depends: { say },
  run: ({ say }, { input: { head, issues } }) => {
    const shown = issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const told = shown.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
    say.run({ input: { json: { invalid: shown }, text: `${head}: ${told}`, error: true } });
    return exits.invalid;
  },
});

const readOne = operation({
  label: "cli.textsReadOne",
  input: textsCommand.options[1],
  depends: { usage: lookUsage, invalid: textsInvalid },
  run: ({ usage, invalid }, { input }) => {
    const at = locale.safeParse(input.locale ?? "en");
    if (!at.success) {
      return { ok: false as const, exit: usage.run({ input: "--locale takes en or vi" }) };
    }

    const key = textKey.safeParse(input.key);
    if (!key.success) {
      const head = `not a text key: ${input.key}`;
      return {
        ok: false as const,
        exit: invalid.run({ input: { head, issues: key.error.issues } }),
      };
    }

    const text = at.data === "en" ? { en: input.text } : { vi: input.text };
    return { ok: true as const, texts: { [key.data]: text } };
  },
});

const readFile = operation({
  label: "cli.textsReadFile",
  input: textsCommand.options[2],
  depends: { usage: lookUsage, invalid: textsInvalid, readPatch },
  run: async ({ usage, invalid, readPatch }, { input }) => {
    const text = await readPatch.run({ input: input.file });
    if (text === null) {
      return { ok: false as const, exit: usage.run({ input: `cannot read ${input.file}` }) };
    }
    const json = jsonOf.safeParse(text);
    if (!json.success) {
      return { ok: false as const, exit: usage.run({ input: `${input.file} is not JSON` }) };
    }

    const texts = textsPatch.safeParse(json.data);
    if (texts.success) return { ok: true as const, texts: texts.data };

    const head = `not texts by text key, as { "trial.start": { "en": "Start" } }`;
    return {
      ok: false as const,
      exit: invalid.run({ input: { head, issues: texts.error.issues } }),
    };
  },
});

const readSet = operation({
  label: "cli.textsReadSet",
  input: z.union([textsCommand.options[1], textsCommand.options[2]]),
  depends: { usage: lookUsage, readOne, readFile },
  run: async ({ usage, readOne, readFile }, { input }) => {
    const base = numberFlag.optional().safeParse(input.base);
    if (!base.success) return { ok: false as const, exit: usage.run({ input: baseUsage }) };

    const read = input.kind === "set" ? readOne.run({ input }) : await readFile.run({ input });
    if (!read.ok) return read;

    return { ok: true as const, input: { texts: read.texts, base: base.data } };
  },
});

const textsTellSet = operation({
  label: "cli.textsTellSet",
  input: textsSetOutput,
  depends: { say },
  run: ({ say }, { input: answer }) => {
    switch (answer.kind) {
      case "updated":
      case "unchanged": {
        const text = `${answer.kind}: texts revision ${answer.rev}, kit version ${answer.kit}`;
        return say.run({ input: { json: answer, text } });
      }
      case "stale": {
        const text = `stale: the texts are at revision ${answer.rev} (kit version ${answer.kit}): get them again with \`easel texts ls\`, and make the change on them`;
        return say.run({ input: { json: answer, text, error: true } });
      }
      case "invalid": {
        const lines = answer.findings.map((f) => `${f.key}: ${f.what}. Fix: ${f.fix}`);
        const head = "invalid: nothing is saved";
        return say.run({ input: { json: answer, text: [head, ...lines].join("\n"), error: true } });
      }
      case "tooBig": {
        const text = `tooBig: the texts of the team would be over ${answer.maxBytes} bytes; nothing is saved`;
        return say.run({ input: { json: answer, text, error: true } });
      }
    }
  },
});

export const textsSet = operation({
  label: "cli.textsSet",
  input: z.union([textsCommand.options[1], textsCommand.options[2]]),
  depends: {
    readSet,
    tellSet: textsTellSet,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    call: kit.api["texts.set"],
  },
  run: async ({ readSet, tellSet, exitOf, fault, deadline, call }, { input }) => {
    const read = await readSet.run({ input });
    if (!read.ok) return read.exit;

    const stop = deadline.run({ input: "texts.set" });
    const reply = await call.settle({ input: read.input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    tellSet.run({ input: reply.value });
    return exitOf.run({ input: { address: "texts.set", kind: reply.value.kind } });
  },
});

const usesLine = z
  .array(z.custom<TextUse>())
  .transform((uses) =>
    uses.length === 0
      ? "not used"
      : `used in ${uses.map((u) => `${u.canvas}/${u.id} "${u.name}"`).join(", ")}`,
  );

const usesTell = operation({
  label: "cli.textsUsesTell",
  input: textsUsesOutput,
  run: (_, { input: answer }) => {
    const lines = answer.texts.map((text) => {
      const vi =
        text.vi === undefined ? "  vi: not translated" : `  vi: ${JSON.stringify(text.vi)}`;
      return `${text.key}  en: ${JSON.stringify(text.en)}${vi}\n  ${usesLine.parse(text.uses)}`;
    });
    const unknown = answer.unknown.map(
      (one) => `${one.key}  not in the texts of the team\n  ${usesLine.parse(one.uses)}`,
    );

    const missing =
      answer.missing.vi.length === 0
        ? "vi: each text of the team has a vi text"
        : `vi: ${answer.missing.vi.length} not translated: ${answer.missing.vi.join(", ")}`;
    const own = `${answer.own.length} texts with no key (no translation): --json lists each, with its uses`;
    const read = `${answer.frames} frames read, ${answer.pictures} of them images (easel cannot read their words)`;
    const tail = `texts revision ${answer.rev}, kit version ${answer.kit}`;
    return [...lines, ...unknown, missing, own, read, tail].join("\n");
  },
});

const usesFault = operation({
  label: "cli.textsUsesFault",
  input: z.unknown(),
  depends: { faultExit },
  run: ({ faultExit }, { input: error }) => {
    const known = words.api.fault.is(error)
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

export const textsUsesCli = operation({
  label: "cli.textsUses",
  input: textsCommand.options[3],
  depends: { say, usesTell, usage: lookUsage, fault: usesFault, call: words.api["texts.uses"] },
  run: async ({ say, usesTell, usage, fault, call }, { input, clock, signal }) => {
    const canvas = canvasKey.optional().safeParse(input.canvas);
    if (!canvas.success) return usage.run({ input: "--canvas takes a canvas key" });

    const stop = new AbortController();
    const late = loginApi.fault.make("texts.uses", "link", { late: callDeadline }, undefined);
    clock.sleep(callDeadline, AbortSignal.any([signal, stop.signal])).then(
      () => stop.abort(late),
      () => undefined,
    );
    const ask = canvas.data === undefined ? {} : { canvas: canvas.data };
    const reply = await call.settle({ input: ask, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    say.run({ input: { json: reply.value, text: usesTell.run({ input: reply.value }) } });
    return exits.ok;
  },
});

export const textsRun = operation({
  label: "cli.texts",
  input: textsCommand,
  depends: { textsLs, textsSet, textsUsesCli },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "ls":
        return ops.textsLs.run({ input });
      case "uses":
        return ops.textsUsesCli.run({ input });
      case "set":
      case "setFile":
        return ops.textsSet.run({ input });
    }
  },
});
