import { operation } from "@tinkered/core";
import { z } from "zod";

import { mapJson } from "./text";

export const walkMark = "walk";

export const walkAttribute = "data-easel-walk";

export const walkPageName = operation({
  label: "map.walkPageName",
  input: z.string(),
  run: (_, { input }) => `Map · ${input}`,
});

export const walkFrameName = operation({
  label: "map.walkFrameName",
  input: z.string(),
  run: (_, { input }) => `${input} · ${walkMark}`,
});

export const walkNameOf = operation({
  label: "map.walkNameOf",
  input: z.string(),
  run: (_, { input }) => {
    const end = ` · ${walkMark}`;
    return input.endsWith(end) && input.length > end.length ? input.slice(0, -end.length) : null;
  },
});

export const walkData = z.object({
  name: z.string(),
  map: mapJson,
  replies: z.record(z.string(), z.array(z.object({ kind: z.string(), reply: z.unknown() }))),
});

export type WalkData = z.infer<typeof walkData>;

const waiting = z.object({ id: z.number(), call: z.string() });

export type Waiting = z.infer<typeof waiting>;

export const walkPost = z.discriminatedUnion("kind", [
  z.object({
    easel: z.literal(walkMark),
    kind: z.literal("state"),
    state: z.string(),
    value: z.unknown(),
  }),
  z.object({ easel: z.literal(walkMark), kind: z.literal("waits"), calls: z.array(waiting) }),
]);

export type WalkPost = z.infer<typeof walkPost>;

export const walkOrder = z.discriminatedUnion("kind", [
  z.object({
    easel: z.literal(walkMark),
    kind: z.literal("answer"),
    id: z.number(),
    answer: z.string(),
  }),
  z.object({ easel: z.literal(walkMark), kind: z.literal("go"), value: z.unknown() }),
]);

export type WalkOrder = z.infer<typeof walkOrder>;

const dataOpen = `<script type="application/json" id="easel-walk">`;

const dataClose = "</script>";

const jsonText = z.string().transform((text, ctx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    ctx.addIssue({ code: "custom", message: "not JSON" });
    return z.NEVER;
  }
});

export const walkDocument = operation({
  label: "map.walkDocument",
  input: z.object({ html: z.string(), js: z.string(), css: z.string(), data: walkData }),
  run: (_, { input }) => {
    const json = JSON.stringify(input.data).replaceAll("<", "\\u003c");
    const js = input.js.replaceAll("</script", "<\\/script");
    const css = input.css.replaceAll("</style", "<\\/style");

    const head = `<style>${css}</style>${dataOpen}${json}${dataClose}`;
    const body = `<script type="module">${js}</script>`;
    return input.html
      .replace(/<link rel="stylesheet"[^>]*>/g, "")
      .replace(/<script type="module"[^>]*><\/script>/g, "")
      .replace("</head>", () => `${head}</head>`)
      .replace("</body>", () => `${body}</body>`);
  },
});

export const walkDataOf = operation({
  label: "map.walkDataOf",
  input: z.string(),
  run: (_, { input }) => {
    const from = input.indexOf(dataOpen);
    const to = from < 0 ? -1 : input.indexOf(dataClose, from);
    if (to < 0) return { kind: "none" } as const;

    const read = jsonText.pipe(walkData).safeParse(input.slice(from + dataOpen.length, to));
    return read.success
      ? ({ kind: "found", data: read.data } as const)
      : ({ kind: "none" } as const);
  },
});

export const walkPicks = operation({
  label: "map.walkPicks",
  input: z.object({ map: mapJson, from: z.string(), call: z.string() }),
  run: (_, { input: { map, from, call } }) => {
    const answers = map.calls.find((each) => each.call === call)?.answers ?? [];
    return answers.map((answer) => {
      const move = map.moves.find(
        (each) => each.from === from && each.answer?.call === call && each.answer.kind === answer,
      );
      const to = move && !map.states.find((each) => each.state === move.to)?.run ? move.to : null;
      return { answer, to };
    });
  },
});
