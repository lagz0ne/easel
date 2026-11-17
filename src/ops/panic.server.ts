import { operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { z } from "zod";

import { quiet } from "~/components/telemetry/records";

import { scrub, sight } from "./sink.server";
import { flushStore, opsStore } from "./store.server";

// The panic path (SPEC-ops.md fact rule 5, judged rule 9): an unhandled rejection or an uncaught
// exception is written to stderr first, then recorded and written to the store, then the server
// exits. Tinker's `observeServerPanics` covers rejections only and writes nothing; this replaces
// it in the cmd.

/** The panic's lines for stderr: its name, its message with secrets removed, and its frames. */
export const panicText = operation({
  label: "ops.panicText",
  input: z.unknown(),
  depends: { scrub },
  run: ({ scrub }, { input: error }) => {
    if (!(error instanceof Error)) return `panic: ${scrub.run({ input: String(error) })}\n`;
    const frames = (error.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));

    return [`panic: ${error.name}: ${scrub.run({ input: error.message })}`, ...frames, ""].join(
      "\n",
    );
  },
});

/** Records the panic as a server sighting under the label `panic`, and writes the store now. */
export const recordPanic = operation({
  label: "ops.recordPanic",
  input: z.unknown(),
  depends: { sight, flushStore, store: opsStore },
  run: async ({ sight, flushStore, store }, { input: error }) => {
    const { name, message } =
      error instanceof Error ? error : { name: "Error", message: String(error) };
    await sight.run({ input: { side: "server", label: "panic", name, message, traceId: null } });
    await flushStore.run();

    const failure = store.state.failure;
    if (failure !== null) throw new Error(failure);
  },
});

type Out = { write(chunk: string): unknown };

/** What a panic needs: where to write, how to exit, and the close to wait for. */
type Exit = {
  readonly exit: (code: number, reason: unknown) => void;
  readonly closed: Promise<unknown>;
  readonly stderr: Out;
};

const exitInput = z.custom<Exit>((raw) => typeof raw === "object" && raw !== null);

/**
 * One panic: stderr, then the store, then `exit(1)`, then the wait for the close. A store that
 * fails still leaves the panic on stderr, and says the store failed.
 */
export const panic = operation({
  label: "ops.panic",
  input: z.object({ error: z.unknown(), to: exitInput }),
  depends: { panicText: panicText.controller, recordPanic: recordPanic.controller },
  run: async ({ panicText, recordPanic }, { input }) => {
    const { exit, closed, stderr } = input.to;
    try {
      stderr.write(panicText.run({ input: input.error }));
    } catch {
      stderr.write("panic: (its text could not be made)\n");
    }
    try {
      await recordPanic.run({ input: input.error });
    } catch (failed) {
      const why = failed instanceof Error ? failed.message : "unknown";
      stderr.write(`ops: the panic is not in the store: ${why}\n`);
    }
    try {
      exit(1, input.error);
      await closed;
    } catch (cleanup) {
      const why = cleanup instanceof Error ? cleanup.message : "unknown";
      stderr.write(`server close failed: ${why}\n`);
    }
  },
});

/**
 * Listens for panics on the process, `unhandledRejection` and `uncaughtException`; answers the
 * function that stops listening. Each runs `panic` in the scope, quiet.
 */
export const observePanics = operation({
  label: "ops.observePanics",
  input: exitInput.and(z.object({ scope: z.custom<Scope.Handle>((raw) => !!raw) })),
  run: (_, { input }) => {
    const { scope, ...to } = input;
    const fail = (error: unknown) => scope.run(panic, { input: { error, to }, ns: quiet });
    process.on("unhandledRejection", fail);
    process.on("uncaughtException", fail);

    return () => {
      process.off("unhandledRejection", fail);
      process.off("uncaughtException", fail);
    };
  },
});
