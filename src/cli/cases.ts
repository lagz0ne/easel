import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "@/access/contract";
import { frames } from "@/frames";
import { caseList, caseField } from "@/frames/cases";
import { canvasKey, frameId, framesContracts, framesSuccessKinds } from "@/frames/contract";

import { callDeadline, exits } from "./exit";
import { framesFault, layoutFindings, usage } from "./frames";
import { jsonOf, readPatch } from "./look";
import { say } from "./output";

export const casesCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ls"), canvas: z.string(), frame: z.string() }),
  z.object({
    kind: z.literal("set"),
    canvas: z.string(),
    frame: z.string(),
    file: z.string(),
    base: z.string().optional(),
  }),
]);

export type CasesCommand = z.infer<typeof casesCommand>;

const address = z.enum(["cases.list", "cases.set"]);

const casesBase = z.string().regex(/^\d+$/).transform(Number);

const casesDeadline = operation({
  label: "cli.casesDeadline",
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

const casesExitOf = operation({
  label: "cli.casesExitOf",
  input: z.object({ address, kind: z.string() }),
  run: (_, { input }) => {
    const list: readonly string[] = framesSuccessKinds[input.address];
    return list.includes(input.kind) ? exits.ok : exits.no;
  },
});

const casesTarget = operation({
  label: "cli.casesTarget",
  input: z.object({ canvas: z.string(), frame: z.string() }),
  run: (_, { input }) => {
    const canvas = canvasKey.safeParse(input.canvas);
    if (!canvas.success) {
      const text = `not a canvas key: ${input.canvas}. Use 1 to 40 of a-z, 0-9 and -: \`easel canvas ls\` lists the keys`;
      return { ok: false as const, text };
    }
    const frame = frameId.safeParse(input.frame);
    if (!frame.success) {
      const text = `not a frame id: ${input.frame}. Use 12 of 0-9 and a-f: \`easel ls ${canvas.data}\` lists the ids`;
      return { ok: false as const, text };
    }

    return { ok: true as const, target: { canvas: canvas.data, frame: frame.data } };
  },
});

const listOutput = framesContracts["cases.list"].output;

const casesTell = operation({
  label: "cli.casesTell",
  input: z.object({ canvas: z.string(), frame: z.string(), answer: listOutput }),
  run: (_, { input: { canvas, frame, answer } }) => {
    switch (answer.kind) {
      case "found": {
        const cases = answer.cases.map((one) => {
          const switches = Object.entries(one.switches ?? {}).map(
            ([key, value]) => `${key}=${value}`,
          );
          const tail = switches.length === 0 ? "" : `  switches ${switches.join(", ")}`;
          return `case ${one.name}  fixture ${one.fixture ?? "none"}${tail}`;
        });

        const caseFrames = answer.frames.map((one) => `frame ${one.name}  ${one.id}`);
        const none =
          cases.length === 0
            ? [`no cases: write them with \`easel cases set ${canvas} ${frame} <file.json>\``]
            : [];

        const section = answer.section === null ? "no section" : `section ${answer.section}`;
        const text = [...cases, ...caseFrames, ...none, `cases revision ${answer.rev}, ${section}`];
        return { text: text.join("\n"), error: false };
      }
      case "gone":
        return {
          text: `gone: no frame ${frame} on the canvas ${canvas}. Find the id with \`easel ls ${canvas}\``,
          error: true,
        };
      case "CaseFrame":
        return {
          text: `CaseFrame: ${frame} shows a case of the frame ${answer.source}. List the cases of that frame with \`easel cases ls ${canvas} ${answer.source}\``,
          error: true,
        };
    }
  },
});

export const casesLs = operation({
  label: "cli.casesLs",
  input: casesCommand.options[0],
  depends: {
    say,
    usage,
    casesTarget,
    casesTell,
    exitOf: casesExitOf,
    fault: framesFault,
    deadline: casesDeadline,
    call: frames.api["cases.list"],
  },
  run: async (units, { input }) => {
    const { say, usage, casesTarget, casesTell, exitOf, fault, deadline, call } = units;
    const target = casesTarget.run({ input });
    if (!target.ok) return usage.run({ input: target.text });

    const stop = deadline.run({ input: "cases.list" });
    const reply = await call.settle({ input: target.target, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    const answer = reply.value;
    const told = casesTell.run({ input: { ...target.target, answer } });
    say.run({ input: { json: answer, ...told } });
    return exitOf.run({ input: { address: "cases.list", kind: answer.kind } });
  },
});

const readSet = operation({
  label: "cli.casesReadSet",
  input: casesCommand.options[1],
  depends: { casesTarget, readPatch },
  run: async ({ casesTarget, readPatch }, { input }) => {
    const base = casesBase.optional().safeParse(input.base);
    if (!base.success) {
      const text = `--base takes the revision of the cases, 0 or more: \`easel cases ls ${input.canvas} ${input.frame}\` prints it`;
      return { ok: false as const, text };
    }
    const target = casesTarget.run({ input });
    if (!target.ok) return target;

    const text = await readPatch.run({ input: input.file });
    const json = jsonOf.safeParse(text ?? "");
    if (text === null || !json.success) {
      return { ok: false as const, text: `${input.file} is not JSON` };
    }

    const cases = caseList.safeParse(json.data);
    if (!cases.success) {
      const why = cases.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      const shape = 'each case is {"name": "few", "fixture": "few", "switches": {"theme": "dark"}}';
      return {
        ok: false as const,
        text: `${input.file} is not a list of cases: ${why.join("; ")}. Write a JSON list; ${shape}`,
      };
    }

    const sent = { ...target.target, cases: cases.data };
    return {
      ok: true as const,
      input: base.data === undefined ? sent : { ...sent, base: base.data },
    };
  },
});

const setOutput = framesContracts["cases.set"].output;

const invalidFix = operation({
  label: "cli.casesInvalidFix",
  input: caseField,
  run: (_, { input: field }) => {
    switch (field) {
      case "name":
        return "Give each case its own name, then set the cases again";
      case "fixture":
        return "Use a fixture that `easel fixtures ls` lists, then set the cases again";
    }
  },
});

const casesTellSet = operation({
  label: "cli.casesTellSet",
  input: z.object({ canvas: z.string(), frame: z.string(), answer: setOutput }),
  depends: { invalidFix },
  run: ({ invalidFix }, { input: { canvas, frame, answer } }) => {
    switch (answer.kind) {
      case "set": {
        const caseFrames = answer.frames.map((one) => `frame ${one.name}  ${one.id}`);
        return {
          text: [`set: cases revision ${answer.rev}`, ...caseFrames].join("\n"),
          error: false,
        };
      }
      case "changed":
        return {
          text: `changed: the cases are at revision ${answer.rev} now, and nothing was written. Read them again with \`easel cases ls ${canvas} ${frame}\`, then set them with --base ${answer.rev}`,
          error: true,
        };
      case "gone":
        return {
          text: `gone: no frame ${frame} on the canvas ${canvas}, and nothing was written. Find the id with \`easel ls ${canvas}\``,
          error: true,
        };
      case "CaseInvalid":
        return {
          text: `CaseInvalid: the case ${answer.case} has a bad ${answer.field} (${answer.reason}), and nothing was written. ${invalidFix.run({ input: answer.field })}`,
          error: true,
        };
      case "CasesTooMany":
        return {
          text: `CasesTooMany: the list has ${answer.cases} cases, and a frame has ${answer.max} at most, so nothing was written. Remove cases from the file, then set them again`,
          error: true,
        };
      case "CaseFrame":
        return {
          text: `CaseFrame: nothing was written; ${frame} shows a case of the frame ${answer.source}. Set the cases of that frame with \`easel cases set ${canvas} ${answer.source} <file.json>\``,
          error: true,
        };
    }
  },
});

export const casesSet = operation({
  label: "cli.casesSet",
  input: casesCommand.options[1],
  depends: {
    say,
    usage,
    readSet,
    casesTellSet,
    layoutFindings,
    exitOf: casesExitOf,
    fault: framesFault,
    deadline: casesDeadline,
    call: frames.api["cases.set"],
  },
  run: async (units, { input }) => {
    const { say, usage, readSet, casesTellSet, layoutFindings, exitOf, fault, deadline, call } =
      units;
    const read = await readSet.run({ input });
    if (!read.ok) return usage.run({ input: read.text });

    const stop = deadline.run({ input: "cases.set" });
    const reply = await call.settle({ input: read.input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    const answer = reply.value;
    const target = { canvas: read.input.canvas, frame: read.input.frame };
    say.run({ input: { json: answer, ...casesTellSet.run({ input: { ...target, answer } }) } });
    if (answer.kind === "set") layoutFindings.run({ input: answer.layout });
    return exitOf.run({ input: { address: "cases.set", kind: answer.kind } });
  },
});

export const casesRun = operation({
  label: "cli.cases",
  input: casesCommand,
  depends: { casesLs, casesSet },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "ls":
        return ops.casesLs.run({ input });
      case "set":
        return ops.casesSet.run({ input });
    }
  },
});
