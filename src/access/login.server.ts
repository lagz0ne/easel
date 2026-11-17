import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { operation, resource, transport } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "./contract";
import { clientAddress } from "./guards.server";
import { logins, mode, newCode, newRequest, setupCode, store, users } from "./store.server";

// The calls with no token: `login.start`, `login.setup`, `login.wait`. They run no guard and
// change only users and logins, through `store` (fact rule 3).

const minute = 60_000;

/** A code runs out 10 minutes after it was made (judged rule 3). */
export const codeLife = 10 * minute;

/** `login.wait` answers within 50 s, under the socket's 60 s idle timeout (SPEC.md rule 2). */
export const waitMax = 50_000;

/** Per address, per minute (judged rule 10). */
export const limits = { "login.start": 5, "login.setup": 5, "login.wait": 30 } as const;

/** At most 20 codes wait at once, and 3 from one address (judged rule 11). */
export const maxPending = { all: 20, address: 3 } as const;

/**
 * The rate limits: per call and address, the times of the calls let through in the last minute
 * (a sliding log). Each call counts, whatever it answers; a `slow` answer adds no time, so a
 * client that asks too often is let in again a minute after its oldest call. Kept in memory: a
 * restart clears it. Once a minute, each key with no call in the last minute is deleted, so the
 * map holds only the addresses of the last two minutes.
 */
export const limiter = resource({
  label: "access.limiter",
  target: "scope",
  factory: () => {
    const seen = new Map<string, number[]>();
    let swept = 0;

    return {
      /** Counts one call: null when it may go on, else the ms until it may. */
      hit: (key: string, max: number, now: number) => {
        if (now - swept >= minute) {
          for (const [old, times] of seen) {
            if (!times.some((at) => at > now - minute)) seen.delete(old);
          }
          swept = now;
        }
        const recent = (seen.get(key) ?? []).filter((at) => at > now - minute);
        if (recent.length >= max) return (recent[0] ?? now) + minute - now;

        seen.set(key, [...recent, now]);
        return null;
      },
    };
  },
});

/** An IPv6 address's /64: its first four groups, `::` filled in, as `2001:db8:1:2::/64`. */
const prefix64 = operation({
  label: "access.prefix64",
  input: z.string(),
  run: (_, { input: plain }) => {
    const [head = "", tail = ""] = plain.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];

    return `${groups
      .slice(0, 4)
      .map((group) => Number.parseInt(group, 16).toString(16))
      .join(":")}::/64`;
  },
});

/**
 * The key an address is counted under: an IPv4 address as it is; an IPv6 one by its /64, the
 * block one host or home is given (RFC 6177), so a client cannot step to a new address each call.
 */
export const addressKey = operation({
  label: "access.addressKey",
  input: z.string(),
  depends: { prefix64 },
  run: ({ prefix64 }, { input: address }) => {
    const plain = address.split("%")[0] ?? "";
    if (isIP(plain) !== 6) return address;

    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(plain)?.[1];

    return mapped ?? prefix64.run({ input: plain });
  },
});

/** Counts the call against its address's limit: `slow` past it, else null. */
const admit = operation({
  label: "access.admit",
  input: z.enum(["login.start", "login.setup", "login.wait"]),
  depends: { limiter, clientAddress, addressKey },
  run: ({ limiter, clientAddress, addressKey }, { input, clock }) => {
    const retryIn = limiter.hit(
      `${input} ${addressKey.run({ input: clientAddress.run() })}`,
      limits[input],
      clock.currentTimeMillis(),
    );

    return retryIn === null ? null : { kind: "slow" as const, retryIn };
  },
});

/** A name or digest in use: a user has it, or a code that still waits carries it (judged rule 7). */
const inUse = operation({
  label: "access.inUse",
  input: z.object({ name: z.string(), digest: z.string() }),
  depends: { users: users.atScope.controller, logins: logins.atScope.controller },
  run: ({ users, logins }, { input, clock }) => {
    const now = clock.currentTimeMillis();
    const waiting = logins.get().filter((l) => l.state === "pending" && l.expiresAt > now);
    const held = [...users.get(), ...waiting];

    return held.some((row) => row.name === input.name || row.digest === input.digest);
  },
});

/** `slow` when 20 codes wait, or 3 from this address; null when one more may wait. */
const room = operation({
  label: "access.room",
  input: z.string(),
  depends: { logins: logins.atScope.controller },
  run: ({ logins }, { input: address, clock }) => {
    const now = clock.currentTimeMillis();
    const waiting = logins.get().filter((l) => l.state === "pending" && l.expiresAt > now);
    const mine = waiting.filter((l) => l.address === address);
    const full =
      waiting.length >= maxPending.all ? waiting : mine.length >= maxPending.address ? mine : [];
    if (!full.length) return null;

    return { kind: "slow" as const, retryIn: Math.min(...full.map((l) => l.expiresAt)) - now };
  },
});

/** A code no waiting login has: two waiting logins never share one. */
const freshCode = operation({
  label: "access.freshCode",
  depends: { logins: logins.atScope.controller, newCode },
  run: ({ logins, newCode }, { clock }) => {
    const now = clock.currentTimeMillis();
    const live = new Set(
      logins
        .get()
        .filter((l) => l.expiresAt > now)
        .map((l) => l.code),
    );
    let code = newCode.run();
    while (live.has(code)) code = newCode.run();

    return code;
  },
});

