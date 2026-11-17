import { operation } from "@tinkered/core";
import { z } from "zod";

import { ownerApi, userApi } from "./contract";
import { caller } from "./guards.server";
import { logins, store, users } from "./store.server";

// A user's calls (after the `user` guard) and an owner's (after `user`, then `owner`).

/** `users.me`: who the token is. `easel whoami`. */
export const me = operation({
  label: "users.me.do",
  input: userApi["users.me"].input,
  depends: { me: caller.required },
  run: ({ me }) => ({ kind: "me" as const, name: me.name, owner: me.role === "owner" }),
});

/** `users.list`: the users, and the codes that wait, oldest first. No digest leaves. */
export const list = operation({
  label: "users.list.do",
  input: ownerApi["users.list"].input,
  depends: { users: users.atScope.controller, logins: logins.atScope.controller },
  run: ({ users, logins }, { clock }) => {
    const now = clock.currentTimeMillis();

    return {
      users: users.get().map(({ name, role, since }) => ({ name, role, since })),
      requests: logins
        .get()
        .filter((l) => l.state === "pending" && l.expiresAt > now)
        .toSorted((a, b) => a.since - b.since)
        .map(({ code, name, since, expiresAt }) => ({ code, name, since, expiresAt })),
    };
  },
});

/** The waiting login with this code, if any. */
const waiting = operation({
  label: "access.waiting",
  input: z.string(),
  depends: { logins: logins.atScope.controller },
  run: ({ logins }, { input: code, clock }) => {
    const now = clock.currentTimeMillis();

    return logins.get().find((l) => l.code === code && l.state === "pending" && l.expiresAt > now);
  },
});

/**
 * `users.approve`: the code's digest becomes a live token, in the same write that ends the code
 * (judged rule 6). A code that is not waiting answers `gone`, so a second approve does too.
 */
export const approve = operation({
  label: "users.approve.do",
  input: ownerApi["users.approve"].input,
  depends: { waiting, store },
  run: async ({ waiting, store }, { input, clock }) => {
    const login = waiting.run({ input: input.code });
    if (!login) return { kind: "gone" as const };

    const user = {
      name: login.name,
      role: input.owner ? ("owner" as const) : ("member" as const),
      since: clock.currentTimeMillis(),
    };
    store.write({
      users: [{ ...user, digest: login.digest }],
      logins: [{ ...login, state: "approved" }],
    });
    return { kind: "approved" as const, user };
  },
});

/** `users.deny`: the code ends; its CLI is told `denied`. A code not waiting answers `gone`. */
export const deny = operation({
  label: "users.deny.do",
  input: ownerApi["users.deny"].input,
  depends: { waiting, store },
  run: async ({ waiting, store }, { input }) => {
    const login = waiting.run({ input: input.code });
    if (!login) return { kind: "gone" as const };

    store.write({ logins: [{ ...login, state: "denied" }] });
    return { kind: "denied" as const };
  },
});

/**
 * One user goes, in one write: its row, with its token, and each of its codes that waits or was
 * approved is denied, so its CLI is never told `granted` (judged rules 8, 14). The name is free
 * again. The last owner answers `last` and nothing changes (judged rule 9).
 */
const remove = operation({
  label: "access.remove",
  input: z.string(),
  depends: { users: users.atScope.controller, logins: logins.atScope.controller, store },
  run: async ({ users, logins, store }, { input: name, clock }) => {
    const row = users.of({ name }).get();
    if (!row) return { kind: "gone" as const };

    const owners = users.get().filter((u) => u.role === "owner");
    if (row.role === "owner" && owners.length === 1) return { kind: "last" as const };

    // An approved code, or one that still waits, ends `denied`; a code past its time stays
    // `expired` (ACodeThatEndedStaysEnded).
    const now = clock.currentTimeMillis();
    const ended = logins
      .get()
      .filter((l) => l.name === row.name)
      .filter((l) => l.state === "approved" || (l.state === "pending" && l.expiresAt > now))
      .map((l) => ({ ...l, state: "denied" as const }));
    store.write({ drop: [row.name], logins: ended });
    return { kind: "removed" as const };
  },
});

/** `users.revoke`: an owner removes a user, or themselves while another owner remains. */
export const revoke = operation({
  label: "users.revoke.do",
  input: ownerApi["users.revoke"].input,
  depends: { remove },
  run: async ({ remove }, { input }) => {
    const done = await remove.run({ input: input.name });

    return done.kind === "removed" ? { kind: "revoked" as const } : done;
  },
});

/**
 * `login.end`: the caller logs out. Its user goes, with its token and codes, in one write, so
 * its name is free to log in again (judged rule 14). The last owner answers `last` and nothing
 * changes. `easel logout`.
 */
export const endLogin = operation({
  label: "login.end.do",
  input: userApi["login.end"].input,
  depends: { me: caller.required, remove },
  run: async ({ me, remove }) => {
    const done = await remove.run({ input: me.name });

    return done.kind === "last" ? done : { kind: "ended" as const };
  },
});

/** The server's side of `userApi`: `access.user({ implement: userOps, onStart: [user] })`. */
export const userOps = { "users.me": me, "login.end": endLogin } as const;

/** The server's side of `ownerApi`: `access.owner({ implement: ownerOps, onStart: [user, owner] })`. */
export const ownerOps = {
  "users.list": list,
  "users.approve": approve,
  "users.deny": deny,
  "users.revoke": revoke,
} as const;
