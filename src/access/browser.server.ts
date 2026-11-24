import { operation, transport } from "@tinkered/core";
import { z } from "zod";

import {
  browserApi,
  openApi,
  request as requestShape,
  sessionCookie,
  signInLink,
} from "./contract";
import { caller, clientAddress, cookieSecret, digestOf } from "./guards.server";
import { admit, codeLife, freshCode, room, waitMax } from "./login.server";
import {
  browserCodes,
  mode,
  newRequest,
  origin,
  secretBytes,
  sessions,
  store,
  users,
} from "./store.server";

export const linkLife = 5 * 60_000;

export const cookieLife = 400 * 24 * 60 * 60;

export const maxFormBytes = 4096;

const hexOf = operation({
  label: "access.hexOf",
  input: z.number().int().positive(),
  depends: { bytes: secretBytes },
  run: ({ bytes }, { input }) => Buffer.from(bytes.run({ input })).toString("hex"),
});

export const startBrowser = operation({
  label: "browser.start.do",
  input: browserApi["browser.start"].input,
  depends: {
    admit,
    room,
    freshCode,
    newRequest,
    clientAddress,
    store,
    mode,
    digestOf,
    hexOf,
    users: users.atScope.controller,
  },
  run: async (deps, { input, clock }) => {
    const { admit, room, freshCode, newRequest, clientAddress, store, mode } = deps;
    const slow = admit.run({ input: "browser.start" });
    if (slow) return slow;

    const name = mode === "single" ? "" : input.name;
    if (name === undefined) return { kind: "name" as const };

    const address = clientAddress.run();
    const full = room.run({ input: { address, from: "browser" } });
    if (full) return full;

    const now = clock.currentTimeMillis();
    const code = {
      request: newRequest.run(),
      code: freshCode.run(),
      name,
      address,
      since: now,
      expiresAt: now + codeLife,
      state: mode === "open" ? ("approved" as const) : ("pending" as const),
    };
    const unusable = deps.digestOf.run({ input: deps.hexOf.run({ input: 32 }) });
    const owner = { name, role: "owner" as const, since: now, digest: unusable };
    const made = mode === "open" && !deps.users.of({ name }).get();
    store.write({ codes: [code], ...(made ? { users: [owner] } : {}) });
    return {
      kind: "pending" as const,
      code: code.code,
      request: code.request,
      expiresAt: code.expiresAt,
    };
  },
});

const judgeCode = operation({
  label: "access.judgeCode",
  input: z.string(),
  depends: { codes: browserCodes.atScope.controller, users: users.atScope.controller },
  run: ({ codes, users }, { input: request, clock }) => {
    const code = codes.of({ request }).get();
    if (!code || code.expiresAt <= clock.currentTimeMillis()) return { kind: "expired" as const };

    switch (code.state) {
      case "approved":
        return users.of({ name: code.name }).get()
          ? { kind: "approved" as const }
          : { kind: "denied" as const };
      case "pending":
        return { kind: "pending" as const };
      case "denied":
        return { kind: "denied" as const };
      case "used":
        return { kind: "expired" as const };
    }
  },
});

export const waitBrowser = operation({
  label: "browser.wait.do",
  input: browserApi["browser.wait"].input,
  depends: {
    admit,
    judgeCode,
    codes: browserCodes.atScope.controller,
    stop: transport.requestStop.optional,
  },
  run: async ({ admit, judgeCode, codes, stop }, { input, clock }) => {
    const slow = admit.run({ input: "browser.wait" });
    if (slow) return slow;

    const now = judgeCode.run({ input: input.request });
    if (now.kind !== "pending") return now;

    const expiresAt = codes.of(input).get()?.expiresAt ?? 0;
    const changed = Promise.withResolvers<void>();
    const quit = new AbortController();
    const unwatch = codes.of(input).watch(() => changed.resolve());
    const timeout = Math.min(waitMax, expiresAt - clock.currentTimeMillis());
    const signal = stop.present ? AbortSignal.any([quit.signal, stop.value]) : quit.signal;
    const slept = clock.sleep(timeout, signal).catch(() => undefined);

    await Promise.race([changed.promise, slept]).finally(() => (unwatch(), quit.abort()));
    return judgeCode.run({ input: input.request });
  },
});

export const makeLink = operation({
  label: "browser.link.do",
  input: openApi["browser.link"].input,
  depends: { me: caller.required, store, hexOf, digestOf },
  run: async ({ me, store, hexOf, digestOf }, { clock }) => {
    const link = hexOf.run({ input: 32 });
    const expiresAt = clock.currentTimeMillis() + linkLife;
    store.write({ links: [{ digest: digestOf.run({ input: link }), name: me.name, expiresAt }] });

    return { kind: "link" as const, link, expiresAt };
  },
});

