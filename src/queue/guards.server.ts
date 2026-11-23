import { operation, tag, transport } from "@tinkered/core";
import { z } from "zod";

import { caller, digestOf, user } from "@/access/guards.server";
import { endedRefusal, lockedRefusal, passMeta } from "@/frames/share";
import { passCanvas } from "@/frames/share.server";

export const sender = tag<{ readonly name: string; readonly key: string }>({
  label: "queue.sender",
});

export const nameRefusal = { name: true } as const;

const namedCanvas = z.object({ canvas: z.string() });

export const mayAct = operation({
  label: "queue.mayAct",
  input: transport.hook.start,
  depends: { user, passCanvas, digestOf },
  run: async ({ user, passCanvas, digestOf }, { input }) => {
    const sent = passMeta.safeParse(input.meta);
    if (!sent.success) return user.run({ input });

    const held = await passCanvas.run({ input: sent.data.pass });
    if (held === null || namedCanvas.safeParse(input.input).data?.canvas !== held.canvas) {
      return input.refuse(endedRefusal);
    }
    switch (held.state) {
      case "locked":
        return input.refuse(lockedRefusal);
      case "live":
        if (held.name === null) return input.refuse(nameRefusal);
        return {
          tags: [
            sender({ name: held.name, key: `pass ${digestOf.run({ input: sent.data.pass })}` }),
          ],
        };
    }
  },
});

export const whoActs = operation({
  label: "queue.whoActs",
  depends: { pass: sender.optional, me: caller.optional },
  run: ({ pass, me }) => {
    if (pass.present) return pass.value;
    if (me.present) return { name: me.value.name, key: `user ${me.value.name}` };
    throw new Error("a viewer's call ran without mayAct");
  },
});
