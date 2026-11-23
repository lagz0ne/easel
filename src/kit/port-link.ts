import { capsule, data, operation, resource, tag, transport } from "@tinkered/core";
import { z } from "zod";

// A Tinker backend over a MessagePort (SPEC-kit.md § The capsules, "A capsule across scopes"): a
// capsule served in one scope (`portServer`, with its services) is read and called from a scope
// in another realm, such as a sandboxed iframe (`portClient`). rpc and remoteData work over it as
// they work over `ws`: a call is one message and its reply; a watch is one message, then its
// pushes until it ends or the client stops it. Values go as text with the JSON codec, as over
// `ws`. The shape is the one of Tinker's `memory` backend; only the wire is a port. Prior art:
// Figma plugins (the UI iframe talks to the main thread by postMessage), and Comlink (an RPC over
// a MessagePort).

/** The messages on the port. A call and a watch carry an id that their answers repeat. */
const asked = { id: z.number(), address: z.string(), meta: z.record(z.string(), z.string()) };

const wire = z.discriminatedUnion("t", [
  z.object({ t: z.literal("call"), ...asked, execution: z.string().optional(), text: z.string() }),
  z.object({ t: z.literal("open"), ...asked, text: z.string() }),
  z.object({ t: z.literal("stop"), id: z.number() }),
  z.object({ t: z.literal("reply"), id: z.number(), text: z.string().nullable() }),
  z.object({ t: z.literal("push"), id: z.number(), text: z.string() }),
  z.object({ t: z.literal("end"), id: z.number(), ok: z.boolean() }),
  /** The server stopped serving the port: each call and watch on the way ends as a link fault. */
  z.object({ t: z.literal("gone") }),
]);

/** A reply, as the server's protocol makes it and the client's protocol reads it. */
const replyShape = z.union([
  z.object({
    ok: z.literal(true),
    value: z.unknown(),
    meta: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    ok: z.literal(false),
    kind: z.enum(["refused", "failed", "invalid", "encode", "decode", "missing", "link"]),
    payload: z.unknown(),
  }),
]);

/** A text that the JSON codec reads; anything else fails the parse. */
const jsonText = z.string().transform((text, ctx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    ctx.addIssue({ code: "custom", message: "not JSON" });
    return z.NEVER;
  }
});

/** A reply's text, read; a text that is not a reply is a decode fault of the client. */
const replyText = jsonText
  .pipe(replyShape)
  .catch({ ok: false as const, kind: "decode" as const, payload: { side: "client" } });

/** A value as the JSON codec writes it; undefined when it cannot (a BigInt, a cycle). */
const encoded = z.unknown().transform((value): string | undefined => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return undefined;
  }
});

const linkLost = transport.lost({ ok: false, kind: "link", sent: true });

// ---------- the client ----------

/** The port of the client: it can come after the scope starts (an iframe gets it on its hello). */
export const linkPort = tag<Promise<MessagePort>>({ label: "portLink.port" });

/** The meta of each call and watch, as `ws.client`'s: a bearer token, read on each one. */
const linkMeta = tag<transport.MetaOp>({ label: "portLink.meta" });

/** How a watch ends: stopped or ended by the server, no one serves it, or a value JSON cannot write. */
type Opened =
  | { ok: true }
  | { ok: false; kind: "missing"; payload: object }
  | { ok: false; kind: "link"; payload: { sent: boolean } };

type Watching = { push: (text: string) => void; end: (how: Opened) => void };

const watchLost = { ok: false, kind: "link", payload: { sent: true } } as const;

/** The client's calls and watches on the way, by id, and the port once it came. */
const waiting = resource({
  label: "portLink.waiting",
  target: "scope",
  depends: { port: linkPort.required },
  factory: ({ port }, ctx) => {
    const calls = new Map<number, (reply: transport.Reply) => void>();
    const watches = new Map<number, Watching>();
    const counter = { next: 1 };

    // Each answer of the server goes to its call or its watch, by id.
    const answers = {
      reply: (id: number, text: string | null) => {
        calls.get(id)?.(
          text === null ? transport.lost({ ok: false, kind: "missing" }) : replyText.parse(text),
        );
        calls.delete(id);
      },
      push: (id: number, text: string) => watches.get(id)?.push(text),
      end: (id: number, ok: boolean) => {
        watches.get(id)?.end(ok ? { ok: true } : { ok: false, kind: "missing", payload: {} });
        watches.delete(id);
      },
      gone: () => {
        for (const done of calls.values()) done(linkLost);
        for (const one of watches.values()) one.end(watchLost);
        calls.clear();
        watches.clear();
      },
    };
    const take = (event: MessageEvent) => {
      const got = wire.safeParse(event.data);
      if (!got.success) return;

      const m = got.data;
      if (m.t === "reply") answers.reply(m.id, m.text);
      if (m.t === "push") answers.push(m.id, m.text);
      if (m.t === "end") answers.end(m.id, m.ok);
      if (m.t === "gone") answers.gone();
    };

    const ready = port.then((open) => {
      open.addEventListener("message", take);
      open.start();
      return open;
    });
    ctx.defer(async () => {
      (await ready).removeEventListener("message", take);
      answers.gone();
    });
    return { calls, watches, counter, ready };
  },
});

