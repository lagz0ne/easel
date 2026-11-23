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

// The panes of an app frame (SPEC-kit.md § The capsules, "A control in its own scope"; the chart
// kit-control-link): each is a React component of the frame that the viewer draws at one place,
// in an iframe and a scope of its own. The frame serves a part of its capsule on a link (a
// `MessageChannel`), and the page gives the other end to the pane; the page reads nothing on it.

/** The places of a pane: the frame's label row, or a column at its left or right edge. */
export const panePlace = z.enum(["top", "left", "right"]);

export type PanePlace = z.infer<typeof panePlace>;

/** The frame's panes, on each new port: the page draws an iframe for each place. */
export const panesPost = z.object({ easel: z.literal("panes"), places: z.array(panePlace) });

/**
 * A link of the frame's scope on screen for the pane at a place: the frame posts it with the end
 * of the channel, and the page posts it to the pane. The page posts it with no end to ask the
 * frame for a new link.
 */
export const linkPost = z.object({ easel: z.literal("link"), place: panePlace });

/** The size of a pane's content, in CSS pixels: the page gives its iframe this size. */
export const sizePost = z.object({ easel: z.literal("size"), w: z.number(), h: z.number() });

/**
 * The script that makes a frame's document the document of its pane at a place: the page puts the
 * place in place of `__PLACE__`, as the paint script takes its version.
 */
export const paneScript = `<script type="application/json" id="easel-pane">{"place":"__PLACE__"}</script>\n`;
