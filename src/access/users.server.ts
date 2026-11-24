import { operation } from "@tinkered/core";
import { z } from "zod";

import { ownerApi, userApi } from "./contract";
import { caller, digestOf } from "./guards.server";
import { inUse } from "./login.server";
import { browserCodes, logins, secretBytes, sessions, store, users } from "./store.server";

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
  depends: {
    users: users.atScope.controller,
    logins: logins.atScope.controller,
    codes: browserCodes.atScope.controller,
    sessions: sessions.atScope.controller,
  },
  run: ({ users, logins, codes, sessions }, { clock }) => {
    const now = clock.currentTimeMillis();
    const cli = logins.get().map((l) => ({ ...l, browser: false }));
    const browser = codes.get().map((c) => ({ ...c, browser: true }));

    return {
      users: users.get().map(({ name, role, since }) => ({ name, role, since })),
      requests: [...cli, ...browser]
        .filter((l) => l.state === "pending" && l.expiresAt > now)
        .toSorted((a, b) => a.since - b.since)
        .map(({ code, name, since, expiresAt, browser }) => ({
          code,
          name,
          since,
          expiresAt,
          browser,
        })),
      sessions: sessions
        .get()
        .toSorted((a, b) => b.used - a.used)
        .map(({ id, name, browser, since, used }) => ({ id, name, browser, since, used })),
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

const waitingBrowser = operation({
  label: "access.waitingBrowser",
  input: z.string(),
  depends: { codes: browserCodes.atScope.controller },
  run: ({ codes }, { input: code, clock }) => {
    const now = clock.currentTimeMillis();

    return codes.get().find((c) => c.code === code && c.state === "pending" && c.expiresAt > now);
  },
});

const approveBrowser = operation({
  label: "access.approveBrowser",
  input: ownerApi["users.approve"].input,
  depends: {
    waitingBrowser,
    store,
    users: users.atScope.controller,
    bytes: secretBytes,
    digestOf,
  },
  run: async ({ waitingBrowser, store, users, bytes, digestOf }, { input, clock }) => {
    const code = waitingBrowser.run({ input: input.code });
    if (!code) return { kind: "gone" as const };

    const held = users.of({ name: code.name }).get();
    if (held) {
      store.write({ codes: [{ ...code, state: "approved" }] });
      return {
        kind: "approved" as const,
        user: { name: held.name, role: held.role, since: held.since },
      };
    }

    const user = {
      name: code.name,
      role: input.owner ? ("owner" as const) : ("member" as const),
      since: clock.currentTimeMillis(),
    };
    const unusable = digestOf.run({ input: Buffer.from(bytes.run({ input: 32 })).toString("hex") });
    store.write({
      users: [{ ...user, digest: unusable }],
      codes: [{ ...code, state: "approved" }],
    });
    return { kind: "approved" as const, user };
  },
});

export const approve = operation({
  label: "users.approve.do",
  input: ownerApi["users.approve"].input,
  depends: { waiting, approveBrowser, store },
  run: async ({ waiting, approveBrowser, store }, { input, clock }) => {
    const login = waiting.run({ input: input.code });
    if (!login) return approveBrowser.run({ input });

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
  depends: { waiting, waitingBrowser, store },
  run: async ({ waiting, waitingBrowser, store }, { input }) => {
    const login = waiting.run({ input: input.code });
    const code = waitingBrowser.run({ input: input.code });
    if (!login && !code) return { kind: "gone" as const };

    store.write({
      logins: login ? [{ ...login, state: "denied" }] : [],
      codes: code ? [{ ...code, state: "denied" }] : [],
    });
    return { kind: "denied" as const };
  },
});

export const endSession = operation({
  label: "users.end.do",
  input: ownerApi["users.end"].input,
  depends: { sessions: sessions.atScope.controller, store },
  run: async ({ sessions, store }, { input }) => {
    const row = sessions.get().find((s) => s.id === input.session);
    if (!row) return { kind: "gone" as const };

    store.write({ endSessions: [row.id] });
    return { kind: "ended" as const };
  },
});

const remove = operation({
  label: "access.remove",
  input: z.string(),
  depends: {
    users: users.atScope.controller,
    logins: logins.atScope.controller,
    codes: browserCodes.atScope.controller,
    store,
  },
  run: async ({ users, logins, codes, store }, { input: name, clock }) => {
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
    const endedCodes = codes
      .get()
      .filter((c) => c.name === row.name && (c.state === "approved" || c.state === "pending"))
      .map((c) => ({ ...c, state: "denied" as const }));
    store.write({ drop: [row.name], logins: ended, codes: endedCodes });
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
  "users.end": endSession,
} as const;
