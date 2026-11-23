import { operation } from "@tinkered/core";
import { z } from "zod";

import { maxDocBytes, maxFindings } from "@/frames/contract";

import { checkApp } from "./app.server";
import { kitCapsules } from "./capsules/list.server";
import { check } from "./check.server";
import { contrast } from "./compose";
import { kitApi } from "./contract";
import { lookValues, mergeLook, rootBlock } from "./look.server";
import { runtimeNamesOf } from "./runtime.server";
import { maxAppBytes, utf8Bytes } from "./schema";
import { acceptRuntime, frameKit, readKit, readKitAt, saveLook, undoLook } from "./store.server";

const currentKit = operation({
  label: "kit.currentKit",
  depends: { readKit },
  run: async ({ readKit }) => {
    const now = await readKit.run();
    if (now === null) throw new Error("kit: no kit version: kitStart runs first");

    return now;
  },
});

export const lookGet = operation({
  label: "look.get.do",
  input: kitApi["look.get"].input,
  depends: { currentKit, readKitAt },
  run: async ({ currentKit, readKitAt }, { input }) => {
    const row =
      input.at === undefined ? await currentKit.run() : await readKitAt.run({ input: input.at });
    if (row === null) return { kind: "gone" as const };

    return { kind: "found" as const, kit: row.version, rev: row.lookRev, look: row.look };
  },
});

export const lookSet = operation({
  label: "look.set.do",
  input: kitApi["look.set"].input,
  depends: { currentKit, mergeLook, lookValues, rootBlock, contrast, saveLook },
  run: async (units, { input }) => {
    const now = await units.currentKit.run();
    if (now.lookRev !== input.base) {
      return { kind: "stale" as const, rev: now.lookRev, kit: now.version };
    }

    const look = units.mergeLook.run({ input: { look: now.look, patch: input.look } });
    const values = units.lookValues.run({ input: look });
    const fails = units.contrast
      .run({ input: { look: values, css: now.source } })
      .filter((p) => p.ratio < p.min);
    if (fails.length > 0) return { kind: "unreadable" as const, fails };

    const root = units.rootBlock.run({ input: values });
    return units.saveLook.run({ input: { base: input.base, look, values, root } });
  },
});

export const lookUndo = operation({
  label: "look.undo.do",
  input: kitApi["look.undo"].input,
  depends: { undoLook },
  run: async ({ undoLook }, { input }) => undoLook.run({ input: input.base }),
});

export const checkKit = operation({
  label: "kit.check.do",
  input: kitApi["kit.check"].input,
  depends: { frameKit, check, checkApp, runtimeNamesOf },
  run: async ({ frameKit, check, checkApp, runtimeNamesOf }, { input }) => {
    const text = "tsx" in input ? input.tsx : input.html;
    const maxBytes = "tsx" in input ? maxAppBytes : maxDocBytes;
    if (utf8Bytes.parse(text) > maxBytes) return { kind: "tooBig" as const, maxBytes };

    const kit = await frameKit.run();
    const names = await runtimeNamesOf.run({ input: kit.version });
    const checked =
      "tsx" in input
        ? await checkApp.run({ input: { tsx: input.tsx, kit, names } })
        : await check.run({ input: { html: input.html, kit } });
    const all = checked.kind === "off" ? [] : checked.findings;
    const findings = all.slice(0, maxFindings);
    return {
      kind: "checked" as const,
      kit: kit.version,
      findings,
      more: z.number().parse(all.length - findings.length),
    };
  },
});

export const listCapsules = operation({
  label: "kit.capsules.do",
  input: kitApi["kit.capsules"].input,
  depends: { frameKit, kitCapsules },
  run: async ({ frameKit, kitCapsules }) => {
    const kit = await frameKit.run();
    const { start, capsules } = await kitCapsules.run({
      input: { values: kit.look, css: kit.css },
    });
    return { kind: "found" as const, kit: kit.version, start, capsules };
  },
});

export const kitAccept = operation({
  label: "kit.accept.do",
  input: kitApi["kit.accept"].input,
  depends: { acceptRuntime },
  run: async ({ acceptRuntime }) => acceptRuntime.run(),
});

export const kitOps = {
  "kit.accept": kitAccept,
  "kit.capsules": listCapsules,
  "kit.check": checkKit,
  "look.get": lookGet,
  "look.set": lookSet,
  "look.undo": lookUndo,
};
