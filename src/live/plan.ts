import { operation } from "@tinkered/core";
import { z } from "zod";

import { takeKeys, takes } from "./screens";

const take = z.enum(takeKeys);

const role = z.enum(["live", "before"]);

export const liveName = operation({
  label: "live.name",
  input: z.discriminatedUnion("role", [
    z.object({ role: z.literal("design"), design: z.string() }),
    z.object({ role, design: z.string(), take }),
  ]),
  run: (_, { input }) =>
    input.role === "design"
      ? `${input.design} · design`
      : `${input.design} · ${input.role} · ${input.take}`,
});

const namePattern = new RegExp(`^(.+) · (live|before) · (${takeKeys.join("|")})$`);

const shotName = z.tuple([z.string(), z.string().min(1), role, take]);

export const liveNameOf = operation({
  label: "live.nameOf",
  input: z.string(),
  run: (_, { input }) => {
    const shot = shotName.safeParse(namePattern.exec(input)?.slice(0, 4));
    if (shot.success) {
      const [, design, kind, shotTake] = shot.data;
      return { kind, design, take: shotTake } as const;
    }

    const design = /^(.+) · design$/.exec(input)?.[1];
    if (design) return { kind: "design", design } as const;

    return { kind: "other" } as const;
  },
});

export const livePlan = operation({
  label: "live.plan",
  input: z.object({
    build: z.number().int().positive(),
    after: z.number().int().positive().nullable(),
    same: z.boolean().optional(),
  }),
  run: (_, { input }) => {
    if (input.after === null) return { kind: "new" } as const;
    if (input.after !== input.build) return { kind: "next", before: input.after } as const;
    if (input.same === undefined) return { kind: "compare" } as const;

    return input.same ? ({ kind: "same" } as const) : ({ kind: "differs" } as const);
  },
});

const caption = 40;
const rowGap = 300;
const pairGap = 40;
const takeGap = 160;
const designWidth = 1280;
const statusHeight = 900;

export const livePlace = operation({
  label: "live.place",
  input: z.discriminatedUnion("role", [
    z.object({ role: z.literal("status") }),
    z.object({ role: z.literal("design"), row: z.number().int().min(0) }),
    z.object({ role, row: z.number().int().min(0), take }),
  ]),
  run: (_, { input }) => {
    if (input.role === "status") return { x: 0, y: 0 };

    const tallest = Math.max(...takes.map((t) => t.height)) + caption;
    const y = statusHeight + rowGap + input.row * (tallest + rowGap);
    if (input.role === "design") return { x: 0, y };

    const at = takes.findIndex((t) => t.key === input.take);
    const x = takes
      .slice(0, at)
      .reduce((left, t) => left + 2 * t.width + pairGap + takeGap, designWidth + takeGap);
    const width = takes[at]?.width ?? 0;

    return { x: input.role === "before" ? x : x + width + pairGap, y };
  },
});
