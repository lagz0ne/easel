import { operation } from "@tinkered/core";

import { contrast } from "./compose";
import { kitApi } from "./contract";
import { lookValues, mergeLook, rootBlock } from "./look.server";
import { readKit, readKitAt, saveLook, undoLook } from "./store.server";

// The kit's calls (SPEC-kit.md § Contract; the kit-look chart). Each runs after the `user` guard
// (cmds/server.ts, fact rule 1). A change of the look writes through `saveLook` only (fact rule
// 2), measures with the one `contrast` (fact rule 6), and makes no CSS (fact rule 4).

/** The current kit version; the store has one from the first start (`kitStart`). */
const currentKit = operation({
  label: "kit.currentKit",
  depends: { readKit },
  run: async ({ readKit }) => {
    const now = await readKit.run();
    if (now === null) throw new Error("kit: no kit version: kitStart runs first");

    return now;
  },
});

/** `look.get`: the look of the current kit version, or of the kit version `at`. */
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

/**
 * `look.set`: an old base is `stale` at once. Else the patch is merged into the current look
 * (values only). A look that fails a pair of K8 is `unreadable`, with each failing pair, and
 * nothing is written (judged rules 1, 7). Else `saveLook` writes it on the base, with its `:root`
 * block made once; a change on the same base that landed first makes it `stale` there.
 */
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

/** `look.undo`: one step back, as a new kit version (judged rule 8). */
export const lookUndo = operation({
  label: "look.undo.do",
  input: kitApi["look.undo"].input,
  depends: { undoLook },
  run: async ({ undoLook }, { input }) => undoLook.run({ input: input.base }),
});

/** The kit's calls, by address. */
export const kitOps = { "look.get": lookGet, "look.set": lookSet, "look.undo": lookUndo };
