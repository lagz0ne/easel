import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";

import { capsule, operation, resource, tag, transport } from "@tinkered/core";
import type { Capsule, Scope } from "@tinkered/core";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { z } from "zod";

import { roles } from "./contract";
import { trusted, users } from "./store.server";

export const caller = tag<{ readonly name: string; readonly role: (typeof roles)[number] }>({
  label: "access.caller",
});

export const digestOf = operation({
  label: "access.digestOf",
  input: z.string(),
  run: (_, { input }) => createHash("sha256").update(input).digest("hex"),
});

const bearer = z.object({ authorization: z.string().regex(/^Bearer \S+$/) });

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

export const owner = operation({
  label: "access.owner",
  input: transport.hook.start,
  depends: { me: caller.required },
  run: ({ me }, { input }) => (me.role === "owner" ? undefined : input.refuse({ owner: true })),
});

export const peerHeader = "x-easel-peer";

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

const trustedPeer = operation({
  label: "access.trustedPeer",
  input: z.string(),
  depends: { list: trustedList },
  run: ({ list }, { input: peer }) =>
    isIP(peer) !== 0 && list.check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4"),
});

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

const loopbackOnly = tag<boolean>({ label: "accessDoor.loopbackOnly", default: false });

const loopback = new BlockList();
loopback.addSubnet("127.0.0.0", 8, "ipv4");
loopback.addAddress("::1", "ipv6");

const grace = tag<number>({ label: "accessDoor.grace", default: 8000 });

type DoorState = {
  sockets: Set<ServerWebSocket<unknown>>;
  server: Server<never> | null;
  stopping: boolean;
};

const doorState = resource({
  label: "accessDoor.state",
  target: "scope",
  factory: (): DoorState => ({ sockets: new Set(), server: null, stopping: false }),
});

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
    async close({ config, load, next }) {
      const held = await load(doorState, { role: "state", explain: "The door's live sockets" });
      held.stopping = true;
      for (const ws of held.sockets) ws.close(1001, "going away");

      const late = setTimeout(() => void held.server?.stop(true), config.grace);
      const result = await next();
      clearTimeout(late);

      return result;
    },
  },
});
