import { writeFileSync } from "node:fs";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "@/access/contract";
import { parts } from "@/parts";
import { partsContracts, type PartsAddress } from "@/parts/contract";

import { callDeadline, exits, faultExit } from "./exit";
import { say } from "./output";

export const partsCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("publish"), canvas: z.string() }),
  z.object({
    kind: z.literal("show"),
    canvas: z.string(),
    id: z.string(),
    out: z.string().optional(),
  }),
]);

export type PartsCommand = z.infer<typeof partsCommand>;

const listOutput = partsContracts["parts.list"].output;
const publishOutput = partsContracts["parts.publish"].output;
const showOutput = partsContracts["parts.show"].output;

const partsDeadline = operation({
  label: "cli.partsDeadline",
  input: z.custom<PartsAddress>(),
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

const partsFault = operation({
  label: "cli.partsFault",
  input: z.unknown(),
  depends: { faultExit },
  run: ({ faultExit }, { input: error }) => {
    const known = parts.api.fault.is(error)
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

const copiesLine = z
  .array(z.object({ canvas: z.string(), id: z.string(), linked: z.number(), edited: z.number() }))
  .transform((copies) =>
    copies.length === 0
      ? "no copy"
      : copies
          .map(
            (c) =>
              `${c.canvas}/${c.id} ${c.linked} linked${c.edited ? `, ${c.edited} edited` : ""}`,
          )
          .join("; "),
  );

const listTell = operation({
  label: "cli.partsListTell",
  input: listOutput,
  run: (_, { input: answer }) => {
    const lines = answer.parts.map(
      (p) =>
        `${p.id}  ${p.name}  rev ${p.rev}  main ${p.source.canvas}/${p.source.frame} v${p.source.version}\n  ${copiesLine.parse(p.copies)}`,
    );
    const none =
      answer.parts.length === 0 ? ["no part: easel parts publish <canvas> makes them"] : [];
    const tail = `design revision ${answer.rev}, kit version ${answer.kit}`;
    return [...lines, ...none, tail].join("\n");
  },
});

const partsLs = operation({
  label: "cli.partsLs",
  depends: {
    say,
    listTell,
    fault: partsFault,
    deadline: partsDeadline,
    call: parts.api["parts.list"],
  },
  run: async ({ say, listTell, fault, deadline, call }) => {
    const stop = deadline.run({ input: "parts.list" });
    const reply = await call.settle({ input: {}, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    say.run({ input: { json: reply.value, text: listTell.run({ input: reply.value }) } });
    return exits.ok;
  },
});

const publishTell = operation({
  label: "cli.partsPublishTell",
  input: z.object({ canvas: z.string(), answer: publishOutput }),
  run: (_, { input: { canvas, answer } }) => {
    switch (answer.kind) {
      case "updated":
      case "unchanged": {
        const names = answer.parts.map((p) => `${p.name} rev ${p.rev}`).join(", ");
        const text = `${answer.kind}: ${names || "no main on this canvas"}; design revision ${answer.rev}, kit version ${answer.kit}`;
        return { json: answer, text };
      }
      case "gone":
        return { json: answer, text: `no canvas ${canvas}`, error: true };
    }
  },
});

const partsPublish = operation({
  label: "cli.partsPublish",
  input: partsCommand.options[1],
  depends: {
    say,
    publishTell,
    fault: partsFault,
    deadline: partsDeadline,
    call: parts.api["parts.publish"],
  },
  run: async ({ say, publishTell, fault, deadline, call }, { input }) => {
    const stop = deadline.run({ input: "parts.publish" });
    const reply = await call.settle({ input: { canvas: input.canvas }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    say.run({ input: publishTell.run({ input: { canvas: input.canvas, answer: reply.value } }) });
    return reply.value.kind === "gone" ? exits.no : exits.ok;
  },
});

const showTell = operation({
  label: "cli.partsShowTell",
  input: z.object({ at: partsCommand.options[2], answer: showOutput }),
  run: (_, { input: { at, answer } }) => {
    switch (answer.kind) {
      case "found": {
        if (at.out === undefined) return { json: answer, text: answer.html };

        writeFileSync(at.out, answer.html);
        const { html, ...rest } = answer;
        const text = `${at.id} v${answer.version} with the parts of kit version ${answer.kit} written to ${at.out}`;
        return { json: { ...rest, bytes: html.length, file: at.out }, text };
      }
      case "gone":
        return { json: answer, text: `no frame ${at.id} on ${at.canvas}`, error: true };
    }
  },
});

const partsShow = operation({
  label: "cli.partsShow",
  input: partsCommand.options[2],
  depends: {
    say,
    showTell,
    fault: partsFault,
    deadline: partsDeadline,
    call: parts.api["parts.show"],
  },
  run: async ({ say, showTell, fault, deadline, call }, { input }) => {
    const stop = deadline.run({ input: "parts.show" });
    const ask = { canvas: input.canvas, id: input.id };
    const reply = await call.settle({ input: ask, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return fault.run({ input: reply.reason });
    if (reply.status === "failed") return fault.run({ input: reply.error });

    say.run({ input: showTell.run({ input: { at: input, answer: reply.value } }) });
    return reply.value.kind === "gone" ? exits.no : exits.ok;
  },
});

export const partsRun = operation({
  label: "cli.parts",
  input: partsCommand,
  depends: { partsLs, partsPublish, partsShow },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "ls":
        return ops.partsLs.run();
      case "publish":
        return ops.partsPublish.run({ input });
      case "show":
        return ops.partsShow.run({ input });
    }
  },
});
