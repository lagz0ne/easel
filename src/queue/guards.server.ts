import { operation, tag, transport } from "@tinkered/core";
import { z } from "zod";

import { caller, digestOf, user } from "@/access/guards.server";
import { endedRefusal, lockedRefusal, passMeta } from "@/frames/share";
import { passCanvas } from "@/frames/share.server";

// Who calls a viewer's call (SPEC-queue.md fact rules 1, 2). `mayAct` is frames' `mayRead` for
// the canvas that the call names: a live pass for that canvas, or a live user. It binds the
// sender, so a call takes the name from the pass or the user, never from the input.

/** A viewer's sender: the name from the pass, and the key its limits count under. */
export const sender = tag<{ readonly name: string; readonly key: string }>({
  label: "queue.sender",
});

/** What `mayAct` refuses a pass with no name: the page asks the name, and opens again with it. */
export const nameRefusal = { name: true } as const;

/** The canvas that a call names, if its input has one. */
const namedCanvas = z.object({ canvas: z.string() });

/**
 * Every viewer's call (fact rule 1). A call whose meta carries a pass is judged by the pass
 * alone: one that a password set or changed ended is refused `{ locked: true }`; one that is not
 * live for the canvas that the call names is refused `{ ended: true }`; a live one with no name
 * is refused `{ name: true }`. Any other call goes to `user`: no token, or a dead one, is refused
 * `{ signIn: true }`.
 */
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

/**
 * Who sends a viewer's call: the pass's viewer, or the user, as `mayAct` bound them. A user's
 * limits count under the name.
 */
export const whoActs = operation({
  label: "queue.whoActs",
  depends: { pass: sender.optional, me: caller.optional },
  run: ({ pass, me }) => {
    if (pass.present) return pass.value;
    if (me.present) return { name: me.value.name, key: `user ${me.value.name}` };
    throw new Error("a viewer's call ran without mayAct");
  },
});