/**
 * `login.start`: a code for an owner to approve, or on an `open` server, `granted` at once as an
 * owner. The name is checked and taken with no `await` between (judged rule 7).
 */
export const startLogin = operation({
  label: "login.start.do",
  input: loginApi["login.start"].input,
  depends: { admit, inUse, room, freshCode, newRequest, clientAddress, store, mode },
  run: async (deps, { input, clock }) => {
    const { admit, inUse, room, freshCode, newRequest, clientAddress, store, mode } = deps;
    const slow = admit.run({ input: "login.start" });
    if (slow) return slow;

    if (inUse.run({ input })) return { kind: "taken" as const };

    const now = clock.currentTimeMillis();
    if (mode === "open") {
      const user = { name: input.name, role: "owner" as const, since: now };
      store.write({ users: [{ ...user, digest: input.digest }] });
      return { kind: "granted" as const, user };
    }

    const address = clientAddress.run();
    const full = room.run({ input: address });
    if (full) return full;

    const login = {
      ...input,
      request: newRequest.run(),
      code: freshCode.run(),
      address,
      since: now,
      expiresAt: now + codeLife,
      state: "pending" as const,
    };
    store.write({ logins: [login] });
    return {
      kind: "pending" as const,
      code: login.code,
      request: login.request,
      expiresAt: login.expiresAt,
    };
  },
});

/**
 * `login.setup`: the setup code from the log makes the first owner. Once there is a user it
 * answers `taken`; a code that is not the live one answers `wrong` (judged rule 4). Compared in
 * constant time.
 */
export const setupLogin = operation({
  label: "login.setup.do",
  input: loginApi["login.setup"].input,
  depends: {
    admit,
    inUse,
    store,
    users: users.atScope.controller,
    live: setupCode.atScope.controller,
  },
  run: async ({ admit, inUse, store, users, live }, { input, clock }) => {
    const slow = admit.run({ input: "login.setup" });
    if (slow) return slow;

    if (users.get().length) return { kind: "taken" as const };

    const code = live.get();
    const right = !!code && timingSafeEqual(Buffer.from(code), Buffer.from(input.code));
    if (!right) return { kind: "wrong" as const };

    if (inUse.run({ input })) return { kind: "taken" as const };

    const user = { name: input.name, role: "owner" as const, since: clock.currentTimeMillis() };
    store.write({ users: [{ ...user, digest: input.digest }], setupUsed: true });
    return { kind: "granted" as const, user };
  },
});

/**
 * What a login's code says now. `granted` while the user it made has the digest it carried, as
 * often as it is asked (judged rule 5); `denied` once it was denied, or its user was revoked or
 * logged out; `expired` past its time, or once it is no longer kept.
 */
const judge = operation({
  label: "access.judge",
  input: z.string(),
  depends: { users: users.atScope.controller, logins: logins.atScope.controller },
  run: ({ users, logins }, { input: request, clock }) => {
    const login = logins.of({ request }).get();
    if (!login) return { kind: "expired" as const };

    const user = users.of({ name: login.name }).get();
    switch (login.state) {
      case "approved":
        return user?.digest === login.digest
          ? {
              kind: "granted" as const,
              user: { name: user.name, role: user.role, since: user.since },
            }
          : { kind: "denied" as const };
      case "denied":
        return { kind: "denied" as const };
      case "pending":
        return login.expiresAt > clock.currentTimeMillis()
          ? { kind: "pending" as const }
          : { kind: "expired" as const };
    }
  },
});

/**
 * `login.wait`: what the code says, at once when it has ended; else it waits for a change to the
 * login, its expiry, or 50 s, whichever is first, and says it again. It carries no token.
 */
export const waitLogin = operation({
  label: "login.wait.do",
  input: loginApi["login.wait"].input,
  depends: {
    admit,
    judge,
    logins: logins.atScope.controller,
    stop: transport.requestStop.optional,
  },
  run: async ({ admit, judge, logins, stop }, { input, clock }) => {
    const slow = admit.run({ input: "login.wait" });
    if (slow) return slow;

    const now = judge.run({ input: input.request });
    if (now.kind !== "pending") return now;

    const expiresAt = logins.of(input).get()?.expiresAt ?? 0;
    const changed = Promise.withResolvers<void>();
    const quit = new AbortController();
    const unwatch = logins.of(input).watch(() => changed.resolve());
    const timeout = Math.min(waitMax, expiresAt - clock.currentTimeMillis());
    const signal = stop.present ? AbortSignal.any([quit.signal, stop.value]) : quit.signal;
    const slept = clock.sleep(timeout, signal).catch(() => undefined);

    await Promise.race([changed.promise, slept]).finally(() => (unwatch(), quit.abort()));
    return judge.run({ input: input.request });
  },
});

/** The server's side of `loginApi`, by address: `access.login({ implement: loginOps })`. */
export const loginOps = {
  "login.start": startLogin,
  "login.setup": setupLogin,
  "login.wait": waitLogin,
} as const;
