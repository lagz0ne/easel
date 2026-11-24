import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi, openApi, ownerApi, successKinds, userApi } from "@/access/contract";
import { opsOwnerApi, opsSuccessKinds, opsUserApi } from "@/ops/contract";

import { entryOf, envToken, saveEntry, server } from "./hosts";
import { say } from "./output";

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
  "users.add",
  "users.list",
  "users.approve",
  "users.deny",
  "users.revoke",
  "users.end",
  "users.rename",
  "browser.link",
  "ops.status",
  "ops.errors",
  "ops.error",
  "ops.resolveError",
  "ops.handOff",
  "ops.fixerTick",
]);

const lists = { ...successKinds, ...opsSuccessKinds };

export const callDeadline = 60_000;

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

export const exitOf = operation({
  label: "cli.exitOf",
  input: z.object({ address, kind: z.string().optional() }),
  run: (_, { input }) => {
    const list: "always" | readonly string[] = lists[input.address];
    const ok = list === "always" || list.some((kind) => kind === input.kind);

    return ok ? exits.ok : exits.no;
  },
});

const signIn = z.object({ signIn: z.literal(true) });

const refusal = operation({
  label: "cli.refusal",
  input: z.unknown(),
  depends: { server: server.required, entryOf, saveEntry, envToken },
  run: ({ server, entryOf, saveEntry, envToken }, { input: payload }) => {
    if (!signIn.safeParse(payload).success) {
      return `refused ${JSON.stringify(payload)}: this needs an owner; ask an owner of ${server}`;
    }
    if (envToken !== null) {
      return `EASEL_TOKEN does not work on ${server}: get a new one with \`easel login ${server} --name <name> --print-token\``;
    }

    const { pending } = entryOf.run();
    saveEntry.run({ input: { pending } });
    return `not signed in to ${server}: log in again with \`easel login ${server} --name <name>\``;
  },
});

const faultOf = operation({
  label: "cli.faultOf",
  input: z.unknown(),
  run: (_, { input: error }) => {
    if (loginApi.fault.is(error) || userApi.fault.is(error) || ownerApi.fault.is(error)) {
      return error;
    }
    if (openApi.fault.is(error)) return error;
    return opsUserApi.fault.is(error) || opsOwnerApi.fault.is(error) ? error : null;
  },
});

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
