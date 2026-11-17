import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi, ownerApi, successKinds, userApi } from "@/access/contract";
import { opsOwnerApi, opsSuccessKinds, opsUserApi } from "@/ops/contract";

import { entryOf, saveEntry, server } from "./hosts";
import { say } from "./output";

// The exit table (SPEC-cli.md § Contract). A kind's exit reads the contract's success list
// (SPEC.md rule 1, fact rule 3): the CLI keeps no list of its own. Codes past 2 are BSD
// `sysexits.h`: 64 usage, 65 data, 69 unavailable, 70 software, 76 protocol. The cmd gives 78
// (config) and 130 (Ctrl-C).

export const exits = {
  ok: 0,
  no: 1,
  refused: 2,
  usage: 64,
  invalid: 65,
  unreachable: 69,
  failed: 70,
  missing: 76,
} as const;

const address = z.enum([
  "login.start",
  "login.setup",
  "login.wait",
  "users.me",
  "login.end",
  "users.list",
  "users.approve",
  "users.deny",
  "users.revoke",
  "ops.status",
  "ops.errors",
  "ops.error",
  "ops.resolveError",
  "ops.handOff",
  "ops.fixerTick",
]);

/** Every module's success lists, by call: the CLI reads them, and keeps none of its own. */
const lists = { ...successKinds, ...opsSuccessKinds };

/**
 * How long the CLI waits for one call's answer: the server answers within 50 s (SPEC.md rule 2),
 * and 10 s more is the margin. A socket that is open on one end only would never answer.
 */
export const callDeadline = 60_000;

/**
 * The deadline of one call: its signal aborts with a `link` fault after `callDeadline`, as a
 * dropped socket does (gRPC's deadline, and Go's `context.WithTimeout`, end a call the same way).
 * The caller aborts the controller when the answer comes, which stops the timer.
 */
export const deadline = operation({
  label: "cli.deadline",
  input: address,
  run: (_, { input, clock, signal }) => {
    const stop = new AbortController();
    const late = loginApi.fault.make(input, "link", { late: callDeadline }, undefined);
    clock.sleep(callDeadline, AbortSignal.any([signal, stop.signal])).then(
      () => stop.abort(late),
      () => undefined,
    );

    return stop;
  },
});

/** 0 when the call's contract lists the kind as a success, else 1. No kind: `always` says. */
export const exitOf = operation({
  label: "cli.exitOf",
  input: z.object({ address, kind: z.string().optional() }),
  run: (_, { input }) => {
    const list: "always" | readonly string[] = lists[input.address];
    const ok = list === "always" || list.some((kind) => kind === input.kind);

    return ok ? exits.ok : exits.no;
  },
});

/** The refusals access gives (SPEC-access.md § Contract). */
const signIn = z.object({ signIn: z.literal(true) });

/** A refusal's text says what to do next (judged rule 3). */
const refusal = operation({
  label: "cli.refusal",
  input: z.unknown(),
  depends: { server: server.required, entryOf, saveEntry },
  run: ({ server, entryOf, saveEntry }, { input: payload }) => {
    if (!signIn.safeParse(payload).success) {
      return `refused ${JSON.stringify(payload)}: this needs an owner; ask an owner of ${server}`;
    }

    // The token no longer works (revoked, or logged out): the CLI keeps it no longer.
    const { pending } = entryOf.run();
    saveEntry.run({ input: { pending } });
    return `not signed in to ${server}: log in again with \`easel login ${server} --name <name>\``;
  },
});

/** The rpc fault this error is, of any module's contract; null when it is none. */
const faultOf = operation({
  label: "cli.faultOf",
  input: z.unknown(),
  run: (_, { input: error }) => {
    if (loginApi.fault.is(error) || userApi.fault.is(error) || ownerApi.fault.is(error)) {
      return error;
    }
    return opsUserApi.fault.is(error) || opsOwnerApi.fault.is(error) ? error : null;
  },
});

/**
 * A call that did not answer: its fault, printed, and its exit code. An error that is no fault
 * of rpc's is the CLI's own bug, and is thrown on.
 */
export const faultExit = operation({
  label: "cli.faultExit",
  input: z.unknown(),
  depends: { say, refusal, faultOf, server: server.required },
  run: ({ say, refusal, faultOf, server }, { input: thrown }) => {
    const error = faultOf.run({ input: thrown });
    if (!error) throw thrown;

    if (error.fault === "refused") {
      const text = refusal.run({ input: error.payload });
      say.run({ input: { json: { refused: error.payload }, text, error: true } });
      return exits.refused;
    }

    const trace = error.traceId ?? error.execution ?? null;
    const failed = {
      code: exits.failed,
      json: { failed: trace },
      text: `the server failed (trace ${trace})`,
    };
    const told = {
      invalid: {
        code: exits.invalid,
        json: { invalid: error.payload },
        text: `the server found the input wrong: ${JSON.stringify(error.payload)}`,
      },
      link: {
        code: exits.unreachable,
        json: { unreachable: server },
        text: `cannot reach ${server}`,
      },
      failed,
      encode: failed,
      decode: failed,
      missing: {
        code: exits.missing,
        json: { missing: error.address },
        text: `${server} has no ${error.address}: is the server older than this CLI?`,
      },
    }[error.fault];
    say.run({ input: { json: told.json, text: told.text, error: true } });
    return told.code;
  },
});
