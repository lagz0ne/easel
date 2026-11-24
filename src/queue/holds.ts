import { data } from "@tinkered/core";
import { z } from "zod";

export const limitKind = z.enum(["running", "day"]);

export const hold = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agreement") }),
  z.object({
    kind: z.literal("limit"),
    which: limitKind,
    count: z.number(),
    limit: z.number(),
  }),
  z.object({ kind: z.literal("failed"), retryAt: z.number() }),
  z.object({ kind: z.literal("refused") }),
  z.object({ kind: z.literal("silent"), since: z.number() }),
]);

export type Hold = z.infer<typeof hold>;

export const requestHold = z.object({ canvas: z.string(), id: z.string(), hold });

export type RequestHold = z.infer<typeof requestHold>;

export const holds = data({
  label: "queue.holds",
  mode: "keyed",
  parse: requestHold,
  key: (h) => ({ canvas: h.canvas, id: h.id }),
});
