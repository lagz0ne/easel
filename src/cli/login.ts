import { createHash, randomBytes } from "node:crypto";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { access } from "@/access";
import { code, loginApi, name, roles } from "@/access/contract";

import { deadline, exitOf, exits, faultExit } from "./exit";
import { entryOf, saveEntry, server } from "./hosts";
import { say } from "./output";

// `easel login` (SPEC-access.md § Join a server, § Become the first owner), checked against the
// access-login chart (docs/statecharts/access-login.md). The CLI makes the token and sends only
// its digest (RFC 7636's code challenge). It keeps the token and the pending request in the
// hosts file before it waits, so a CLI that stops can resume (§ How a token is made, step 2).

/**
 * When the socket drops while the CLI waits, it asks again after 1, 2, 4, 8 and 16 s: a lost
 * answer is safe to ask for again (step 4). After the last, it exits 69 and the login stays
 * pending for `--resume`.
 */
export const relinkAfter = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

/** A token as the CLI makes it: 32 random bytes; and the SHA-256 it sends, as hex. */
const newToken = operation({
  label: "cli.newToken",
  run: () => {
    const token = randomBytes(32).toString("base64url");

    return { token, digest: createHash("sha256").update(token).digest("hex") };
  },
});

const user = z.object({ name: z.string(), role: z.enum(roles), since: z.number() });

/** Signed in: the token is kept as the user's, and nothing waits any more. */
const signedIn = operation({
  label: "cli.signedIn",
  input: z.object({
    address: z.enum(["login.start", "login.setup", "login.wait"]),
    user,
    token: z.string(),
  }),
  depends: { saveEntry, say, exitOf, server: server.required },
  run: ({ saveEntry, say, exitOf, server }, { input }) => {
    const { user, token, address } = input;
    saveEntry.run({ input: { user: { name: user.name, role: user.role, token } } });
    say.run({
      input: {
        json: { kind: "granted", user },
        text: `signed in to ${server} as ${user.name} (${user.role})`,
      },
    });

    return exitOf.run({ input: { address, kind: "granted" } });
  },
});

/** An answer that is no success, said on the error stream, and its exit code. */
const no = operation({
  label: "cli.no",
  input: z.object({
    address: z.enum(["login.start", "login.setup", "login.wait"]),
    answer: z.looseObject({ kind: z.string() }),
    text: z.string(),
  }),
  depends: { say, exitOf },
  run: ({ say, exitOf }, { input }) => {
    const { address, answer, text } = input;
    say.run({ input: { json: answer, text, error: true } });

    return exitOf.run({ input: { address, kind: answer.kind } });
  },
});

/** What `login.wait` answers: the CLI reads it as the contract typed it. */
type WaitAnswer = Awaited<ReturnType<(typeof loginApi)["login.wait"]["run"]>>;

const pending = z.object({ name: z.string(), code: z.string(), expiresAt: z.number() });

/** The pending answer, printed at once as the first line: the code, and when it runs out. */
const sayPending = operation({
  label: "cli.sayPending",
  input: pending,
  depends: { say },
  run: ({ say }, { input }) =>
    say.run({
      input: {
        json: { kind: "pending", code: input.code, expiresAt: input.expiresAt },
        text: `code ${input.code} for ${input.name}, until ${new Date(input.expiresAt).toISOString()}: ask an owner to run \`easel users approve ${input.code}\``,
      },
    }),
});

/**
 * One answer of `login.wait`: the exit code, or null to ask again. `granted` keeps the token;
 * `denied` and `expired` keep nothing (that token never works); `slow` waits `retryIn` first.
 */
const waited = operation({
  label: "cli.waited",
  input: z.object({
    answer: z.custom<WaitAnswer>(),
    login: z.object({ name: z.string(), code: z.string(), token: z.string() }),
  }),
  depends: { signedIn, saveEntry, no, server: server.required },
  run: async ({ signedIn, saveEntry, no, server }, { input, clock, signal }) => {
    const { answer, login } = input;
    const address = "login.wait";

    switch (answer.kind) {
      case "granted":
        return signedIn.run({ input: { address, user: answer.user, token: login.token } });
      case "pending":
        return null;
      case "denied":
        saveEntry.run({ input: {} });
        return no.run({
          input: {
            address,
            answer,
            text: `code ${login.code} was denied on ${server}, or ${login.name} was revoked`,
          },
        });
      case "expired":
        saveEntry.run({ input: {} });
        return no.run({
          input: { address, answer, text: `code ${login.code} ran out on ${server}: log in again` },
        });
      case "slow":
        await clock.sleep(answer.retryIn, signal);
        return null;
    }
  },
});

/**
 * One `login.wait` call, and what follows: the exit code, or how many times in a row the socket
 * has dropped, to ask again. A dropped socket waits before it asks again (`relinkAfter`).
 */
const waitOnce = operation({
  label: "cli.waitOnce",
  input: z.object({
    login: z.object({ name: z.string(), code: z.string(), request: z.string(), token: z.string() }),
    lost: z.number(),
  }),
  depends: { waited, faultExit, deadline, wait: access.login["login.wait"] },
  run: async ({ waited, faultExit, deadline, wait }, { input, clock, signal }) => {
    const { login, lost } = input;
    const stop = deadline.run({ input: "login.wait" });
    const reply = await wait.settle({ input: { request: login.request }, signal: stop.signal });
    stop.abort();

    if (reply.status !== "success") {
      // A call past its deadline is cancelled with a `link` fault: the same as a dropped socket.
      const error = reply.status === "failed" ? reply.error : reply.reason;
      const link = loginApi.fault.is(error) && error.fault === "link";
      const after = link ? relinkAfter[lost] : undefined;
      if (after === undefined) return { code: faultExit.run({ input: error }) };

      await clock.sleep(after, signal);
      return { lost: lost + 1 };
    }

    const code = await waited.run({ input: { answer: reply.value, login } });
    return code === null ? { lost: 0 } : { code };
  },
});

