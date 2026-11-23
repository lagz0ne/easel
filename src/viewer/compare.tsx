import { data, operation } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { z } from "zod";

import { frames } from "@/frames";

import type { Pane } from "./follow";
import { FramePicture } from "./picture";

export type Side = "left" | "right";

export const sidePicks = data<Readonly<Record<string, Side>>>({
  label: "viewer.sidePicks",
  initial: {},
});

export const pickSide = operation({
  label: "viewer.pickSide",
  input: z.object({ key: z.string(), side: z.enum(["left", "right"]) }),
  depends: { picks: sidePicks.controller },
  run: ({ picks }, { input: { key, side } }) => picks.set({ ...picks.get(), [key]: side }),
});

function PanePicture({
  canvas,
  id,
  pane,
}: {
  canvas: string;
  id: string;
  pane: { label: string; version: number; kit: number | null };
}) {
  const [frame] = useData(frames.board.frames.where({ canvas, id }));
  const now = useData(frames.board.kit.of({ canvas }));
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
      kit={pane.kit ?? now?.kit}
      alt={`${pane.label}: ${box.name}`}
      card={16 / 10}
    />
  );
}

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