/** A call out: one message, and its reply back; a stopped call is a `link` fault. */
const send = operation({
  label: "portLink.send",
  input: transport.callInput,
  depends: { link: waiting },
  run: ({ link }, { input, signal }): Promise<transport.Reply> => {
    const text = encoded.parse(input.value);
    if (text === undefined) {
      return Promise.resolve({ ok: false, kind: "encode", payload: { side: "client" } });
    }

    const id = link.counter.next++;
    const { address, meta, execution } = input;
    return new Promise((done) => {
      link.calls.set(id, done);
      signal?.addEventListener("abort", () => done(linkLost), { once: true });
      void link.ready.then((port) =>
        port.postMessage({ t: "call", id, address, meta, execution, text }),
      );
    });
  },
});

/** A watch out: one message, then each push, until the server ends it or the client stops it. */
const open = operation({
  label: "portLink.open",
  input: transport.watchInput,
  depends: { link: waiting },
  run: ({ link }, { input, signal }): Promise<Opened> => {
    const text = encoded.parse(input.value);
    if (text === undefined) {
      return Promise.resolve({ ok: false, kind: "link", payload: { sent: false } });
    }

    const id = link.counter.next++;
    const { address, meta } = input;
    return new Promise((done) => {
      const push = (pushed: string) => input.push(replyText.parse(pushed));
      link.watches.set(id, { push, end: done });

      const stop = () => {
        link.watches.delete(id);
        void link.ready.then((port) => port.postMessage({ t: "stop", id }));
        done({ ok: true });
      };
      for (const left of [input.left, signal]) {
        left?.addEventListener("abort", stop, { once: true });
      }
      void link.ready.then((port) => port.postMessage({ t: "open", id, address, meta, text }));
    });
  },
});

const clientCall: transport.Call = operation({
  label: "portLink.call",
  input: transport.callInput,
  run: () => {
    throw new Error("portLink: no client here");
  },
});

const clientWatch: transport.Watch = operation({
  label: "portLink.watch",
  input: transport.watchInput,
  run: () => {
    throw new Error("portLink: no client here");
  },
});

/** The client's side, as the protocol reads it. */
const clientSide = data<{ protocol: transport.Protocol; side: transport.ClientSide } | null>({
  label: "portLink.clientSide",
  initial: null,
});

/**
 * The client: rpc (`remote: portClient`) and remoteData (`read: portClient`) reach the services of
 * the scope at the other end of its port.
 */
export const portClient = capsule({
  label: "portLink.client",
  config: { port: linkPort.required, meta: linkMeta.optional },
  exports: { call: clientCall, watch: clientWatch },
  hooks: {
    async start({ config, load, next }) {
      const protocol = await load(transport.protocol, transport.kept);
      const meta = config.meta.present ? config.meta.value : undefined;
      load(clientSide, transport.kept).set({ protocol, side: { send, open, meta } });
      return next();
    },
    run(event) {
      // One name for each test: a type test narrows only the name that it tests.
      const [call, watch] = [event, event];
      const kept = event.load(clientSide, transport.kept).get();
      const hook = { run: event.run, log: event.log, signal: event.call?.signal };

      if (call.is(clientCall)) return kept?.protocol.callOver(kept.side, hook, call.input);
      if (watch.is(clientWatch)) return kept?.protocol.watchOver(kept.side, hook, watch.input);
      return event.next();
    },
  },
});

// ---------- the server ----------

const textIn = {
  address: z.string(),
  meta: z.record(z.string(), z.string()),
  execution: z.string().optional(),
  text: z.string(),
};

/** A call that came on a port: its text in, the reply's text out (null: no one serves it). */
const serveIn = z.object(textIn);

const serve = operation({
  label: "portLink.serve",
  input: serveIn,
  run: (): Promise<string | null> => {
    throw new Error("portLink: no server here");
  },
});

/** A watch that came on a port: each push as text, until `left`; false: no one serves it. */
const streamIn = z.object({
  ...textIn,
  push: z.custom<(text: string) => void>((v) => typeof v === "function"),
  left: z.custom<AbortSignal>((v) => v instanceof AbortSignal),
});

const serveStream = operation({
  label: "portLink.serveStream",
  input: streamIn,
  run: (): Promise<boolean> => {
    throw new Error("portLink: no server here");
  },
});

/**
 * Serves a port until `stop` aborts; it ends then. Each call and watch on it runs in a session of
 * this run, so the run lasts as the port does, as a server's `listen`.
 */
