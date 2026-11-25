import { operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { caseValues } from "@/frames/cases";
import { fixtureSwitch } from "@/kit/fixtures";

export const caseOverBoard = operation({
  label: "viewer.caseOverBoard",
  input: z.object({ board: z.record(z.string(), z.string()), values: caseValues }),
  run: (_, { input: { board, values } }): Record<string, string> => {
    const set = { ...board, ...values.switches };
    return values.fixture === null ? set : { ...set, [fixtureSwitch]: values.fixture };
  },
});

const caseCanvas = tag<string>({ label: "viewer.caseCanvas" });

const caseFrame = tag<string>({ label: "viewer.caseFrame" });

export const frameCase = resource({
  label: "viewer.frameCase",
  config: { canvas: caseCanvas.required, id: caseFrame.required },
  depends: { shown: frames.board.frames },
  factory: ({ shown }, { config: { canvas, id } }) =>
    shown.get().find((one) => one.canvas === canvas && one.id === id)?.case ?? null,
});
