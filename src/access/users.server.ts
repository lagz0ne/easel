import { operation } from "@tinkered/core";
import { z } from "zod";

import { ownerApi, userApi } from "./contract";
import { caller } from "./guards.server";
import { inUse } from "./login.server";
import { logins, store, users } from "./store.server";

export const me = operation({
  label: "users.me.do",
  input: userApi["users.me"].input,
  depends: { me: caller.required },
  run: ({ me }) => ({ kind: "me" as const, name: me.name, owner: me.role === "owner" }),
});

export const add = operation({
  label: "users.add.do",
  input: ownerApi["users.add"].input,
  depends: { inUse, store },
  run: async ({ inUse, store }, { input, clock }) => {
    if (inUse.run({ input })) return { kind: "taken" as const };

    const role = input.owner ? ("owner" as const) : ("member" as const);
    const user = { name: input.name, role, since: clock.currentTimeMillis() };
    store.write({ users: [{ ...user, digest: input.digest }] });
    return { kind: "added" as const, user };
  },
});

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

const waiting = operation({
  label: "access.waiting",
  input: z.string(),
  depends: { logins: logins.atScope.controller },
  run: ({ logins }, { input: code, clock }) => {
    const now = clock.currentTimeMillis();

    return logins.get().find((l) => l.code === code && l.state === "pending" && l.expiresAt > now);
  },
});

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

const remove = operation({
  label: "access.remove",
  input: z.string(),
  depends: { users: users.atScope.controller, logins: logins.atScope.controller, store },
  run: async ({ users, logins, store }, { input: name, clock }) => {
    const row = users.of({ name }).get();
    if (!row) return { kind: "gone" as const };

    const owners = users.get().filter((u) => u.role === "owner");
    if (row.role === "owner" && owners.length === 1) return { kind: "last" as const };

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

export const revoke = operation({
  label: "users.revoke.do",
  input: ownerApi["users.revoke"].input,
  depends: { remove },
  run: async ({ remove }, { input }) => {
    const done = await remove.run({ input: input.name });

    return done.kind === "removed" ? { kind: "revoked" as const } : done;
  },
});

export const endLogin = operation({
  label: "login.end.do",
  input: userApi["login.end"].input,
  depends: { me: caller.required, remove },
  run: async ({ me, remove }) => {
    const done = await remove.run({ input: me.name });

    return done.kind === "last" ? done : { kind: "ended" as const };
  },
});

export const userOps = { "users.me": me, "login.end": endLogin } as const;

export const ownerOps = {
  "users.add": add,
  "users.list": list,
  "users.approve": approve,
  "users.deny": deny,
  "users.revoke": revoke,
} as const;
