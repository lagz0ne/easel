import { createHash, randomBytes } from "node:crypto";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { access } from "@/access";
import { code, loginApi, name, roles } from "@/access/contract";

import { deadline, exitOf, exits, faultExit } from "./exit";
import { entryOf, envToken, saveEntry, server } from "./hosts";
import { json, say } from "./output";

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

/**
 * `login --print-token` is granted: the token, one time, on stdout (judged rule 2), and nothing
 * kept. Without `--json`, stdout holds only the token, so it goes straight into a secret
 * (`gh auth token` prints so); the next step goes to stderr.
 */
const printed = operation({
  label: "cli.printed",
  input: z.object({ address: z.enum(["login.start", "login.wait"]), user, token: z.string() }),
  depends: { say, exitOf, asJson: json, server: server.required },
  run: ({ say, exitOf, asJson, server }, { input }) => {
    const { user, token, address } = input;
    if (!asJson) {
      const text = `the token of ${user.name} (${user.role}) on ${server}, shown one time: keep it in the secret EASEL_TOKEN, with EASEL_SERVER=${server}`;
      say.run({ input: { json: null, text, error: true } });
    }

    say.run({ input: { json: { kind: "granted", user, token }, text: token } });
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

/**
 * The pending answer, printed at once as the first line: the code, and when it runs out. With
 * `--print-token`, a person's text goes to stderr: stdout is for the token only.
 */
const sayPending = operation({
  label: "cli.sayPending",
  input: pending.extend({ print: z.boolean() }),
  depends: { say },
  run: ({ say }, { input }) =>
    say.run({
      input: {
        json: { kind: "pending", code: input.code, expiresAt: input.expiresAt },
        text: `code ${input.code} for ${input.name}, until ${new Date(input.expiresAt).toISOString()}: ask an owner to run \`easel users approve ${input.code}\``,
        error: input.print,
      },
    }),
});

/** A login the CLI waits on; `print`: `--print-token`, which keeps nothing. */
const waiting = z.object({
  name: z.string(),
  code: z.string(),
  request: z.string(),
  expiresAt: z.number(),
  token: z.string(),
  print: z.boolean(),
});

/** A login that ended with no token: the hosts file forgets it; `--print-token` kept none. */
const forget = operation({
  label: "cli.forget",
  input: z.boolean(),
  depends: { saveEntry },
  run: ({ saveEntry }, { input: print }) => {
    if (!print) saveEntry.run({ input: {} });
  },
});

/**
 * One answer of `login.wait`: the exit code, or null to ask again. `granted` keeps the token, or
 * prints it with `--print-token`; `denied` and `expired` keep nothing (that token never works),
 * and `--print-token` leaves the hosts file as it was; `slow` waits `retryIn` first.
 */
const waited = operation({
  label: "cli.waited",
  input: z.object({ answer: z.custom<WaitAnswer>(), login: waiting }),
  depends: { signedIn, printed, forget, no, server: server.required },
  run: async ({ signedIn, printed, forget, no, server }, { input, clock, signal }) => {
    const { answer, login } = input;
    const address = "login.wait";

    switch (answer.kind) {
      case "granted": {
        const given = { address, user: answer.user, token: login.token } as const;
        return login.print ? printed.run({ input: given }) : signedIn.run({ input: given });
      }
      case "pending":
        return null;
      case "denied":
        forget.run({ input: login.print });
        return no.run({
          input: {
            address,
            answer,
            text: `code ${login.code} was denied on ${server}, or ${login.name} was revoked`,
          },
        });
      case "expired":
        forget.run({ input: login.print });
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
  input: z.object({ login: waiting, lost: z.number() }),
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
 * Waits on a pending login until it ends. It prints the pending answer first, then asks
 * `login.wait` again after each `pending` (each call waits at most 50 s on the server, SPEC.md
 * rule 2) and after a dropped socket: the CLI keeps asking while it waits.
 */
const waitOn = operation({
  label: "cli.waitOn",
  input: waiting,
  depends: { sayPending, waitOnce },
  run: async ({ sayPending, waitOnce }, { input: login }) => {
    sayPending.run({ input: login });
    for (let lost = 0; ;) {
      const step = await waitOnce.run({ input: { login, lost } });
      if (step.lost === undefined) return step.code;
      lost = step.lost;
    }
  },
});

/** `easel login --resume`: waits on the login the hosts file keeps. */
export const waitLogin = operation({
  label: "cli.waitLogin",
  depends: { entryOf, say, waitOn, server: server.required },
  run: async ({ entryOf, say, waitOn, server }) => {
    const login = entryOf.run().pending;
    if (!login) {
      const usage = `no login waits on ${server}: run \`easel login ${server} --name <name>\``;
      say.run({ input: { json: { usage }, text: usage, error: true } });
      return exits.usage;
    }

    return waitOn.run({ input: { ...login, print: false } });
  },
});

/**
 * A pending answer of `login.start`: kept, then waited on unless `--no-wait`. With
 * `--print-token` (`print`), nothing is kept, and the CLI waits on the login it holds in memory:
 * a stopped one cannot resume.
 */
const pendingLogin = operation({
  label: "cli.pendingLogin",
  input: waiting.extend({ noWait: z.boolean() }),
  depends: { saveEntry, sayPending, waitLogin, waitOn, exitOf },
  run: ({ saveEntry, sayPending, waitLogin, waitOn, exitOf }, { input }) => {
    const { noWait, print, ...login } = input;
    if (print) return waitOn.run({ input: { ...login, print } });

    const { name, code, request, expiresAt, token } = login;
    saveEntry.run({ input: { pending: { name, code, request, expiresAt, token } } });
    if (!noWait) return waitLogin.run();

    sayPending.run({ input: { name, code, expiresAt, print } });
    return exitOf.run({ input: { address: "login.start", kind: "pending" } });
  },
});

/** `login.start`: pending (see `pendingLogin`), or its end. */
const startLogin = operation({
  label: "cli.startLogin",
  input: z.object({
    name: z.string(),
    token: z.string(),
    digest: z.string(),
    noWait: z.boolean(),
    print: z.boolean(),
  }),
  depends: {
    signedIn,
    printed,
    pendingLogin,
    no,
    faultExit,
    deadline,
    start: access.login["login.start"],
    server: server.required,
  },
  run: async (deps, { input }) => {
    const { pendingLogin, no, faultExit, deadline, start } = deps;
    const { name, token, digest, print } = input;
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
        const login = { name, code, request, expiresAt, token, print, noWait: input.noWait };
        return pendingLogin.run({ input: login });
      }
      case "granted": {
        const given = { address, user: answer.user, token } as const;
        return print ? deps.printed.run({ input: given }) : deps.signedIn.run({ input: given });
      }
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
 * drop a token that may work (the chart's AWorkingTokenIsNeverDropped). With `EASEL_TOKEN`, the
 * CLI keeps no file, so a login could keep nothing.
 */
const busy = operation({
  label: "cli.busy",
  depends: { entryOf, server: server.required, envToken },
  run: ({ entryOf, server, envToken }) => {
    if (envToken !== null) {
      return "EASEL_TOKEN is set: this run keeps no login; unset EASEL_TOKEN to log in";
    }
    const { user, pending } = entryOf.run();
    if (user) return `signed in to ${server} as ${user.name}: run \`easel logout\` first`;
    if (pending) {
      return `a login for ${pending.name} waits on ${server}: run \`easel login --resume\``;
    }
    return null;
  },
});

/**
 * `easel login`: a new login on this server, with an owner's approval or the setup code. With
 * `--print-token` it keeps nothing, so it drops no token and needs no free entry.
 */
export const login = operation({
  label: "cli.login",
  input: z.object({
    name,
    setup: code.optional(),
    noWait: z.boolean(),
    printToken: z.literal(true).optional(),
  }),
  depends: { busy, newToken, startLogin, setupLogin, say },
  run: async ({ busy, newToken, startLogin, setupLogin, say }, { input }) => {
    if (input.printToken) {
      const { token, digest } = newToken.run();
      return startLogin.run({
        input: { name: input.name, token, digest, noWait: false, print: true },
      });
    }

    const usage = busy.run();
    if (usage) {
      say.run({ input: { json: { usage }, text: usage, error: true } });
      return exits.usage;
    }

    const { token, digest } = newToken.run();
    if (input.setup) {
      return setupLogin.run({ input: { name: input.name, code: input.setup, token, digest } });
    }

    const asked = { name: input.name, token, digest, noWait: input.noWait, print: false };
    return startLogin.run({ input: asked });
  },
});