/**
 * Waits on the pending login until it ends. It prints the pending answer first, then asks
 * `login.wait` again after each `pending` (each call waits at most 50 s on the server, SPEC.md
 * rule 2) and after a dropped socket: the CLI keeps asking while it waits.
 */
export const waitLogin = operation({
  label: "cli.waitLogin",
  depends: { entryOf, say, sayPending, waitOnce, server: server.required },
  run: async ({ entryOf, say, sayPending, waitOnce, server }) => {
    const login = entryOf.run().pending;
    if (!login) {
      const usage = `no login waits on ${server}: run \`easel login ${server} --name <name>\``;
      say.run({ input: { json: { usage }, text: usage, error: true } });
      return exits.usage;
    }

    sayPending.run({ input: login });
    for (let lost = 0; ;) {
      const step = await waitOnce.run({ input: { login, lost } });
      if (step.lost === undefined) return step.code;
      lost = step.lost;
    }
  },
});

/** `login.start`: pending (kept, then waited on unless `--no-wait`), or its end. */
const startLogin = operation({
  label: "cli.startLogin",
  input: z.object({ name: z.string(), token: z.string(), digest: z.string(), noWait: z.boolean() }),
  depends: {
    signedIn,
    saveEntry,
    sayPending,
    waitLogin,
    no,
    exitOf,
    faultExit,
    deadline,
    start: access.login["login.start"],
    server: server.required,
  },
  run: async (deps, { input }) => {
    const { signedIn, saveEntry, sayPending, waitLogin, no, exitOf, faultExit, deadline, start } =
      deps;
    const { name, token, digest } = input;
    const stop = deadline.run({ input: "login.start" });
    const reply = await start.settle({ input: { name, digest }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    const address = "login.start";
    switch (answer.kind) {
      case "pending": {
        const { code, request, expiresAt } = answer;
        saveEntry.run({ input: { pending: { name, code, request, expiresAt, token } } });
        if (!input.noWait) return waitLogin.run();

        sayPending.run({ input: { name, code, expiresAt } });
        return exitOf.run({ input: { address, kind: answer.kind } });
      }
      case "granted":
        return signedIn.run({ input: { address, user: answer.user, token } });
      case "taken":
        return no.run({
          input: {
            address,
            answer,
            text: `the name ${name} is taken on ${deps.server}: pick another name`,
          },
        });
      case "slow":
        return no.run({
          input: {
            address,
            answer,
            text: `too many logins from here: try again in ${Math.ceil(answer.retryIn / 1000)} s`,
          },
        });
    }
  },
});

/** `login.setup`: the first owner is signed in, or nothing is kept. */
const setupLogin = operation({
  label: "cli.setupLogin",
  input: z.object({ name: z.string(), code: z.string(), token: z.string(), digest: z.string() }),
  depends: { signedIn, no, faultExit, deadline, setup: access.login["login.setup"] },
  run: async ({ signedIn, no, faultExit, deadline, setup }, { input }) => {
    const { name, code, token, digest } = input;
    const stop = deadline.run({ input: "login.setup" });
    const reply = await setup.settle({ input: { name, code, digest }, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    const address = "login.setup";
    switch (answer.kind) {
      case "granted":
        return signedIn.run({ input: { address, user: answer.user, token } });
      case "taken": {
        const text =
          "the setup code was used, or the name is taken: log in with a code an owner approves";
        return no.run({ input: { address, answer, text } });
      }
      case "wrong": {
        const text =
          "not the live setup code: read the newest `setup code:` line in the server's log";
        return no.run({ input: { address, answer, text } });
      }
      case "slow": {
        const text = `too many tries from here: try again in ${Math.ceil(answer.retryIn / 1000)} s`;
        return no.run({ input: { address, answer, text } });
      }
    }
  },
});

/**
 * Why this server takes no new login now: it holds a token, or a login waits. A new login would
 * drop a token that may work (the chart's AWorkingTokenIsNeverDropped).
 */
const busy = operation({
  label: "cli.busy",
  depends: { entryOf, server: server.required },
  run: ({ entryOf, server }) => {
    const { user, pending } = entryOf.run();
    if (user) return `signed in to ${server} as ${user.name}: run \`easel logout\` first`;
    if (pending) {
      return `a login for ${pending.name} waits on ${server}: run \`easel login --resume\``;
    }
    return null;
  },
});

/** `easel login`: a new login on this server, with an owner's approval or the setup code. */
export const login = operation({
  label: "cli.login",
  input: z.object({ name, setup: code.optional(), noWait: z.boolean() }),
  depends: { busy, newToken, startLogin, setupLogin, say },
  run: async ({ busy, newToken, startLogin, setupLogin, say }, { input }) => {
    const usage = busy.run();
    if (usage) {
      say.run({ input: { json: { usage }, text: usage, error: true } });
      return exits.usage;
    }

    const { token, digest } = newToken.run();
    if (input.setup) {
      return setupLogin.run({ input: { name: input.name, code: input.setup, token, digest } });
    }

    return startLogin.run({ input: { name: input.name, token, digest, noWait: input.noWait } });
  },
});
