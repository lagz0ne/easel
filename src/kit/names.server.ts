import { operation } from "@tinkered/core";
import { z } from "zod";

export const nearestName = operation({
  label: "kit.nearestName",
  input: z.custom<{ name: string; names: Iterable<string> }>(),
  run: (_, { input }) => {
    const wanted = input.name.split("");
    const first: { best: string | null; most: number } = {
      best: null,
      most: Math.max(2, Math.floor(input.name.length / 3)),
    };

    return [...input.names].reduce((near, name) => {
      if (Math.abs(input.name.length - name.length) > near.most) return near;

      const letters = name.split("");
      const last = wanted.reduce(
        (row, char) =>
          Math.min(...row) > near.most
            ? row
            : letters.reduce(
                (next, letter, j) => {
                  const swap = (row[j] ?? 0) + (letter === char ? 0 : 1);
                  next.push(Math.min((row[j + 1] ?? 0) + 1, (next[j] ?? 0) + 1, swap));
                  return next;
                },
                [(row[0] ?? 0) + 1],
              ),
        Array.from({ length: letters.length + 1 }, (_, j) => j),
      );

      const cost = Math.min(last[letters.length] ?? near.most + 1, near.most + 1);
      return cost <= near.most && cost > 0 ? { best: name, most: cost - 1 } : near;
    }, first).best;
  },
});
