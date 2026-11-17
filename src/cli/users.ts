import { operation } from "@tinkered/core";
import { z } from "zod";

import { access } from "@/access";
import { code, name } from "@/access/contract";

import { deadline, exitOf, faultExit } from "./exit";
import { entryOf, saveEntry, server } from "./hosts";
import { say } from "./output";

// `easel whoami`, `easel logout` and `easel users` (SPEC-access.md § Revoke a user, § Sign out).
// Each prints its answer and exits by the call's success list.

/** `easel whoami`: the name, the role and the server (`users.me`). */
export const whoami = operation({
  label: "cli.whoami",
  depends: {
    say,
    exitOf,
    faultExit,
    deadline,
    me: access.user["users.me"],
    server: server.required,
  },
  run: async ({ say, exitOf, faultExit, deadline, me, server }) => {
    const stop = deadline.run({ input: "users.me" });
    const reply = await me.settle({ input: null, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const { name, owner } = reply.value;
    const role = owner ? "owner" : "member";
    say.run({
      input: { json: { ...reply.value, server }, text: `${name} (${role}) on ${server}` },
    });
    return exitOf.run({ input: { address: "users.me", kind: reply.value.kind } });
  },
});

/**
 * `easel logout` (`login.end`): the server removes the user, then the CLI deletes the token. The
 * last owner's answers `last`, and the token, which still works, is kept.
 */
export const logout = operation({
  label: "cli.logout",
  depends: {
    say,
    exitOf,
    faultExit,
    deadline,
    entryOf,
    saveEntry,
    end: access.user["login.end"],
    server: server.required,
  },
  run: async ({ say, exitOf, faultExit, deadline, entryOf, saveEntry, end, server }) => {
    const stop = deadline.run({ input: "login.end" });
    const reply = await end.settle({ input: null, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "ended":
        saveEntry.run({ input: { pending: entryOf.run().pending } });
        say.run({ input: { json: answer, text: `signed out of ${server}` } });
        break;
      case "last":
        say.run({
          input: {
            json: answer,
            text: `you are the last owner of ${server}: approve another owner first (\`easel users approve <code> --owner\`)`,
            error: true,
          },
        });
        break;
    }

    return exitOf.run({ input: { address: "login.end", kind: answer.kind } });
  },
});

/** `easel users`: the users, and the codes that wait (`users.list`). */
export const listUsers = operation({
  label: "cli.users",
  depends: { say, exitOf, faultExit, deadline, list: access.owner["users.list"] },
  run: async ({ say, exitOf, faultExit, deadline, list }) => {
    const stop = deadline.run({ input: "users.list" });
    const reply = await list.settle({ input: null, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const { users, requests } = reply.value;
    const text = [
      "users:",
      ...users.map((u) => `  ${u.name}\t${u.role}\tsince ${new Date(u.since).toISOString()}`),
      requests.length ? "waiting for approval:" : "no code waits for approval",
      ...requests.map(
        (r) =>
          `  ${r.code}\t${r.name}\tcame ${new Date(r.since).toISOString()}\truns out ${new Date(r.expiresAt).toISOString()}`,
      ),
    ].join("\n");
    say.run({ input: { json: reply.value, text } });
    return exitOf.run({ input: { address: "users.list" } });
  },
});

/** `easel users approve <code> [--owner]`. */
export const approveUser = operation({
  label: "cli.approve",
  input: z.object({ code, owner: z.boolean() }),
  depends: { say, exitOf, faultExit, deadline, approve: access.owner["users.approve"] },
  run: async ({ say, exitOf, faultExit, deadline, approve }, { input }) => {
    const stop = deadline.run({ input: "users.approve" });
    const reply = await approve.settle({ input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "approved":
        say.run({
          input: { json: answer, text: `approved ${answer.user.name} (${answer.user.role})` },
        });
        break;
      case "gone":
        say.run({
          input: {
            json: answer,
            text: `code ${input.code} does not wait: it was used, denied or ran out`,
            error: true,
          },
        });
        break;
    }

    return exitOf.run({ input: { address: "users.approve", kind: answer.kind } });
  },
});

/** `easel users deny <code>`. */
export const denyUser = operation({
  label: "cli.deny",
  input: z.object({ code }),
  depends: { say, exitOf, faultExit, deadline, deny: access.owner["users.deny"] },
  run: async ({ say, exitOf, faultExit, deadline, deny }, { input }) => {
    const stop = deadline.run({ input: "users.deny" });
    const reply = await deny.settle({ input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "denied":
        say.run({ input: { json: answer, text: `denied code ${input.code}` } });
        break;
      case "gone":
        say.run({
          input: {
            json: answer,
            text: `code ${input.code} does not wait: it was used, denied or ran out`,
            error: true,
          },
        });
        break;
    }

    return exitOf.run({ input: { address: "users.deny", kind: answer.kind } });
  },
});

/** `easel users revoke <name>`: its token stops working at once, and its name is free. */
export const revokeUser = operation({
  label: "cli.revoke",
  input: z.object({ name }),
  depends: { say, exitOf, faultExit, deadline, revoke: access.owner["users.revoke"] },
  run: async ({ say, exitOf, faultExit, deadline, revoke }, { input }) => {
    const stop = deadline.run({ input: "users.revoke" });
    const reply = await revoke.settle({ input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "revoked":
        say.run({ input: { json: answer, text: `revoked ${input.name}` } });
        break;
      case "last":
        say.run({
          input: {
            json: answer,
            text: `${input.name} is the last owner: approve another owner first`,
            error: true,
          },
        });
        break;
      case "gone":
        say.run({ input: { json: answer, text: `no user ${input.name}`, error: true } });
        break;
    }

    return exitOf.run({ input: { address: "users.revoke", kind: answer.kind } });
  },
});
