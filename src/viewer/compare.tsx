import { data, operation } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { z } from "zod";

import { frames } from "@/frames";

import type { Pane } from "./follow";
import { FramePicture } from "./picture";

// Two pictures of one frame in a request's popover (SPEC-viewer.md § Follow the requests 13, 14;
// the design's Compare): one picture, with a two-way switch on its top edge, as GitHub's image
// diff and Figma's branch compare. `Before` | `After` for a result, `When asked` | `Now` for a
// request that may be outdated. A folded switch shows no picture; a click on a side opens it.

/** A side of the switch. */
export type Side = "left" | "right";

/**
 * The side that the viewer picked on each switch, by its key. The key holds what folds or opens
 * the switch again (the request's change, the textbox), so a pick lasts until one of them changes.
 */
export const sidePicks = data<Readonly<Record<string, Side>>>({
  label: "viewer.sidePicks",
  initial: {},
});

/** You click a side of a switch: its picture opens on that side. */
export const pickSide = operation({
  label: "viewer.pickSide",
  input: z.object({ key: z.string(), side: z.enum(["left", "right"]) }),
  depends: { picks: sidePicks.controller },
  run: ({ picks }, { input: { key, side } }) => picks.set({ ...picks.get(), [key]: side }),
});

/**
 * The picture of a version of a frame, at the frame's box, or the box it had before it was
 * removed. A version that is not current has its key in the board's `kept`.
 */
function PanePicture({
  canvas,
  id,
  pane,
}: {
  canvas: string;
  id: string;
  pane: { label: string; version: number };
}) {
  const frame = useData(frames.board.frames.of({ canvas, id }));
  const held = useData(frames.board.kept.of({ canvas, id, version: pane.version }));
  const gone = useData(frames.board.removed.of({ canvas, id }));
  const box = frame ?? gone;
  if (!box) return null;
  const k = frame?.version === pane.version ? frame.k : held?.k;

  return (
    <FramePicture
      canvas={canvas}
      frame={box}
      version={pane.version}
      k={k}
      alt={`${pane.label}: ${box.name}`}
      card={16 / 10}
    />
  );
}

/** A side's button of the switch: a radio, checked while its picture shows. */
function SideButton({
  pane,
  checked,
  onPick,
}: {
  pane: Pane;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      className="e-cmpr-cap"
      aria-checked={checked}
      onClick={onPick}
    >
      {pane.label}
    </button>
  );
}

/**
 * The switch and the picture of the side on show. `show` is the side it opens on, and `open`
 * whether it opens; a pick of the viewer, by `pickKey`, overrides both.
 */
export function Compare({
  canvas,
  id,
  left,
  right,
  show,
  open,
  pickKey,
}: {
  canvas: string;
  id: string;
  left: Pane;
  right: Pane;
  show: Side;
  open: boolean;
  pickKey: string;
}) {
  const picked = useData(sidePicks, (picks) => picks[pickKey]);
  const pick = useRun(pickSide);
  const side = picked ?? show;
  const opened = picked !== undefined || open;
  const pane = side === "left" ? left : right;

  return (
    <div className="e-cmpr" data-show={side} data-open={opened ? "yes" : "no"}>
      <div className="e-cmpr-switch" role="radiogroup" aria-label="Picture">
        {(["left", "right"] as const).map((one) => (
          <SideButton
            key={one}
            pane={one === "left" ? left : right}
            checked={opened && side === one}
            onPick={() => pick.run({ input: { key: pickKey, side: one } })}
          />
        ))}
      </div>
      {opened ? (
        <div className="e-cmpr-pic">
          {pane.version === null ? (
            <p className="e-cmpr-none">Frame removed</p>
          ) : (
            <PanePicture canvas={canvas} id={id} pane={{ ...pane, version: pane.version }} />
          )}
        </div>
      ) : null}
    </div>
  );
}
