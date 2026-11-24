import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { mapJson } from "./text";
import type { Answer } from "./trial";

export type Relation =
  | { kind: "section"; section: string }
  | { kind: "after"; id: string }
  | { kind: "below"; id: string };

export const mapFrameName = operation({
  label: "map.frameName",
  input: z.object({ map: z.string(), state: z.string() }),
  run: (_, { input }) => `${input.map} · ${input.state}`,
});

export const readableLabel = { zoom: 0.1, height: 24, clear: 8 } as const;

export const mapGap = Math.ceil((readableLabel.height + readableLabel.clear) / readableLabel.zoom);

export const captionLook = { line: 22, pad: 14 } as const;

export const cardMark = "card";

export const mapPictureHeight = operation({
  label: "map.pictureHeight",
  input: z.object({ screen: z.number(), lines: z.number() }),
  run: (_, { input }) => input.screen + 2 * captionLook.pad + input.lines * captionLook.line,
});

export const mapCaptionParts = operation({
  label: "map.captionParts",
  input: z.string(),
  run: (_, { input }) => {
    const arrow = "→";
    return input.split(arrow).flatMap((text, at) => {
      const before = at === 0 ? [] : [{ text: arrow, arrow: true }];
      return text ? [...before, { text, arrow: false }] : before;
    });
  },
});

const glyphBox = z.object({ ascent: z.number(), descent: z.number() });

export const mapArrowLift = operation({
  label: "map.arrowLift",
  input: z.object({ text: glyphBox, arrow: glyphBox }),
  run: (_, { input: { text, arrow } }) =>
    (text.descent - text.ascent) / 2 - (arrow.descent - arrow.ascent) / 2,
});

export const mapColumns = operation({
  label: "map.columns",
  input: z.array(z.object({ state: z.string(), column: z.number(), row: z.number() })),
  run: (_, { input }) => {
    const count = Math.max(-1, ...input.map((state) => state.column)) + 1;
    return Array.from({ length: count }, (_column, column) =>
      input
        .filter((state) => state.column === column)
        .toSorted((a, b) => a.row - b.row)
        .map((state) => state.state),
    );
  },
});

export const mapBoard = operation({
  label: "map.board",
  input: z.object({ map: z.string(), columns: z.array(z.array(z.string())) }),
  depends: { mapFrameName },
  run: ({ mapFrameName }, { input }) => {
    const named = input.columns.map((column) =>
      column.map((state) => mapFrameName.run({ input: { map: input.map, state } })),
    );
    return named.flatMap((column) => [column, column.map((name) => `${name} · ${cardMark}`)]);
  },
});

export const mapWords = resource({
  label: "map.canvasWords",
  target: "scope",
  factory: () => {
    const lastPart = /[^.]+$/;
    const faultWord = "fault";

    const words = {
      shortOf: (label: string) => lastPart.exec(label)?.[0] ?? label,

      answerOf: (answer: Answer | null) => {
        if (!answer) return "";
        return ` · ${answer.fault ? `${answer.kind} ${faultWord}` : answer.kind}`;
      },

      moveOf: (move: { action: string; to: string; answer: Answer | null; effects: string[] }) => {
        const effects = move.effects.map(words.shortOf).join(", ");
        const after = effects ? ` (${effects})` : "";
        return `${words.shortOf(move.action)}${words.answerOf(move.answer)} → ${move.to}${after}`;
      },

      placeOf: (columns: readonly string[][], state: string) => {
        const column = columns.find((each) => each.includes(state)) ?? [];
        const before = columns[columns.indexOf(column) - 1] ?? [];
        const at = column.indexOf(state);
        const above = column[at - 1] ?? "";
        return { above, left: at === 0 ? (before[0] ?? "") : "" };
      },
    };

    return words;
  },
});

export const mapCaption = operation({
  label: "map.caption",
  input: z.object({ map: mapJson, state: z.string() }),
  depends: { words: mapWords },
  run: ({ words }, { input }) => {
    const { map, state } = input;
    const shown = map.states.find((each) => each.state === state);
    if (shown?.run) return [state, `the moves of ${shown.run.from}`];

    const out = map.moves.filter((move) => move.from === state).map(words.moveOf);
    const lines = [...new Set(out)];
    return lines.length ? [state, ...lines] : [state, "no move: the end of the map"];
  },
});

export const mapRelation = operation({
  label: "map.relation",
  input: z.object({
    section: z.string(),
    columns: z.array(z.array(z.string())),
    ids: z.record(z.string(), z.string()),
    state: z.string(),
  }),
  depends: { words: mapWords },
  run: ({ words }, { input }): Relation => {
    const { columns, ids, state, section } = input;
    const place = words.placeOf(columns, state);
    const above = ids[place.above];
    if (above) return { kind: "below", id: above };

    const left = ids[place.left];
    if (left) return { kind: "after", id: left };

    return { kind: "section", section };
  },
});

export const mapOrder = operation({
  label: "map.order",
  input: z.object({
    section: z.string(),
    want: z.array(z.array(z.string())),
    now: z.array(z.array(z.string())),
  }),
  run: (_, { input }) => {
    const { want, now, section } = input;
    if (JSON.stringify(want) === JSON.stringify(now)) return [];

    return want.flatMap((column) =>
      column.map((id, at): { id: string; to: Relation } => ({
        id,
        to: at === 0 ? { kind: "section", section } : { kind: "below", id: column[at - 1] ?? "" },
      })),
    );
  },
});
