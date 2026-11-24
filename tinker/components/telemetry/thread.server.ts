import { operation, resource, tag } from "@tinkered/core";
import type { Capsule, Observe } from "@tinkered/core";
import { z } from "zod";

import { abortReasons } from "~/components/errors";

import { consoleOutput } from "./console";
import { exportHealth } from "./health";
import { telemetryRoute } from "./ingest.server";
import { workerThreads } from "./modules.server";
import { encodeValue, quiet } from "./records";
import type { Telemetry } from "./records";
import {
  healthSlowMs,
  healthSpans,
  logLevel,
  logsUrl,
  resourceAttributes,
  serviceVersion,
  spanHistory,
  telemetryService,
  telemetrySide,
  tracesUrl,
} from "./settings";

export const telemetryWorker = tag({
  label: "telemetry.worker",
  parse: z.instanceof(URL),
});

export type ThreadSettings = {
  service: string;
  traces: string | null;
  logs: string | null;
  fd: number | null;
  relay: boolean;
  version: string;
  resource: [string, string][];
};

export type ThreadMessage =
  | { ready: true }
  | { console: string }
  | { health: Telemetry.Health }
  | { flushed: number }
  | { final: Telemetry.Health };

export type ThreadRing = {
  data: Uint8Array;
  state: Int32Array;
  write(line: string): void;
  push(): void;
  stop(): void;
  dropped(): number;
  watch(listener: () => void): void;
};

export type ThreadWorker = {
  ready: Promise<void>;
  flush(): Promise<void>;
  close(publishFinal: boolean): Promise<void>;
};

export const threadRing = resource({
  label: "telemetry.ring",
  target: "scope",
  factory: (): ThreadRing => {
    const size = 1 << 22;
    const mask = size - 1;
    const data = new Uint8Array(new SharedArrayBuffer(size));
    const state = new Int32Array(new SharedArrayBuffer(8));
    const scratch = new Uint8Array(size);
    const encoder = new TextEncoder();

    let text = "";
    let lines = 0;
    let scheduled = false;
    let dropped = 0;
    let open = true;
    let dropping: (() => void) | undefined;

    const owned = {
      data,
      state,
      write(line: string) {
        if (!open) {
          dropped++;
          return;
        }

        text += line;
        text += "\n";
        lines++;
        if (!scheduled) {
          scheduled = true;
          setImmediate(owned.push);
        }
      },
      push: () => {
        scheduled = false;
        if (!lines) return;

        const { read, written } = encoder.encodeInto(text, scratch);
        const at = Atomics.load(state, 0);
        const unread = (at - Atomics.load(state, 1)) >>> 0;
        const free = size - unread;

        if (read < text.length || written > free) {
          dropped += lines;
          dropping?.();
        } else {
          const start = at & mask;
          const first = Math.min(written, size - start);
          data.set(scratch.subarray(0, first), start);
          if (first < written) data.set(scratch.subarray(first, written), 0);

          Atomics.store(state, 0, at + written);
          if (unread + written >= size >> 2) Atomics.notify(state, 0);
        }

        text = "";
        lines = 0;
      },
      stop() {
        owned.push();
        open = false;
      },
      dropped: () => dropped,
      watch(listener: () => void) {
        dropping = listener;
      },
    };
    return owned;
  },
});

