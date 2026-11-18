import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

import { capsule, operation, resource, tag, transport } from "@tinkered/core";
import type { Capsule, Scope } from "@tinkered/core";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { z } from "zod";

import { roles } from "./contract";
import { trusted, users } from "./store.server";

// Who calls. `user` and `owner` are the guards every other module puts in `onStart`
// (SPEC-access.md, fact rules 1-2): `onStart: [user]`, or `onStart: [user, owner]`. After them,
// an operation reads the caller with `depends: { me: caller.required }`.

/** The user a call runs as, bound by `user`. */
export const caller = tag<{ readonly name: string; readonly role: (typeof roles)[number] }>({
  label: "access.caller",
});

/** A token's digest: the SHA-256 of its text, as hex. The CLI sends this with a login. */
export const digestOf = operation({
  label: "access.digestOf",
  input: z.string(),
  run: (_, { input }) => createHash("sha256").update(input).digest("hex"),
});

/** The bearer token a call carries in its meta (RFC 6750's `Authorization: Bearer`). */
const bearer = z.object({ authorization: z.string().regex(/^Bearer \S+$/) });

/**
 * Every user call and read: the token in its meta must be a live user's. Each live digest is
 * compared in constant time, and every one is compared, so the time says nothing of which
 * matched (judged rule 1). It reads the users cell on each call, so a revoke refuses the next
 * call at once (judged rule 8). No token, or a dead one: refused `{ signIn: true }`.
 */
export const user = operation({
  label: "access.user",
  input: transport.hook.start,
  depends: { all: users.atScope.controller, digestOf },
  run: ({ all, digestOf }, { input }) => {
    const sent = bearer.safeParse(input.meta).data?.authorization.slice("Bearer ".length);
    const mine = Buffer.from(digestOf.run({ input: sent ?? "" }));

    let found: { name: string; role: (typeof roles)[number] } | undefined;
    for (const row of all.get()) {
      const same = timingSafeEqual(mine, Buffer.from(row.digest));
      if (same && sent) found = { name: row.name, role: row.role };
    }

    return found ? { tags: [caller(found)] } : input.refuse({ signIn: true });
  },
});

/** Every owner call, after `user`: a member is refused `{ owner: true }`. */
export const owner = operation({
  label: "access.owner",
  input: transport.hook.start,
  depends: { me: caller.required },
  run: ({ me }, { input }) => (me.role === "owner" ? undefined : input.refuse({ owner: true })),
});

/** The header the socket's door writes with the peer's address. A client's own is overwritten. */
export const peerHeader = "x-easel-peer";

/** `trusted`'s CIDRs as one list, built once per scope; `accessEnv` has checked each. */
const trustedList = resource({
  label: "access.trustedList",
  target: "scope",
  depends: { trusted },
  factory: ({ trusted }) => {
    const list = new BlockList();
    for (const cidr of trusted) {
      const [net = "", bits = isIP(net) === 6 ? "128" : "32"] = cidr.split("/");
      list.addSubnet(net, Number(bits), isIP(net) === 6 ? "ipv6" : "ipv4");
    }

    return list;
  },
});

/** True when the address is a trusted proxy: an IP address inside one of `trusted`'s CIDRs. */
const trustedPeer = operation({
  label: "access.trustedPeer",
  input: z.string(),
  depends: { list: trustedList },
  run: ({ list }, { input: peer }) =>
    isIP(peer) !== 0 && list.check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4"),
});

/**
 * The client's address, for the rate limits (SPEC.md rule 4). The peer the socket saw, unless it
 * is a trusted proxy; then `X-Forwarded-For` is read from the right, each trusted proxy skipped,
 * and the first address that is not one is the client (nginx's `real_ip_recursive on`). With
 * Cloudflare in front of Traefik, Traefik adds Cloudflare's edge last, and the env trusts it. When
 * every entry is trusted, the leftmost is the client. An entry the client wrote itself sits left
 * of the first untrusted one, so it is never read.
 */
