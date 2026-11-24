import { operation } from "@tinkered/core";
import { z } from "zod";

import { kit } from "@/kit";
import { fixturesListOutput, fixturesSetOutput } from "@/kit/contract";
import { cellLabel, fixtureName } from "@/kit/fixtures";

import { exits } from "./exit";
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

export const fixturesCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("get"), cell: z.string(), name: z.string().optional() }),
  z.object({
    kind: z.literal("set"),
    cell: z.string(),
    name: z.string(),
    file: z.string(),
    base: z.string().optional(),
  }),
]);

export type FixturesCommand = z.infer<typeof fixturesCommand>;

const baseUsage =
  "--base takes the revision of the fixtures, 1 or more: `easel fixtures ls` prints it";

const fixturesTell = operation({
  label: "cli.fixturesTell",
  input: fixturesListOutput,
  run: (_, { input: answer }) => {
    const lines = answer.cells.map((cell) => `${cell.label}  ${cell.names.join(", ")}`);
    const none = lines.length === 0 ? ["no fixtures: `easel fixtures set` writes one"] : [];
    const tail = `fixtures revision ${answer.rev}, kit version ${answer.kit}`;
    return [...lines, ...none, tail].join("\n");
  },
});

const fixturesRead = operation({
  label: "cli.fixturesRead",
  depends: { fault: lookFault, deadline: lookDeadline, call: kit.api["fixtures.list"] },
  run: async ({ fault, deadline, call }) => {
    const stop = deadline.run({ input: "fixtures.list" });
    const reply = await call.settle({ input: {}, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") {
      return { ok: false as const, exit: fault.run({ input: reply.reason }) };
    }
    if (reply.status === "failed") {
      return { ok: false as const, exit: fault.run({ input: reply.error }) };
    }

    return { ok: true as const, answer: reply.value };
  },
});

export const fixturesLs = operation({
  label: "cli.fixturesLs",
  depends: { say, fixturesTell, fixturesRead, exitOf: lookExitOf },
  run: async ({ say, fixturesTell, fixturesRead, exitOf }) => {
    const read = await fixturesRead.run();
    if (!read.ok) return read.exit;

    const { answer } = read;
    say.run({ input: { json: answer, text: fixturesTell.run({ input: answer }) } });
    return exitOf.run({ input: { address: "fixtures.list", kind: answer.kind } });
  },
});

export const fixturesGet = operation({
  label: "cli.fixturesGet",
  input: fixturesCommand.options[1],
  depends: { say, fixturesRead },
  run: async ({ say, fixturesRead }, { input }) => {
    const read = await fixturesRead.run();
    if (!read.ok) return read.exit;

    const named = read.answer.fixtures[input.cell] ?? {};
    const shown = input.name === undefined ? named : named[input.name];
    if (shown === undefined) {
      const text = `no fixture ${input.name ?? ""} of the cell ${input.cell}: \`easel fixtures ls\` lists them`;
      say.run({ input: { json: { missing: input }, text, error: true } });
      return exits.no;
    }

    say.run({ input: { json: shown, text: JSON.stringify(shown, null, 2) } });
    return exits.ok;
  },
});

const readSet = operation({
  label: "cli.fixturesReadSet",
  input: fixturesCommand.options[2],
  depends: { usage: lookUsage, readPatch },
  run: async ({ usage, readPatch }, { input }) => {
    const base = numberFlag.optional().safeParse(input.base);
    if (!base.success) return { ok: false as const, exit: usage.run({ input: baseUsage }) };

    const [cell, name] = [cellLabel.safeParse(input.cell), fixtureName.safeParse(input.name)];
    if (!cell.success) {
      const text = `not the label of a cell: ${input.cell}`;
      return { ok: false as const, exit: usage.run({ input: text }) };
    }
    if (!name.success) {
      const text = `a fixture name is lower case, as empty, one, many or error: ${input.name}`;
      return { ok: false as const, exit: usage.run({ input: text }) };
    }

    const text = await readPatch.run({ input: input.file });
    const json = jsonOf.safeParse(text ?? "");
    if (text === null || !json.success) {
      return { ok: false as const, exit: usage.run({ input: `${input.file} is not JSON` }) };
    }

    const fixtures = { [name.data]: json.data };
    return { ok: true as const, input: { cell: cell.data, fixtures, base: base.data } };
  },
});

const fixturesTellSet = operation({
  label: "cli.fixturesTellSet",
  input: fixturesSetOutput,
  depends: { say },
  run: ({ say }, { input: answer }) => {
    switch (answer.kind) {
      case "updated":
      case "unchanged": {
        const text = `${answer.kind}: fixtures revision ${answer.rev}, kit version ${answer.kit}`;
        return say.run({ input: { json: answer, text } });
      }
      case "stale": {
        const text = `stale: the fixtures are at revision ${answer.rev} (kit version ${answer.kit}): read them again with \`easel fixtures ls\`, and make the change on them`;
        return say.run({ input: { json: answer, text, error: true } });
      }
      case "tooBig": {
        const text = `tooBig: the fixtures would be over ${answer.maxBytes} bytes; nothing is saved`;
        return say.run({ input: { json: answer, text, error: true } });
      }
    }
  },
});

export const fixturesSet = operation({
  label: "cli.fixturesSet",
  input: fixturesCommand.options[2],
  depends: {
    readSet,
    tellSet: fixturesTellSet,
    exitOf: lookExitOf,
    fault: lookFault,
    deadline: lookDeadline,
    call: kit.api["fixtures.set"],
  },
  run: async ({ readSet, tellSet, exitOf, fault, deadline, call }, { input }) => {
    const read = await readSet.run({ input });
    if (!read.ok) return read.exit;

    const stop = deadline.run({ input: "fixtures.set" });
    const reply = await call.settle({ input: read.input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    tellSet.run({ input: reply.value });
    return exitOf.run({ input: { address: "fixtures.set", kind: reply.value.kind } });
  },
});

export const fixturesRun = operation({
  label: "cli.fixtures",
  input: fixturesCommand,
  depends: { fixturesLs, fixturesGet, fixturesSet },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "ls":
        return ops.fixturesLs.run();
      case "get":
        return ops.fixturesGet.run({ input });
      case "set":
        return ops.fixturesSet.run({ input });
    }
  },
});