const acceptIn = z.object({
  port: z.custom<MessagePort>(
    (v) => typeof MessagePort !== "undefined" && v instanceof MessagePort,
  ),
  stop: z.custom<AbortSignal>((v) => v instanceof AbortSignal),
});

const accept = operation({
  label: "portLink.accept",
  input: acceptIn,
  run: (): Promise<void> => {
    throw new Error("portLink: no server here");
  },
});

const services = tag<readonly transport.Service[]>({ label: "portLink.services" });

const serverSide = data<{ protocol: transport.Protocol; side: transport.ServerSide } | null>({
  label: "portLink.serverSide",
  initial: null,
});

const sessionMeta = { role: "state", explain: "One call or watch that came on a port" } as const;

/** A reply as text: null when no one serves the address; an encode fault when JSON cannot. */
const answerText = z
  .custom<transport.Reply | null>()
  .transform((reply) =>
    reply === null
      ? null
      : (encoded.parse(reply) ??
        JSON.stringify({ ok: false, kind: "encode", payload: { side: "server" } })),
  );

const badText = JSON.stringify({ ok: false, kind: "decode", payload: { side: "server" } });

/**
 * The server: it serves its services on each port that `accept` gets. Each call and each watch
 * runs in its own session of the accept, as a request does over `ws` (`transport.request`).
 */
export const portServer = capsule({
  label: "portLink.server",
  config: { services: services.required },
  exports: { accept, serve, serveStream },
  hooks: {
    async start({ config, load, next, raise, log }) {
      const protocol = await load(transport.protocol, transport.kept);
      const routes = protocol.routesOf(
        config.services,
        (kind, payload) => raise(kind, Object(payload)),
        log,
        true,
      );

      load(serverSide, transport.kept).set({ protocol, side: { routes } });
      return next();
    },
    run(event) {
      const [port, one, many] = [event, event, event];
      const kept = event.load(serverSide, transport.kept).get();
      const hook = { run: event.run, log: event.log, signal: event.call?.signal };

      // A call: its text read, answered by the protocol, the reply as text.
      const answer = (input: z.infer<typeof serveIn>) => {
        const { text, ...asked } = input;
        const value = jsonText.safeParse(text);
        if (!kept || !value.success) return Promise.resolve(badText);

        return kept.protocol
          .answer(kept.side, hook, { ...asked, value: value.data })
          .then((reply) => answerText.parse(reply));
      };

      // A watch: its text read, each push as text, until `left`.
      const stream = (input: z.infer<typeof streamIn>) => {
        const { text, push, ...asked } = input;
        const value = jsonText.safeParse(text);
        if (!kept || !value.success) return Promise.resolve(push(badText)).then(() => true);

        return kept.protocol.stream(kept.side, hook, {
          ...asked,
          value: value.data,
          push: (reply) => push(answerText.parse(reply) ?? badText),
        });
      };

      // A port: each message on it, in a session of this run, until `stop`.
      const listen = ({ port: wire$, stop }: z.infer<typeof acceptIn>) => {
        const streams = new Map<number, AbortController>();
        const session = (address: string, signal: AbortSignal) => {
          const request = transport.request(new Request(`http://port.invalid/${address}`));
          return port.session({ tags: [request, transport.requestStop(signal)] }, sessionMeta);
        };
        const onCall = (m: Extract<z.infer<typeof wire>, { t: "call" }>) => {
          const { t: _, id, ...input } = m;
          const one = session(m.address, stop);
          void one
            .run(serve, { input })
            .then((text) => wire$.postMessage({ t: "reply", id, text }))
            .finally(() => one.close());
        };
        const onOpen = (m: Extract<z.infer<typeof wire>, { t: "open" }>) => {
          const { t: _, id, ...asked } = m;
          const left = new AbortController();
          const signal = AbortSignal.any([stop, left.signal]);
          const push = (text: string) => wire$.postMessage({ t: "push", id, text });
          const one = session(m.address, signal);
          streams.set(id, left);

          void one
            .run(serveStream, { input: { ...asked, push, left: signal } })
            .then((ok) => wire$.postMessage({ t: "end", id, ok }))
            .finally(() => {
              streams.delete(id);
              return one.close();
            });
        };
        const take = (got: MessageEvent) => {
          const read = wire.safeParse(got.data);
          if (!read.success) return;

          const m = read.data;
          if (m.t === "call") onCall(m);
          if (m.t === "open") onOpen(m);
          if (m.t === "stop") streams.get(m.id)?.abort();
        };

        wire$.addEventListener("message", take);
        wire$.start();
        return new Promise<void>((done) => {
          const end = () => {
            wire$.removeEventListener("message", take);
            for (const left of streams.values()) left.abort();
            wire$.postMessage({ t: "gone" });
            done();
          };
          stop.addEventListener("abort", end, { once: true });
        });
      };

      if (port.is(accept)) return listen(port.input);
      if (one.is(serve)) return answer(one.input);
      if (many.is(serveStream)) return stream(many.input);
      return event.next();
    },
  },
});
