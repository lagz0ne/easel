import { createScope, operation } from "@tinkered/core";
import { z } from "zod";

import { describeCapsule } from "./about";
import { copy } from "./copy";
import { look } from "./look";
import type { CapsuleRow } from "./row";
import { ui } from "./ui";

const kitHandles = { look, copy, ui };

const refusal = z.object({ kind: z.string(), payload: z.unknown() });

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