export const peekLink = operation({
  label: "browser.peek.do",
  input: browserApi["browser.peek"].input,
  depends: { admit, store, digestOf },
  run: async ({ admit, store, digestOf }, { input, clock }) => {
    const slow = admit.run({ input: "browser.peek" });
    if (slow) return slow;

    const live = store.liveLink(digestOf.run({ input: input.link }), clock.currentTimeMillis());
    if (live === null) return { kind: "gone" as const };

    return { kind: "live" as const, name: live.name, expiresAt: live.expiresAt };
  },
});

export const browserOps = {
  "browser.start": startBrowser,
  "browser.wait": waitBrowser,
  "browser.peek": peekLink,
} as const;

export const openOps = { "browser.link": makeLink } as const;

const browsers = [
  ["Edg/", "Edge"],
  ["Firefox/", "Firefox"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
] as const;

const systems = [
  ["Android", "Android"],
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Mac OS X", "macOS"],
  ["Windows", "Windows"],
  ["Linux", "Linux"],
] as const;

export const browserOf = operation({
  label: "access.browserOf",
  input: z.string().nullable(),
  run: (_, { input }) => {
    const agent = input ?? "";
    const browser = browsers.find(([mark]) => agent.includes(mark))?.[1];
    const system = systems.find(([mark]) => agent.includes(mark))?.[1];
    if (browser && system) return `${browser} on ${system}`;

    return browser ?? system ?? "a browser";
  },
});

const page = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

const goTo = operation({
  label: "access.goTo",
  input: z.object({ to: z.string(), cookie: z.string().optional() }),
  run: (_, { input }) =>
    new Response(null, {
      status: 303,
      headers: {
        ...page,
        location: input.to,
        ...(input.cookie ? { "set-cookie": input.cookie } : {}),
      },
    }),
});

const formOf = operation({
  label: "access.formOf",
  depends: { request: transport.request.required, origin },
  run: async ({ request, origin }) => {
    const own = origin ?? new URL(request.url).origin;
    const site = request.headers.get("sec-fetch-site");
    const sameOrigin =
      site === null ? request.headers.get("origin") === own : site === "same-origin";
    if (!sameOrigin) return new Response(null, { status: 403, headers: page });

    const size = Number(request.headers.get("content-length") ?? maxFormBytes + 1);
    if (!(size <= maxFormBytes)) return new Response(null, { status: 413, headers: page });

    return new URLSearchParams(await request.text());
  },
});

const newSession = operation({
  label: "access.newSession",
  depends: { request: transport.request.required, hexOf, digestOf, browserOf },
  run: ({ request, hexOf, digestOf, browserOf }, { clock }) => {
    const secret = hexOf.run({ input: 32 });
    const now = clock.currentTimeMillis();
    const browser = browserOf.run({ input: request.headers.get("user-agent") });
    const cookie = `${sessionCookie}=${secret}; Path=/; Max-Age=${cookieLife}; HttpOnly; Secure; SameSite=Lax`;

    return {
      cookie,
      session: {
        id: hexOf.run({ input: 6 }),
        digest: digestOf.run({ input: secret }),
        browser,
        since: now,
        used: now,
      },
    };
  },
});

export const signInWithCode = operation({
  label: "auth.code",
  depends: { formOf, newSession, store, goTo },
  run: async ({ formOf, newSession, store, goTo }, { clock }) => {
    const form = await formOf.run();
    if (form instanceof Response) return form;

    const code = requestShape.safeParse(form.get("request"));
    if (!code.success) return goTo.run({ input: { to: "/" } });

    const made = newSession.run();
    const used = store.use({ code: code.data, session: made.session }, clock.currentTimeMillis());

    return goTo.run({ input: used ? { to: "/", cookie: made.cookie } : { to: "/" } });
  },
});

export const signInWithLink = operation({
  label: "auth.open",
  depends: { formOf, newSession, store, goTo, digestOf },
  run: async ({ formOf, newSession, store, goTo, digestOf }, { clock }) => {
    const form = await formOf.run();
    if (form instanceof Response) return form;

    const link = signInLink.safeParse(form.get("link"));
    if (!link.success) return goTo.run({ input: { to: "/open" } });

    const made = newSession.run();
    const digest = digestOf.run({ input: link.data });
    const used = store.use({ link: digest, session: made.session }, clock.currentTimeMillis());

    return goTo.run({ input: used ? { to: "/", cookie: made.cookie } : { to: "/open" } });
  },
});

const endedCookie = `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export const signOut = operation({
  label: "auth.out",
  depends: {
    formOf,
    request: transport.request.required,
    cookieSecret,
    digestOf,
    held: sessions.atScope.controller,
    store,
    goTo,
  },
  run: async ({ formOf, request, cookieSecret, digestOf, held, store, goTo }) => {
    const form = await formOf.run();
    if (form instanceof Response) return form;

    const secret = cookieSecret.run({ input: request.headers.get("cookie") });
    const row =
      secret === null ? undefined : held.of({ digest: digestOf.run({ input: secret }) }).get();
    if (row) store.write({ endSessions: [row.id] });

    return goTo.run({ input: { to: "/", cookie: endedCookie } });
  },
});
