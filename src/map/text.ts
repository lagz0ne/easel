import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { runStatuses } from "./units";

const answer = z.object({ call: z.string(), kind: z.string(), fault: z.boolean() }).nullable();

type Said = { answer: z.infer<typeof answer>; effects: readonly string[] };

export const mapJson = z.object({
  cell: z.string(),
  start: z.string(),
  view: z.string().nullable(),
  calls: z.array(z.object({ call: z.string(), answers: z.array(z.string()) })),
  states: z.array(
    z.object({
      state: z.string(),
      column: z.number(),
      row: z.number(),
      sample: z.unknown(),
      actions: z.array(z.string()),
      run: z
        .object({
          from: z.string(),
          action: z.string(),
          press: z.string(),
          status: z.enum(runStatuses),
        })
        .nullable(),
    }),
  ),
  moves: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      action: z.string(),
      answer,
      effects: z.array(z.string()),
    }),
  ),
  stays: z.array(
    z.object({ state: z.string(), action: z.string(), answer, effects: z.array(z.string()) }),
  ),
});

export type MapJson = z.infer<typeof mapJson>;

export const mapWords = resource({
  label: "map.words",
  target: "scope",
  factory: () => {
    const narrowest = 8;
    const indent = "  ";
    const faultWord = "fault";

    const words = {
      saidOf: ({ answer, effects }: Said) => {
        const kind = answer?.fault ? `${faultWord} ${answer.kind}` : answer?.kind;
        const call = answer ? `, ${answer.call} ${kind}` : "";
        return effects.length ? `${call} (${effects.join(", ")})` : call;
      },

      gridOf: (map: MapJson) => {
        const columns = Math.max(0, ...map.states.map((state) => state.column)) + 1;
        const rows = Math.max(0, ...map.states.map((state) => state.row)) + 1;
        const width = Math.max(narrowest, ...map.states.map((state) => state.state.length + 2));
        const head = Array.from({ length: columns }, (_column, at) => `step ${at}`);

        const lines = Array.from({ length: rows }, (_line, row) =>
          Array.from(
            { length: columns },
            (_column, column) =>
              map.states.find((state) => state.row === row && state.column === column)?.state ?? "",
          ),
        );
        return [["", ...head], ...lines.map((line, row) => [`row ${row}`, ...line])].map((line) =>
          line
            .map((text) => text.padEnd(width))
            .join("")
            .trimEnd(),
        );
      },

      movesOf: (map: MapJson) => {
        const from = Math.max(0, ...map.moves.map((move) => move.from.length));
        const to = Math.max(0, ...map.moves.map((move) => move.to.length));
        return map.moves.map(
          (move) =>
            `${indent}${move.from.padEnd(from)} -> ${move.to.padEnd(to)}  ${move.action}${words.saidOf(move)}`,
        );
      },

      staysOf: (map: MapJson) => {
        const width = Math.max(0, ...map.stays.map((stay) => stay.state.length));
        return map.stays.map(
          (stay) => `${indent}${stay.state.padEnd(width)}  ${stay.action}${words.saidOf(stay)}`,
        );
      },

      callsOf: (map: MapJson) =>
        map.calls.map((call) => `${indent}${call.call}: ${call.answers.join(", ")}`),
    };

    return words;
  },
});

export const mapText = operation({
  label: "map.text",
  input: mapJson,
  depends: { words: mapWords },
  run: ({ words }, { input }) => {
    const view = input.view ? `view ${input.view}` : "no view: each action from each state";

    return [
      `map ${input.cell}, start ${input.start}, ${view}`,
      "",
      ...words.gridOf(input),
      "",
      "moves",
      ...words.movesOf(input),
      "",
      "stays",
      ...words.staysOf(input),
      "",
      "calls",
      ...words.callsOf(input),
    ].join("\n");
  },
});