export const telemetryThread = resource({
  label: "telemetry.thread",
  target: "scope",
  depends: {
    threads: workerThreads,
    ring: threadRing,
    module: telemetryWorker.required,
    service: telemetryService,
    tracesUrl: tracesUrl.optional,
    logsUrl: logsUrl.optional,
    console: consoleOutput,
    health: exportHealth.controller,
    version: serviceVersion,
    resource: resourceAttributes,
  },
  factory: async (
    { threads, ring, module, service, tracesUrl, logsUrl, console, health, version, resource },
    ctx,
  ): Promise<ThreadWorker> => {
    const fd = typeof console?.fd === "number" ? console.fd : null;
    const relay = console !== null && fd === null;
    const settings: ThreadSettings = {
      service,
      traces: tracesUrl.present ? tracesUrl.value.href : null,
      logs: logsUrl.present ? logsUrl.value.href : null,
      fd,
      relay,
      version,
      resource,
    };
    const worker = new threads.Worker(module, {
      name: "telemetry",
      execArgv: process.execArgv.some((flag) => flag.startsWith("--input-type"))
        ? process.execArgv.filter((flag) => !flag.startsWith("--input-type"))
        : undefined,
      workerData: { data: ring.data, state: ring.state, settings },
    });

    let open = true;
    let publishing = true;
    let final: Telemetry.Health | undefined;
    let last: Telemetry.Health = { kind: "idle", pending: 0, dropped: 0 };
    let closing: Promise<void> | undefined;
    const flushes = new Map<number, () => void>();
    let flushId = 0;
    const ready = Promise.withResolvers<void>();
    const exited = Promise.withResolvers<void>();
    void ready.promise.catch(() => {});

    const owned = {
      ready: ready.promise,
      receive(message: ThreadMessage) {
        if ("ready" in message) {
          worker.unref();
          ready.resolve();
        } else if ("health" in message) {
          owned.publish(message.health);
        } else if ("console" in message) {
          console?.write(message.console);
        } else if ("flushed" in message) {
          flushes.get(message.flushed)?.();
          flushes.delete(message.flushed);
        } else final = message.final;
      },
      publish(next: Telemetry.Health) {
        last = next;
        if (publishing) health.set({ ...next, dropped: next.dropped + ring.dropped() });
      },
      republish: () => owned.publish(last),
      stopped(failure: string) {
        open = false;
        ring.stop();
        owned.publish({ kind: "failed", failure, pending: 0, dropped: 0 });
      },
      exit() {
        ready.reject(new Error("Telemetry worker exited before ready"));
        if (open) owned.stopped("Telemetry worker exited");
        for (const done of flushes.values()) done();
        flushes.clear();
        exited.resolve();
      },
      flush() {
        ring.push();
        if (!open) return Promise.resolve();

        const id = flushId++;
        const done = new Promise<void>((resolve) => flushes.set(id, resolve));
        worker.postMessage({ flush: id });
        return done;
      },
      close(publishFinal: boolean) {
        return (closing ??= owned.shutdown(publishFinal));
      },
      async shutdown(publishFinal: boolean) {
        ring.stop();
        open = false;
        publishing = false;
        worker.ref();
        worker.postMessage({ close: true });

        const deadline = new AbortController();
        const alarm = ctx.clock.sleep(3000, deadline.signal).then(
          () => worker.terminate(),
          () => {},
        );
        await exited.promise;
        deadline.abort(abortReasons.done);
        await alarm;

        if (!publishFinal) return;
        const last = final ?? {
          kind: "failed" as const,
          failure: "Telemetry worker stopped before its final report",
          pending: 0,
          dropped: 0,
        };
        health.set({ ...last, dropped: last.dropped + ring.dropped() });
      },
    };

    ring.watch(owned.republish);
    worker.on("message", (message: ThreadMessage) => owned.receive(message));
    worker.on("error", (error) => {
      ready.reject(error);
      owned.stopped(`Telemetry worker stopped: ${String(error)}`);
    });
    worker.on("exit", () => owned.exit());

    ctx.defer(() => owned.close(!ctx.signal.aborted));
    return owned;
  },
});

const worker = { role: "worker", explain: "Sends telemetry from its own thread" } as const;

export const threadSink: Capsule.Hooks = {
  async start({ load, tap, next }) {
    await (
      await load(telemetryThread, worker, { ns: quiet })
    ).ready;
    tap(
      await load(
        threadObserver,
        { role: "state", explain: "Writes each record to the ring" },
        { ns: quiet },
      ),
    );
    await next();
  },
  async close({ load, next }) {
    await (await load(telemetryThread, worker, { ns: quiet })).close(true);
    return next();
  },
};

