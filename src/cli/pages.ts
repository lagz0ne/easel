import { operation } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { canvasKey, frameId, framesContracts, pageKey, pageName } from "@/frames/contract";

import { exits } from "./exit";
import { atFlag, badAt, framesDeadline, framesExitOf, framesFault, usage } from "./frames";
import { say } from "./output";

export const pagesCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("move"),
    canvas: canvasKey,
    id: frameId,
    at: z.string(),
    page: pageKey.optional(),
  }),
  z.object({ kind: z.literal("pages"), canvas: canvasKey }),
  z.object({ kind: z.literal("page new"), canvas: canvasKey, name: z.string() }),
  z.object({ kind: z.literal("page rename"), canvas: canvasKey, page: pageKey, name: z.string() }),
  z.object({ kind: z.literal("page rm"), canvas: canvasKey, page: pageKey }),
  z.object({ kind: z.literal("page order"), canvas: canvasKey, pages: z.array(pageKey).min(1) }),
]);

export type PagesCommand = z.infer<typeof pagesCommand>;

const told = z.object({ text: z.string(), error: z.boolean().optional() });

const named = operation({
  label: "cli.pageNamed",
  input: z.string(),
  depends: { say },
  run: ({ say }, { input }) => {
    const read = pageName.safeParse(input);
    if (read.success) return { name: read.data, exit: null };

    const why = read.error.issues.map((issue) => issue.message);
    const text = `not a page name: ${why.join("; ")}`;
    say.run({ input: { json: { invalid: { name: why } }, text, error: true } });
    return { name: null, exit: exits.invalid };
  },
});

const moveText = operation({
  label: "cli.moveText",
  input: z.object({
    command: pagesCommand.options[0],
    kind: z.enum(["moved", "unchanged", "gone"]),
  }),
  run: (_, { input: { command, kind } }) => {
    const { canvas, id, at, page } = command;
    const where = page === undefined ? at : `${at} on ${page}`;
    switch (kind) {
      case "moved":
        return { text: `moved ${id} to ${where}` };
      case "unchanged":
        return { text: `${id} is at ${where} already` };
      case "gone":
        return {
          text: `no frame ${id} on ${canvas}${page === undefined ? "" : `, or no page ${page}`}: \`easel ls ${canvas}\` and \`easel pages ${canvas}\` list them`,
          error: true,
        };
    }
  },
});

