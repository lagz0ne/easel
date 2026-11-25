import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { operation, resource, transport } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "./contract";
import { clientAddress } from "./guards.server";
import { callLimits, codeLife, maxPending, waitMax } from "./settings";
import {
  browserCodes,
  logins,
  mode,
  newCode,
  newRequest,
  setupCode,
  store,
  users,
} from "./store.server";

const minute = 60_000;

export const limiter = resource({
  label: "access.limiter",
  target: "scope",
  factory: () => {
    const seen = new Map<string, number[]>();
    let swept = 0;

    return {
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

export const admit = operation({
  label: "access.admit",
  input: z.enum([
    "login.start",
    "login.setup",
    "login.wait",
    "browser.start",
    "browser.wait",
    "browser.peek",
  ]),
  depends: { limiter, clientAddress, addressKey, limits: callLimits },
  run: ({ limiter, clientAddress, addressKey, limits }, { input, clock }) => {
    const retryIn = limiter.hit(
      `${input} ${addressKey.run({ input: clientAddress.run() })}`,
      limits[input],
      clock.currentTimeMillis(),
    );

    return retryIn === null ? null : { kind: "slow" as const, retryIn };
  },
});

export const inUse = operation({
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

export const nameInUse = operation({
  label: "access.nameInUse",
  input: z.string(),
  depends: {
    users: users.atScope.controller,
    logins: logins.atScope.controller,
    codes: browserCodes.atScope.controller,
  },
  run: ({ users, logins, codes }, { input: name, clock }) => {
    const now = clock.currentTimeMillis();
    const waits = (row: { state: string; expiresAt: number }) =>
      (row.state === "pending" || row.state === "approved") && row.expiresAt > now;
    const waiting = [...logins.get(), ...codes.get()].filter(waits);

    return !!users.of({ name }).get() || waiting.some((row) => row.name === name);
  },
});

export const room = operation({
  label: "access.room",
  input: z.object({ address: z.string(), from: z.enum(["cli", "browser"]) }),
  depends: {
    logins: logins.atScope.controller,
    codes: browserCodes.atScope.controller,
    maxPending,
  },
  run: ({ logins, codes, maxPending }, { input: { address, from }, clock }) => {
    const now = clock.currentTimeMillis();
    const held = from === "cli" ? logins.get() : codes.get();
    const waiting = held.filter((l) => l.state === "pending" && l.expiresAt > now);
    const mine = waiting.filter((l) => l.address === address);
    const full =
      waiting.length >= maxPending.all ? waiting : mine.length >= maxPending.address ? mine : [];
    if (!full.length) return null;

    return { kind: "slow" as const, retryIn: Math.min(...full.map((l) => l.expiresAt)) - now };
  },
});

export const freshCode = operation({
  label: "access.freshCode",
  depends: { logins: logins.atScope.controller, codes: browserCodes.atScope.controller, newCode },
  run: ({ logins, codes, newCode }, { clock }) => {
    const now = clock.currentTimeMillis();
    const live = new Set(
      [...logins.get(), ...codes.get()].filter((l) => l.expiresAt > now).map((l) => l.code),
    );
    let code = newCode.run();
    while (live.has(code)) code = newCode.run();

    return code;
  },
});

export const startLogin = operation({
  label: "login.start.do",
  input: loginApi["login.start"].input,
  depends: { admit, inUse, room, freshCode, newRequest, clientAddress, store, mode, codeLife },
  run: async (deps, { input, clock }) => {
    const { admit, inUse, room, freshCode, newRequest, clientAddress, store, mode } = deps;
    const slow = admit.run({ input: "login.start" });
    if (slow) return slow;

    if (mode === "single") return { kind: "single" as const };
    if (inUse.run({ input })) return { kind: "taken" as const };

    const now = clock.currentTimeMillis();
    if (mode === "open") {
      const user = { name: input.name, role: "owner" as const, since: now };
      store.write({ users: [{ ...user, digest: input.digest }] });
      return { kind: "granted" as const, user };
    }

    const address = clientAddress.run();
    const full = room.run({ input: { address, from: "cli" } });
    if (full) return full;

    const login = {
      ...input,
      request: newRequest.run(),
      code: freshCode.run(),
      address,
      since: now,
      expiresAt: now + deps.codeLife,
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

export const waitLogin = operation({
  label: "login.wait.do",
  input: loginApi["login.wait"].input,
  depends: {
    admit,
    judge,
    logins: logins.atScope.controller,
    stop: transport.requestStop.optional,
    waitMax,
  },
  run: async ({ admit, judge, logins, stop, waitMax }, { input, clock }) => {
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

export const loginOps = {
  "login.start": startLogin,
  "login.setup": setupLogin,
  "login.wait": waitLogin,
} as const;
