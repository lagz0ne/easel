import { z } from "zod";

export const controlPlace = z.enum(["panel", "top", "left", "right"]);

export type ControlPlace = z.infer<typeof controlPlace>;

export const controlShown = z.object({
  key: z.string(),
  label: z.string(),
  place: controlPlace.default("panel"),
  kind: z.enum(["action", "switch", "select", "number", "text"]),
  values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export type ControlShown = z.infer<typeof controlShown>;

export const controlsPost = z.object({
  easel: z.literal("controls"),
  controls: z.array(controlShown),
});

export const valuesPost = z.object({
  easel: z.literal("values"),
  values: z.record(z.string(), z.unknown()),
});

export const ranPost = z.object({ easel: z.literal("ran"), key: z.string(), failed: z.string() });

export const controlPost = z.object({
  easel: z.literal("control"),
  key: z.string(),
  value: z.unknown().optional(),
});

export const panePlace = z.enum(["top", "left", "right"]);

export type PanePlace = z.infer<typeof panePlace>;

export const panesPost = z.object({ easel: z.literal("panes"), places: z.array(panePlace) });

export const linkPost = z.object({ easel: z.literal("link"), place: panePlace });

export const sizePost = z.object({ easel: z.literal("size"), w: z.number(), h: z.number() });

export const paneScript = `<script type="application/json" id="easel-pane">{"place":"__PLACE__"}</script>\n`;