const move = operation({
  label: "cli.move",
  input: pagesCommand.options[0],
  depends: {
    say,
    usage,
    moveText,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["frame.move"],
  },
  run: async ({ say, usage, moveText, exitOf, framesFault, deadline, call }, { input }) => {
    const at = atFlag.safeParse(input.at);
    if (!at.success) return usage.run({ input: badAt });

    const stop = deadline.run({ input: "frame.move" });
    const sent = { canvas: input.canvas, id: input.id, ...at.data, page: input.page };
    const reply = await call.settle({ input: sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    say.run({
      input: { json: answer, ...moveText.run({ input: { command: input, kind: answer.kind } }) },
    });
    return exitOf.run({ input: { address: "frame.move", kind: answer.kind } });
  },
});

const pagesLs = operation({
  label: "cli.pagesLs",
  input: pagesCommand.options[1],
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["page.list"],
  },
  run: async ({ say, exitOf, framesFault, deadline, call }, { input }) => {
    const stop = deadline.run({ input: "page.list" });
    const reply = await call.settle({ input: { canvas: input.canvas }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "found": {
        const lines = answer.pages.map(
          (p) => `${p.key}\t${p.name}\t${p.frames} frame${p.frames === 1 ? "" : "s"}`,
        );
        say.run({ input: { json: answer, text: lines.join("\n") } });
        break;
      }
      case "gone":
        say.run({ input: { json: answer, text: `no canvas ${input.canvas}`, error: true } });
        break;
    }
    return exitOf.run({ input: { address: "page.list", kind: answer.kind } });
  },
});

const newText = operation({
  label: "cli.pageNewText",
  input: z.object({
    canvas: z.string(),
    answer: framesContracts["page.create"].output,
  }),
  run: (_, { input: { canvas, answer } }): z.infer<typeof told> => {
    switch (answer.kind) {
      case "created":
        return { text: answer.key };
      case "taken":
        return {
          text: `a page of ${canvas} has that name or key: pick another name (\`easel pages ${canvas}\`)`,
          error: true,
        };
      case "full":
        return {
          text: `${canvas} has 50 pages, the most it can have: put the frame on a page that is there`,
          error: true,
        };
      case "gone":
        return { text: `no canvas ${canvas}`, error: true };
    }
  },
});

const pageNew = operation({
  label: "cli.pageNew",
  input: pagesCommand.options[2],
  depends: {
    say,
    named,
    newText,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["page.create"],
  },
  run: async (units, { input }) => {
    const { say, named, newText, exitOf, framesFault, deadline, call } = units;
    const { name, exit } = named.run({ input: input.name });
    if (name === null) return exit;

    const stop = deadline.run({ input: "page.create" });
    const reply = await call.settle({ input: { canvas: input.canvas, name }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    say.run({
      input: { json: answer, ...newText.run({ input: { canvas: input.canvas, answer } }) },
    });
    return exitOf.run({ input: { address: "page.create", kind: answer.kind } });
  },
});

const renameText = operation({
  label: "cli.pageRenameText",
  input: z.object({
    command: pagesCommand.options[3],
    answer: framesContracts["page.rename"].output,
  }),
  run: (_, { input: { command, answer } }): z.infer<typeof told> => {
    const { canvas, page } = command;
    switch (answer.kind) {
      case "renamed":
        return { text: `renamed ${page}; its key stays ${page}` };
      case "taken":
        return {
          text: `another page of ${canvas} has that name: pick another name (\`easel pages ${canvas}\`)`,
          error: true,
        };
      case "gone":
        return { text: `no page ${page} on ${canvas}: \`easel pages ${canvas}\``, error: true };
    }
  },
});

const pageRename = operation({
  label: "cli.pageRename",
  input: pagesCommand.options[3],
  depends: {
    say,
    named,
    renameText,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["page.rename"],
  },
  run: async (units, { input }) => {
    const { say, named, renameText, exitOf, framesFault, deadline, call } = units;
    const { name, exit } = named.run({ input: input.name });
    if (name === null) return exit;

    const stop = deadline.run({ input: "page.rename" });
    const sent = { canvas: input.canvas, page: input.page, name };
    const reply = await call.settle({ input: sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    say.run({ input: { json: answer, ...renameText.run({ input: { command: input, answer } }) } });
    return exitOf.run({ input: { address: "page.rename", kind: answer.kind } });
  },
});

const rmText = operation({
  label: "cli.pageRmText",
  input: z.object({
    command: pagesCommand.options[4],
    answer: framesContracts["page.delete"].output,
  }),
  run: (_, { input: { command, answer } }): z.infer<typeof told> => {
    const { canvas, page } = command;
    switch (answer.kind) {
      case "deleted":
        return { text: `deleted page ${page}` };
      case "notEmpty":
        return {
          text: `page ${page} has ${answer.frames} frame${answer.frames === 1 ? "" : "s"}: move each to another page first (\`easel move ${canvas} <id> --at <x>,<y> --page <page>\`)`,
          error: true,
        };
      case "last":
        return {
          text: `${page} is the last page of ${canvas}: a canvas has one page at least`,
          error: true,
        };
      case "gone":
        return { text: `no page ${page} on ${canvas}: \`easel pages ${canvas}\``, error: true };
    }
  },
});

const pageRm = operation({
  label: "cli.pageRm",
  input: pagesCommand.options[4],
  depends: {
    say,
    rmText,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["page.delete"],
  },
  run: async ({ say, rmText, exitOf, framesFault, deadline, call }, { input }) => {
    const stop = deadline.run({ input: "page.delete" });
    const sent = { canvas: input.canvas, page: input.page };
    const reply = await call.settle({ input: sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    say.run({ input: { json: answer, ...rmText.run({ input: { command: input, answer } }) } });
    return exitOf.run({ input: { address: "page.delete", kind: answer.kind } });
  },
});

const pageOrder = operation({
  label: "cli.pageOrder",
  input: pagesCommand.options[5],
  depends: {
    say,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["page.order"],
  },
  run: async ({ say, exitOf, framesFault, deadline, call }, { input }) => {
    const stop = deadline.run({ input: "page.order" });
    const sent = { canvas: input.canvas, pages: input.pages };
    const reply = await call.settle({ input: sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "ordered":
        say.run({ input: { json: answer, text: `ordered the pages of ${input.canvas}` } });
        break;
      case "gone":
        say.run({
          input: {
            json: answer,
            text: `no canvas ${input.canvas}, or a page that it does not have: \`easel pages ${input.canvas}\``,
            error: true,
          },
        });
        break;
    }
    return exitOf.run({ input: { address: "page.order", kind: answer.kind } });
  },
});

export const pagesRun = operation({
  label: "cli.pages",
  input: pagesCommand,
  depends: { move, pagesLs, pageNew, pageRename, pageRm, pageOrder },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "move":
        return ops.move.run({ input });
      case "pages":
        return ops.pagesLs.run({ input });
      case "page new":
        return ops.pageNew.run({ input });
      case "page rename":
        return ops.pageRename.run({ input });
      case "page rm":
        return ops.pageRm.run({ input });
      case "page order":
        return ops.pageOrder.run({ input });
    }
  },
});
