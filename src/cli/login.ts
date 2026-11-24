import { createHash, randomBytes } from "node:crypto";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { access } from "@/access";
import { code, loginApi, name, roles } from "@/access/contract";

import { deadline, exitOf, exits, faultExit } from "./exit";
import { entryOf, envToken, saveEntry, server } from "./hosts";
import { json, say } from "./output";

export const relinkAfter = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

export const newToken = operation({
  label: "cli.newToken",
  run: () => {
    const token = randomBytes(32).toString("base64url");

    return { token, digest: createHash("sha256").update(token).digest("hex") };
  },
});

const user = z.object({ name: z.string(), role: z.enum(roles), since: z.number() });

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

type WaitAnswer = Awaited<ReturnType<(typeof loginApi)["login.wait"]["run"]>>;

const pending = z.object({ name: z.string(), code: z.string(), expiresAt: z.number() });

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

const waiting = z.object({
  name: z.string(),
  code: z.string(),
  request: z.string(),
  expiresAt: z.number(),
  token: z.string(),
  print: z.boolean(),
});

const forget = operation({
  label: "cli.forget",
  input: z.boolean(),
  depends: { saveEntry },
  run: ({ saveEntry }, { input: print }) => {
    if (!print) saveEntry.run({ input: {} });
  },
});

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

const keepGranted = operation({
  label: "cli.keepGranted",
  input: z.object({
    address: z.literal("login.start"),
    user,
    token: z.string(),
    print: z.boolean(),
  }),
  depends: { signedIn, printed },
  run: ({ signedIn, printed }, { input: { print, ...given } }) =>
    print ? printed.run({ input: given }) : signedIn.run({ input: given }),
});

const startRefusal = operation({
  label: "cli.startRefusal",
  input: z.object({
    answer: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("taken") }),
      z.object({ kind: z.literal("single") }),
      z.object({ kind: z.literal("slow"), retryIn: z.number() }),
    ]),
    name: z.string(),
    server: z.string(),
  }),
  run: (_, { input: { answer, name, server } }) => {
    switch (answer.kind) {
      case "taken":
        return `the name ${name} is taken on ${server}: pick another name`;
      case "single":
        return `${server} is for one person (EASEL_AUTH=single): it takes no new user. For an agent, the person runs \`easel users add ${name}\` and gives the agent its token`;
      case "slow":
        return `too many logins from here: try again in ${Math.ceil(answer.retryIn / 1000)} s`;
    }
  },
});

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
    keepGranted,
    pendingLogin,
    no,
    startRefusal,
    faultExit,
    deadline,
    start: access.login["login.start"],
    server: server.required,
  },
  run: async (deps, { input }) => {
    const { pendingLogin, no, startRefusal, faultExit, deadline, start } = deps;
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
      case "granted":
        return deps.keepGranted.run({ input: { address, user: answer.user, token, print } });
      case "taken":
      case "single":
      case "slow": {
        const text = startRefusal.run({ input: { answer, name, server: deps.server } });
        return no.run({ input: { address, answer, text } });
      }
    }
  },
});

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
