import { createScope, operation } from "@tinkered/core";
import { z } from "zod";

import { describeCapsule } from "./about";
import { copy } from "./copy";
import { look } from "./look";
import type { CapsuleRow } from "./row";
import { ui } from "./ui";

// The list of the kit's capsules (SPEC-kit.md § The capsules): what `kit.capsules` answers, and
// what `easel kit capsules` and the MCP show. It comes from the graph that a frame of the kit
// version gets: easel installs the kit's capsules with its look, and reads the scope's list of
// capsules. So the list cannot be older than the kit, and its start says if the kit draws.

/** The kit's capsules, by label: the units of a row come from its capsule. */
const kitHandles = { look, copy, ui };

const refusal = z.object({ kind: z.string(), payload: z.unknown() });

/**
 * The kit's capsules, installed with the look `values` and the kit's CSS `css` of one kit
 * version: each one described (`describeCapsule`), and the start (`started`, or its refusal: a
 * look that fails K8 is `LookFailsK8`).
 */
export const kitCapsules = operation({
  label: "kit.capsules.list",
  input: z.object({ values: z.record(z.string(), z.string()), css: z.string() }),
  depends: { describeCapsule },
  run: async ({ describeCapsule }, { input }) => {
    const scope = createScope({ capsules: [look(input), copy(), ui()] });
    const start = await scope.ready.then(
      () => ({ kind: "started" as const }),
      (error: unknown) => {
        const known = refusal.safeParse(error);
        if (!known.success) throw error;
        return { kind: "refused" as const, refused: known.data.kind, payload: known.data.payload };
      },
    );

    const capsules: CapsuleRow[] = scope.capsules.map((record) =>
      describeCapsule.run({ input: { record, handle: Reflect.get(kitHandles, record.label) } }),
    );
    await scope.close();
    return { start, capsules };
  },
});