export const threadObserver = resource({
  label: "telemetry.threadObserver",
  depends: {
    thread: threadRing,
    side: telemetrySide,
    level: logLevel,
    history: spanHistory,
    encodeValue,
    healthSpans,
    slowMs: healthSlowMs,
  },
  factory: (
    { thread, side, level, history, encodeValue, healthSpans, slowMs },
    ctx,
  ): Observe.Config => {
    const health = new Set(healthSpans);
    const owned = {
      history,
      level,
      export(span: Observe.Span) {
        if (health.has(span.name) && owned.okAndFast(span)) return;
        const time = ctx.clock.currentTimeMillis();
        const entry = span.parentId === undefined ? 1 : 0;
        if (owned.plainSpan(span)) {
          try {
            thread.write(JSON.stringify(owned.spanLine(span, time, false, entry)));
            return;
          } catch {}
        }

        thread.write(JSON.stringify(owned.spanLine(span, time, true, entry)));
      },
      log(entry: Observe.Log) {
        if (owned.plain(entry.attributes)) {
          try {
            thread.write(JSON.stringify(owned.logLine(entry, false)));
            return;
          } catch {}
        }

        thread.write(JSON.stringify(owned.logLine(entry, true)));
      },
      okAndFast(span: Observe.Span) {
        return span.status !== "failed" && (span.end ?? span.start) - span.start < slowMs;
      },
      plainSpan(span: Observe.Span) {
        if (!owned.plain(span.attributes)) return false;
        for (let index = 0; index < span.events.length; index++) {
          if (!owned.plain(span.events[index]!.attributes)) return false;
        }
        return true;
      },
      plain(values: Record<string, unknown>) {
        for (const key in values) {
          const type = typeof values[key];
          if (type === "undefined" || type === "bigint" || type === "function") return false;
          if (type === "symbol") return false;
        }
        return true;
      },
      encodeAll(values: Record<string, unknown>) {
        const encoded: Record<string, string> = {};
        for (const key in values) encoded[key] = encodeValue.run({ input: values[key], ns: quiet });
        return encoded;
      },
      spanLine(span: Observe.Span, time: number, encoded: boolean, entry: 0 | 1): Telemetry.Wire {
        return [
          "s",
          side,
          time,
          encoded ? 1 : 0,
          span.traceId,
          span.spanId,
          span.parentSpanId ?? null,
          span.sampled,
          span.name,
          span.kind,
          span.start,
          span.end ?? null,
          span.status ?? null,
          span.status === "failed" ? String(span.error) : null,
          encoded ? owned.encodeAll(span.attributes) : span.attributes,
          encoded ? span.events.map((event) => owned.encodedEvent(event)) : span.events,
          entry,
        ];
      },
      encodedEvent(event: Observe.Event): Observe.Event {
        return {
          name: event.name,
          time: event.time,
          attributes: owned.encodeAll(event.attributes),
        };
      },
      logLine(entry: Observe.Log, encoded: boolean): Telemetry.Wire {
        return [
          "l",
          side,
          encoded ? 1 : 0,
          entry.level,
          entry.time,
          entry.span?.traceId ?? null,
          entry.span?.spanId ?? null,
          entry.message,
          encoded ? owned.encodeAll(entry.attributes) : entry.attributes,
        ];
      },
    };
    return owned;
  },
});

export const threadIngest = resource({
  label: "telemetry.threadIngest",
  target: "namespace",
  depends: { thread: threadRing, service: telemetryService },
  factory: ({ thread, service }) => ({
    ingest(this: void, batch: Telemetry.Batch) {
      for (const record of batch.logs) record.service = service;
      thread.write(JSON.stringify(["b", batch]));
    },
  }),
});

export const threadRoute = operation({
  ...telemetryRoute,
  label: "telemetry.threadRoute",
  depends: { ...telemetryRoute.depends, sink: threadIngest },
});
