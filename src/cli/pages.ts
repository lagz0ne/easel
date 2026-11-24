import { operation } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { findingLine, sectionGap, sectionWrap } from "@/frames/arrange";
import {
  canvasKey,
  frameId,
  framesContracts,
  pageKey,
  pageName,
  sectionName,
} from "@/frames/contract";

import { exits } from "./exit";
import {
  atFlag,
  badPlace,
  changedText,
  framesDeadline,
  framesExitOf,
  framesFault,
  layoutFindings,
  placedText,
  placeUsage,
  revFlag,
  typedPlace,
  usage,
} from "./frames";
import { say } from "./output";

export const pagesCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("move"),
    canvas: canvasKey,
    id: frameId,
    at: z.string().optional(),
    after: z.string().optional(),
    below: z.string().optional(),
    section: z.string().optional(),
    page: pageKey.optional(),
    size: z.string().optional(),
    rev: z.string().optional(),
  }),
  z.object({ kind: z.literal("pages"), canvas: canvasKey }),
  z.object({ kind: z.literal("page new"), canvas: canvasKey, name: z.string() }),
  z.object({ kind: z.literal("page rename"), canvas: canvasKey, page: pageKey, name: z.string() }),
  z.object({ kind: z.literal("page rm"), canvas: canvasKey, page: pageKey }),
  z.object({ kind: z.literal("page order"), canvas: canvasKey, pages: z.array(pageKey).min(1) }),
  z.object({
    kind: z.literal("section"),
    canvas: canvasKey,
    name: z.string(),
    page: pageKey.optional(),
    at: z.string().optional(),
    flow: z.boolean().optional(),
    after: z.string().optional(),
    first: z.boolean().optional(),
    wrap: z.string().optional(),
    noWrap: z.boolean().optional(),
    gap: z.string().optional(),
    rev: z.string().optional(),
  }),
  z.object({ kind: z.literal("layout"), canvas: canvasKey, page: pageKey.optional() }),
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

type MoveCommand = Extract<PagesCommand, { kind: "move" }>;

const relationWords = z.custom<MoveCommand>().transform(({ after, below, section, page }) => {
  if (after !== undefined) return `after ${after}`;
  if (below !== undefined) return `below ${below}`;
  if (section === undefined) return page === undefined ? "" : `on ${page}`;
  return page === undefined ? `in section ${section}` : `in section ${section} on ${page}`;
});

const whereOf = z.custom<MoveCommand>().transform((command) => {
  const { at, page, size } = command;
  const on = page === undefined ? "" : ` on ${page}`;
  const sized = size === undefined ? "" : ` at size ${size}`;
  if (at !== undefined) return { to: `to ${at}${on}${sized}`, is: `at ${at}${on}${sized}` };

  const where = `${relationWords.parse(command)}${sized}`.trim();
  return { to: where, is: where };
});

const moveText = operation({
  label: "cli.moveText",
  input: z.object({
    command: pagesCommand.options[0],
    answer: framesContracts["frame.move"].output,
  }),
  depends: { changedText, placedText },
  run: ({ changedText, placedText }, { input: { command, answer } }): z.infer<typeof told> => {
    const { canvas, id, page } = command;
    const where = whereOf.parse(command);
    switch (answer.kind) {
      case "moved":
        return { text: `moved ${id} ${where.to}` };
      case "unchanged":
        return { text: `${id} is ${where.is} already` };
      case "gone":
        return {
          text: `no frame ${id} on ${canvas}${page === undefined ? "" : `, or no page ${page}`}: \`easel ls ${canvas}\` and \`easel pages ${canvas}\` list them`,
          error: true,
        };
      case "changed":
        return {
          text: changedText.run({ input: { canvas, rev: answer.rev, verb: "move" } }),
          error: true,
        };
      case "placed":
        return { text: placedText.run({ input: { canvas, id: answer.id } }), error: true };
    }
  },
});

const moveUsage = operation({
  label: "cli.moveUsage",
  input: pagesCommand.options[0],
  depends: { placeUsage },
  run: ({ placeUsage }, { input }) => {
    const { at, after, below, section, size } = input;
    const asked = [at, after, below, section, size].some((flag) => flag !== undefined);
    if (!asked) return "a move needs a place (--at, --after, --below or --section) or --size";
    return placeUsage.run({ input });
  },
});

