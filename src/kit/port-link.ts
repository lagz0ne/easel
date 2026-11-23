import { capsule, data, operation, resource, tag, transport } from "@tinkered/core";
import { z } from "zod";

const asked = { id: z.number(), address: z.string(), meta: z.record(z.string(), z.string()) };

const wire = z.discriminatedUnion("t", [
  z.object({ t: z.literal("call"), ...asked, execution: z.string().optional(), text: z.string() }),
  z.object({ t: z.literal("open"), ...asked, text: z.string() }),
  z.object({ t: z.literal("stop"), id: z.number() }),
  z.object({ t: z.literal("reply"), id: z.number(), text: z.string().nullable() }),
  z.object({ t: z.literal("push"), id: z.number(), text: z.string() }),
  z.object({ t: z.literal("end"), id: z.number(), ok: z.boolean() }),
  z.object({ t: z.literal("gone") }),
]);

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

const jsonText = z.string().transform((text, ctx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    ctx.addIssue({ code: "custom", message: "not JSON" });
    return z.NEVER;
  }
});

const replyText = jsonText
  .pipe(replyShape)
  .catch({ ok: false as const, kind: "decode" as const, payload: { side: "client" } });

const encoded = z.unknown().transform((value): string | undefined => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return undefined;
  }
});

const linkLost = transport.lost({ ok: false, kind: "link", sent: true });

export const linkPort = tag<Promise<MessagePort>>({ label: "portLink.port" });

const linkMeta = tag<transport.MetaOp>({ label: "portLink.meta" });

type Opened =
  | { ok: true }
  | { ok: false; kind: "missing"; payload: object }
  | { ok: false; kind: "link"; payload: { sent: boolean } };

type Watching = { push: (text: string) => void; end: (how: Opened) => void };

const watchLost = { ok: false, kind: "link", payload: { sent: true } } as const;

const waiting = resource({
  label: "portLink.waiting",
  target: "scope",
  depends: { port: linkPort.required },
  factory: ({ port }, ctx) => {
    const calls = new Map<number, (reply: transport.Reply) => void>();
    const watches = new Map<number, Watching>();
    const counter = { next: 1 };

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

const clientSide = data<{ protocol: transport.Protocol; side: transport.ClientSide } | null>({
  label: "portLink.clientSide",
  initial: null,
});

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
      const [call, watch] = [event, event];
      const kept = event.load(clientSide, transport.kept).get();
      const hook = { run: event.run, log: event.log, signal: event.call?.signal };

      if (call.is(clientCall)) return kept?.protocol.callOver(kept.side, hook, call.input);
      if (watch.is(clientWatch)) return kept?.protocol.watchOver(kept.side, hook, watch.input);
      return event.next();
    },
  },
});

const textIn = {
  address: z.string(),
  meta: z.record(z.string(), z.string()),
  execution: z.string().optional(),
  text: z.string(),
};

const serveIn = z.object(textIn);

const serve = operation({
  label: "portLink.serve",
  input: serveIn,
  run: (): Promise<string | null> => {
    throw new Error("portLink: no server here");
  },
});

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

const answerText = z
  .custom<transport.Reply | null>()
  .transform((reply) =>
    reply === null
      ? null
      : (encoded.parse(reply) ??
        JSON.stringify({ ok: false, kind: "encode", payload: { side: "server" } })),
  );

const badText = JSON.stringify({ ok: false, kind: "decode", payload: { side: "server" } });

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

      const answer = (input: z.infer<typeof serveIn>) => {
        const { text, ...asked } = input;
        const value = jsonText.safeParse(text);
        if (!kept || !value.success) return Promise.resolve(badText);

        return kept.protocol
          .answer(kept.side, hook, { ...asked, value: value.data })
          .then((reply) => answerText.parse(reply));
      };

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
