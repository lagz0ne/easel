import { operation, resource } from "@tinkered/core";
import { z } from "zod";

const rankedMove = z.object({ from: z.string(), to: z.string(), rank: z.array(z.number()) });

type RankedMove = z.infer<typeof rankedMove>;

export type Place = { state: string; column: number; row: number };

export const placeMethod = resource({
  label: "map.placeMethod",
  target: "scope",
  factory: () => {
    const order = new Intl.Collator("en", { numeric: true });
    const startColumn = 0;
    const lastPath = String(Number.MAX_SAFE_INTEGER);

    const method = {
      columnsOf: (start: string, states: readonly string[], moves: readonly RankedMove[]) => {
        const columns = new Map([[start, startColumn]]);
        for (const [state, column] of columns) {
          const ahead = moves.filter((move) => move.from === state && !columns.has(move.to));
          for (const move of ahead) columns.set(move.to, column + 1);
        }

        const after = Math.max(startColumn, ...columns.values()) + 1;
        for (const state of states) if (!columns.has(state)) columns.set(state, after);
        return columns;
      },

      pathsOf: (start: string, moves: readonly RankedMove[], columns: Map<string, number>) => {
        const paths = new Map([[start, ""]]);
        for (const [state, column] of columns) {
          const best = moves
            .filter((move) => move.to === state && columns.get(move.from) === column - 1)
            .map((move) =>
              [paths.get(move.from) ?? "", move.rank.join(".")].join(".").replace(/^\./, ""),
            )
            .sort(order.compare)[0];
          if (best !== undefined && !paths.has(state)) paths.set(state, best);
        }
        return paths;
      },

      firstsOf: (start: string, states: readonly string[], paths: Map<string, string>) =>
        [...new Set(states)]
          .filter((state) => state !== start)
          .sort((a, b) => order.compare(paths.get(a) ?? lastPath, paths.get(b) ?? lastPath)),

      nextOf: (
        state: string,
        moves: readonly RankedMove[],
        columns: Map<string, number>,
        placed: Map<string, Place>,
      ) => {
        const column = columns.get(state) ?? startColumn;
        return moves
          .filter(
            (move) =>
              move.from === state && columns.get(move.to) === column + 1 && !placed.has(move.to),
          )
          .sort(
            (a, b) =>
              order.compare(a.rank.join("."), b.rank.join(".")) || order.compare(a.to, b.to),
          )[0]?.to;
      },

      rowOf: (
        first: string,
        row: number,
        moves: readonly RankedMove[],
        columns: Map<string, number>,
        placed: Map<string, Place>,
      ) => {
        for (let state: string | undefined = first; state !== undefined;) {
          placed.set(state, { state, column: columns.get(state) ?? startColumn, row });
          state = method.nextOf(state, moves, columns, placed);
        }
      },
    };

    return method;
  },
});

export const placeMap = operation({
  label: "map.place",
  input: z.object({
    start: z.string(),
    states: z.array(z.string()),
    moves: z.array(rankedMove),
  }),
  depends: { method: placeMethod },
  run: ({ method }, { input }) => {
    const { start } = input;
    const moves = input.moves.filter((move) => move.from !== move.to);
    const columns = method.columnsOf(start, input.states, moves);
    const paths = method.pathsOf(start, moves, columns);
    const placed = new Map<string, Place>();

    let row = 0;
    for (const first of [start, ...method.firstsOf(start, input.states, paths)]) {
      if (placed.has(first)) continue;

      method.rowOf(first, row, moves, columns, placed);
      row += 1;
    }

    return [...placed.values()].sort((a, b) => a.row - b.row || a.column - b.column);
  },
});
