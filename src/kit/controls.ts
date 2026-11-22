import { z } from "zod";

// The controls of an app frame in the viewer's panel (SPEC-kit.md § The capsules, "The controls in
// the viewer"; the chart kit-frame-controls): the messages of the frame and the page on the
// frame's port. `@easel/frame` (in the frame's iframe) and the viewer's stage (in the page) both
// read them here, so this file imports only zod.

/**
 * Where the viewer draws a control: in the panel `Controls`, in the frame's label row (`top`), or
 * in a column docked to the frame's left or right edge.
 */
export const controlPlace = z.enum(["panel", "top", "left", "right"]);

export type ControlPlace = z.infer<typeof controlPlace>;

/**
 * What the viewer draws for a control: its kind, from the input schema of its operation, and its
 * place. A frame of a runtime from before the places posts none: its controls go in the panel.
 */
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

/** The frame's controls, on each new port. */
export const controlsPost = z.object({
  easel: z.literal("controls"),
  controls: z.array(controlShown),
});

/** The value of each value control in the frame's live scope, after each change. */
export const valuesPost = z.object({
  easel: z.literal("values"),
  values: z.record(z.string(), z.unknown()),
});

/** A control's run that the frame refused, with the kind of the refusal. */
export const ranPost = z.object({ easel: z.literal("ran"), key: z.string(), failed: z.string() });

/** The page's message that runs a control: its key, and the value of a value control. */
export const controlPost = z.object({
  easel: z.literal("control"),
  key: z.string(),
  value: z.unknown().optional(),
});