export const clientAddress = operation({
  label: "access.clientAddress",
  depends: { req: transport.request.optional, trustedPeer },
  run: ({ req, trustedPeer }) => {
    const headers = req.present ? req.value.headers : new Headers();
    const peer = headers.get(peerHeader) ?? "local";
    if (!trustedPeer.run({ input: peer })) return peer;

    const hops = (headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const client = hops.findLast((hop) => !trustedPeer.run({ input: hop }));

    return client ?? hops[0] ?? peer;
  },
});

/** What `serve` asks: Bun's `{ fetch, websocket }` shape. */
type Door = {
  fetch: (
    request: Request,
    scope: Scope.Handle,
    server: Server<never>,
  ) => Response | null | undefined | Promise<Response | null | undefined>;
  websocket?: WebSocketHandler<unknown>;
  maxBody?: number;
};

const inner = tag<Capsule.Binding<Door, unknown>>({ label: "accessDoor.inner" });

/** Only loopback peers may call rpc: an `open` server is for one person on their own machine. */
const loopbackOnly = tag<boolean>({ label: "accessDoor.loopbackOnly", default: false });

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

/** How long a stop may take before every connection is cut: under Docker's 10 s to SIGKILL. */
const grace = tag<number>({ label: "accessDoor.grace", default: 8000 });

/** The door's live sockets, its server once a request named it, and whether it stops. */
type DoorState = {
  sockets: Set<ServerWebSocket<unknown>>;
  server: Server<never> | null;
  stopping: boolean;
};

/** The door's state, one per scope: its start fills it, its close reads it. */
const doorState = resource({
  label: "accessDoor.state",
  target: "scope",
  factory: (): DoorState => ({ sockets: new Set(), server: null, stopping: false }),
});

/**
 * The socket's door, around `ws.server`: it writes the peer's address on each request, so
 * `clientAddress` reads it, and in `open` it refuses every rpc call (`/rpc`, `/rpc/*`) from a peer
 * that is not this machine (judged rule 12). Pages, `/api/health` and `/api/version` stay
 * readable. Tinker's `serve` takes no hostname, so it cannot listen on 127.0.0.1 alone; this is
 * the stand-in until it does.
 *
 * A stop drains (SPEC-ops judged rule 8; Go's `Shutdown` with `RegisterOnShutdown`): the door
 * refuses new requests and sockets with 503, closes each socket with 1001 "going away", so a tab
 * reads a drop and reconnects, and cuts every connection once `grace` runs out.
 * Install: `serve({ websocket: door })`, with `door` before `socket` in `capsules`, so its close
 * runs before `serve`'s.
 */
export const accessDoor = capsule({
  label: "accessDoor",
  config: { inner: inner.required, loopbackOnly, grace },
  hooks: {
    async start({ config, next, session, load }): Promise<Door> {
      await next();
      const scope = session({}, { role: "handler", explain: "Reads the socket's door" });
      const door = scope.resolve(config.inner);
      const peers: Door = {
        ...door,
        fetch: (request, scope, server) => {
          const ip = server.requestIP(request);
          const peer = ip?.address ?? "";
          const local = !!ip && loopback.check(peer, ip.family === "IPv6" ? "ipv6" : "ipv4");
          const rpc = /^\/rpc(\/|$)/.test(new URL(request.url).pathname);
          if (config.loopbackOnly && rpc && !local) return new Response(null, { status: 403 });

          request.headers.set(peerHeader, peer);
          return door.fetch(request, scope, server);
        },
      };

      // easel diverges from upstream 0.30.1: the door keeps each socket and the server, so its
      // close can drain them (below). Remove with that hook.
      const held = await load(doorState, { role: "state", explain: "The door's live sockets" });
      const inbound = door.websocket;

      return {
        ...peers,
        websocket: inbound && {
          ...inbound,
          open: (ws) => (held.sockets.add(ws), inbound.open?.(ws)),
          close: (ws, code, reason) => (held.sockets.delete(ws), inbound.close?.(ws, code, reason)),
        },
        fetch: (request, scope, server) => {
          held.server = server;
          return held.stopping
            ? new Response(null, { status: 503 })
            : peers.fetch(request, scope, server);
        },
      };
    },
    // easel diverges from upstream 0.30.1: `serve`'s close awaits `server.stop()`, which waits for
    // every open socket, and a socket never ends by itself, so a SIGTERM hung until SIGKILL. And the
    // scope's close ended each live read cleanly, so a tab never knew to reconnect. Remove this hook
    // once `serve` drains as it does.
    async close({ config, load, next }) {
      const held = await load(doorState, { role: "state", explain: "The door's live sockets" });
      held.stopping = true;
      for (const ws of held.sockets) ws.close(1001, "going away");

      // A timer, not a run: the root's close waits for every run, so a run would wait on itself.
      const late = setTimeout(() => void held.server?.stop(true), config.grace);
      const result = await next();
      clearTimeout(late);

      return result;
    },
  },
});
