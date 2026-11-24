import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { stage } from "./stage";

export const zoomSteps = ["in", "out", "actual", "fit"] as const;

export type ZoomStep = (typeof zoomSteps)[number];

export const zoomItems = [
  { step: "in", name: "Zoom in", keys: "Ctrl +" },
  { step: "out", name: "Zoom out", keys: "Ctrl −" },
  { step: "actual", name: "Zoom to 100%", keys: "Shift 0" },
  { step: "fit", name: "Zoom to fit", keys: "Shift 1" },
] as const;

const stepOfCtrlKey: Readonly<Record<string, ZoomStep>> = {
  "=": "in",
  "+": "in",
  "-": "out",
  _: "out",
};

const stepOfShiftCode: Readonly<Record<string, ZoomStep>> = { Digit0: "actual", Digit1: "fit" };

export const zoomStep = operation({
  label: "viewer.zoomStep",
  input: z.enum(zoomSteps),
  depends: { at: stage },
  run: ({ at }, { input: step }) => {
    switch (step) {
      case "in":
        return at.zoomIn();
      case "out":
        return at.zoomOut();
      case "actual":
        return at.zoomActual();
      case "fit":
        return at.fit();
    }
  },
});

export const zoomKeyStep = operation({
  label: "viewer.zoomKeyStep",
  input: z.object({ key: z.string(), code: z.string(), ctrl: z.boolean(), shift: z.boolean() }),
  run: (_, { input }) => {
    if (input.ctrl) return stepOfCtrlKey[input.key] ?? null;
    if (input.shift) return stepOfShiftCode[input.code] ?? null;

    return null;
  },
});

export const zoomKeys = resource({
  label: "viewer.zoomKeys",
  target: "scope",
  depends: { zoomKeyStep, zoomStep },
  factory: ({ zoomKeyStep, zoomStep }, ctx) => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;

      const ctrl = event.ctrlKey || event.metaKey;
      const step = zoomKeyStep.run({
        input: { key: event.key, code: event.code, ctrl, shift: event.shiftKey },
      });
      if (step === null) return;

      event.preventDefault();
      zoomStep.run({ input: step });
    };
    window.addEventListener("keydown", onKey);
    ctx.defer(() => window.removeEventListener("keydown", onKey));

    return { listening: true };
  },
});
