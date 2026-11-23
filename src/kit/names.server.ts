import { operation } from "@tinkered/core";
import { z } from "zod";

export const editRow = operation({
  label: "kit.editRow",
  input: z.custom<{ before: number[]; char: string; b: string }>(),
  run: (_, { input: { before, char, b } }) => {
    const first = (before[0] ?? 0) + 1;
    const row = [first];

    for (let j = 1; j <= b.length; j++) {
      const swap = (before[j - 1] ?? 0) + (b[j - 1] === char ? 0 : 1);
      row.push(Math.min((before[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, swap));
    }
    return row;
  },
});

export const editDistance = operation({
  label: "kit.editDistance",
  input: z.custom<{ a: string; b: string; most: number }>(),
  depends: { editRow },
  run: ({ editRow }, { input: { a, b, most } }) => {
    if (Math.abs(a.length - b.length) > most) return most + 1;

    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (const char of a) {
      row = editRow.run({ input: { before: row, char, b } });
      if (Math.min(...row) > most) return most + 1;
    }
    return Math.min(row[b.length] ?? most + 1, most + 1);
  },
});

export const nearestName = operation({
  label: "kit.nearestName",
  input: z.custom<{ name: string; names: Iterable<string> }>(),
  depends: { editDistance },
  run: ({ editDistance }, { input }) => {
    let best: string | null = null;
    let most = Math.max(2, Math.floor(input.name.length / 3));

    for (const name of input.names) {
      const cost = editDistance.run({ input: { a: input.name, b: name, most } });
      if (cost <= most && cost > 0) {
        best = name;
        most = cost - 1;
      }
    }
    return best;
  },
});