const move = operation({
  label: "cli.move",
  input: pagesCommand.options[0],
  depends: {
    say,
    usage,
    moveUsage,
    moveText,
    layoutFindings,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["frame.move"],
  },
  run: async (units, { input }) => {
    const { say, usage, moveUsage, moveText, layoutFindings, exitOf, framesFault } = units;
    const bad = moveUsage.run({ input });
    if (bad !== null) return usage.run({ input: bad });
    const { at, after, below, section, size, rev } = input;
    const read = typedPlace.safeParse({ at, after, below, section, size, rev });
    if (!read.success) {
      const flag = typedPlace.keyof().parse(read.error.issues[0]?.path[0]);
      return usage.run({ input: badPlace[flag] });
    }

    const stop = units.deadline.run({ input: "frame.move" });
    const { at: place, ...flags } = read.data;
    const sent = { canvas: input.canvas, id: input.id, page: input.page, ...place, ...flags };
    const reply = await units.call.settle({ input: sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    say.run({ input: { json: answer, ...moveText.run({ input: { command: input, answer } }) } });
    if ("layout" in answer) layoutFindings.run({ input: answer.layout });
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

const sectionFlags = z.object({
  name: sectionName,
  at: atFlag.optional(),
  after: sectionName.optional(),
  wrap: z.string().regex(/^\d+$/).transform(Number).pipe(sectionWrap).optional(),
  gap: z.string().regex(/^\d+$/).transform(Number).pipe(sectionGap).optional(),
  rev: revFlag.optional(),
});

const badSection = {
  name: "a section name has 1 to 80 characters with a letter or a digit",
  at: badPlace.at,
  after: "--after takes the name of a section of the page: `easel layout <canvas>` lists them",
  wrap: "--wrap takes the most columns on a line, 1 to 100",
  gap: "--gap takes the space between two frames in CSS pixels, 16 to 800",
  rev: badPlace.rev,
} as const;

const sectionUsage = operation({
  label: "cli.sectionUsage",
  input: pagesCommand.options[6],
  run: (_, { input }) => {
    if (input.at !== undefined && input.flow) return "--at does not go with --flow";
    if (input.after !== undefined && input.first) return "--after does not go with --first";
    if (input.wrap !== undefined && input.noWrap) return "--wrap does not go with --no-wrap";
    const changes = [input.at, input.flow, input.after, input.first, input.wrap, input.noWrap];
    return [...changes, input.gap].some((flag) => flag !== undefined && flag !== false)
      ? null
      : "give a change: --at, --flow, --after, --first, --wrap, --no-wrap or --gap";
  },
});

const sectionText = operation({
  label: "cli.sectionText",
  input: z.object({
    command: pagesCommand.options[6],
    answer: framesContracts["section.set"].output,
  }),
  depends: { changedText },
  run: ({ changedText }, { input: { command, answer } }): z.infer<typeof told> => {
    const { canvas, name } = command;
    switch (answer.kind) {
      case "set":
        return { text: `set section ${name} on ${answer.layout.page}` };
      case "unchanged":
        return { text: `section ${name} on ${answer.layout.page} is so already` };
      case "changed":
        return {
          text: changedText.run({ input: { canvas, rev: answer.rev, verb: "set" } }),
          error: true,
        };
      case "gone":
        return {
          text: `no section ${name}${command.after === undefined ? "" : ` or ${command.after}`} on that page of ${canvas}: \`easel layout ${canvas}\` lists the sections`,
          error: true,
        };
    }
  },
});

const sectionSent = operation({
  label: "cli.sectionSent",
  input: pagesCommand.options[6],
  depends: { sectionUsage },
  run: ({ sectionUsage }, { input }) => {
    const bad = sectionUsage.run({ input });
    if (bad !== null) return { bad } as const;

    const { name, at, after, wrap, gap, rev } = input;
    const read = sectionFlags.safeParse({ name, at, after, wrap, gap, rev });
    if (!read.success) {
      const flag = sectionFlags.keyof().parse(read.error.issues[0]?.path[0]);
      return { bad: badSection[flag] } as const;
    }

    const flags = read.data;
    const sent = {
      canvas: input.canvas,
      page: input.page,
      section: flags.name,
      at: input.flow ? null : flags.at,
      after: input.first ? null : flags.after,
      wrap: input.noWrap ? null : flags.wrap,
      gap: flags.gap,
      rev: flags.rev,
    };
    return { bad: null, sent } as const;
  },
});

const section = operation({
  label: "cli.section",
  input: pagesCommand.options[6],
  depends: {
    say,
    usage,
    sectionSent,
    sectionText,
    layoutFindings,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["section.set"],
  },
  run: async (units, { input }) => {
    const { say, usage, sectionSent, sectionText, layoutFindings, exitOf, framesFault } = units;
    const asked = sectionSent.run({ input });
    if (asked.bad !== null) return usage.run({ input: asked.bad });

    const stop = units.deadline.run({ input: "section.set" });
    const reply = await units.call.settle({ input: asked.sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    say.run({ input: { json: answer, ...sectionText.run({ input: { command: input, answer } }) } });
    if ("layout" in answer) layoutFindings.run({ input: answer.layout });
    return exitOf.run({ input: { address: "section.set", kind: answer.kind } });
  },
});

const layoutLines = operation({
  label: "cli.layoutLines",
  input: framesContracts["page.layout"].output,
  run: (_, { input: answer }) => {
    if (answer.kind === "gone") return [];

    const { layout, sections } = answer;
    const boxes = sections.map((s) => {
      const count = s.columns.flat().length;
      const placed = s.at ? "\tat" : "";
      return `section ${s.key}\t${s.name}\t${s.x},${s.y} ${s.w}x${s.h}\t${count} frame${count === 1 ? "" : "s"}${placed}`;
    });

    const found = layout.findings.map((f) => findingLine.parse(f));
    const more = layout.more > 0 ? [`and ${layout.more} more`] : [];
    const none = found.length === 0 ? ["no touch and no stray"] : [];
    return [`page ${layout.page}\trev ${layout.rev}`, ...boxes, ...found, ...more, ...none];
  },
});

const layoutGoneText = operation({
  label: "cli.layoutGoneText",
  input: pagesCommand.options[7],
  run: (_, { input: { canvas, page } }) =>
    `no canvas ${canvas}${page === undefined ? "" : `, or no page ${page}`}: \`easel pages ${canvas}\``,
});

const layoutCheck = operation({
  label: "cli.layout",
  input: pagesCommand.options[7],
  depends: {
    say,
    layoutLines,
    layoutGoneText,
    exitOf: framesExitOf,
    framesFault,
    deadline: framesDeadline,
    call: frames.api["page.layout"],
  },
  run: async (units, { input }) => {
    const { say, layoutLines, layoutGoneText, exitOf, framesFault, deadline, call } = units;
    const stop = deadline.run({ input: "page.layout" });
    const sent = { canvas: input.canvas, page: input.page };
    const reply = await call.settle({ input: sent, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return framesFault.run({ input: reply.reason });
    if (reply.status === "failed") return framesFault.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "found": {
        const text = layoutLines.run({ input: answer }).join("\n");
        say.run({ input: { json: answer, text } });
        const clean = answer.layout.findings.length === 0 && answer.layout.more === 0;
        return clean ? exits.ok : exits.no;
      }
      case "gone":
        say.run({ input: { json: answer, text: layoutGoneText.run({ input }), error: true } });
        return exitOf.run({ input: { address: "page.layout", kind: answer.kind } });
    }
  },
});

const placeAct = z.discriminatedUnion("kind", [
  pagesCommand.options[0],
  pagesCommand.options[6],
  pagesCommand.options[7],
]);

const pageAct = z.discriminatedUnion("kind", [
  pagesCommand.options[1],
  pagesCommand.options[2],
  pagesCommand.options[3],
  pagesCommand.options[4],
  pagesCommand.options[5],
]);

const placeRun = operation({
  label: "cli.placeRun",
  input: placeAct,
  depends: { move, section, layoutCheck },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "move":
        return ops.move.run({ input });
      case "section":
        return ops.section.run({ input });
      case "layout":
        return ops.layoutCheck.run({ input });
    }
  },
});

const pageRun = operation({
  label: "cli.pageRun",
  input: pageAct,
  depends: { pagesLs, pageNew, pageRename, pageRm, pageOrder },
  run: (ops, { input }) => {
    switch (input.kind) {
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

export const pagesRun = operation({
  label: "cli.pages",
  input: pagesCommand,
  depends: { placeRun, pageRun },
  run: ({ placeRun, pageRun }, { input }) => {
    const place = placeAct.safeParse(input);
    if (place.success) return placeRun.run({ input: place.data });

    return pageRun.run({ input: pageAct.parse(input) });
  },
});
