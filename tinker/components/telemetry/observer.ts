import { LEVELS, operation, resource } from "@tinkered/core";
import type { Capsule, Observe } from "@tinkered/core";

import { consoleSpans, logConsole } from "./console";
import { queue } from "./queue";
import { encodeValue, interactionLine, quiet, spanBody } from "./records";
import type { Telemetry } from "./records";
import {
  healthSlowMs,
  healthSpans,
  logLevel,
  spanHistory,
  tabErrorSource,
  telemetryService,
  telemetrySide,
} from "./settings";

export const ingestTelemetry = operation({
  label: "telemetry.ingest",
  depends: { queue },
  input: (raw: unknown) => raw as Telemetry.Batch,
  run: ({ queue }, ctx) => queue.ingest(ctx.input),
});

export const flushTelemetry = operation({
  label: "telemetry.export",
  depends: { queue },
  run: ({ queue }) => queue.flush(),
});

const held = { role: "state", explain: "Holds spans and logs until a flush" } as const;
const sends = { role: "worker", explain: "Sends queued records" } as const;

export const queueSend: Capsule.Hooks = {
  async start({ load, run, next }) {
    const owned = await load(queue, held, { ns: quiet });
    owned.start(() => run(flushTelemetry, { ns: quiet }, sends));
    await next();
  },
  async close({ load, next }) {
    await (await load(queue, held, { ns: quiet })).close(true);
    return next();
  },
};

export const queueSink: Capsule.Hooks = {
  ...queueSend,
  async start(event) {
    event.tap(
      await event.load(observer, { role: "state", explain: "Queues each record" }, { ns: quiet }),
    );
    const owned = await event.load(queue, held, { ns: quiet });
    owned.start(() => event.run(flushTelemetry, { ns: quiet }, sends));
    await event.next();
  },
};

export const observer = resource({
  label: "telemetry.observer",
  depends: {
    queue,
    service: telemetryService,
    side: telemetrySide,
    level: logLevel,
    history: spanHistory,
    show: logConsole,
    showSpans: consoleSpans,
    encodeValue,
    spanBody,
    interactionLine,
    healthSpans,
    slowMs: healthSlowMs,
  },
  factory: (
    {
      queue,
      service,
      side,
      level,
      history,
      show,
      showSpans,
      encodeValue,
      spanBody,
      interactionLine,
      healthSpans,
      slowMs,
    },
    ctx,
  ): Observe.Config => {
    const health = new Set(healthSpans);
    return {
      history,
      level,
      export(span) {
        const fast = Number(span.end) - span.start < slowMs;
        if (fast && span.status !== "failed" && health.has(span.name)) return;
        queue.addSpan(side, spanBody.run({ input: { span, encoded: false }, ns: quiet }));

        const record: Telemetry.Log = {
          level: LEVELS.info,
          time: ctx.clock.currentTimeMillis(),
          service,
          side,
          traceId: span.traceId,
          spanId: span.spanId,
          attributes: undefined,
          msg: "core.span",
        };
        if (side !== "browser") queue.writeConsole(record);
        else if (showSpans) show?.info(record);

        const line = interactionLine.run({
          input: { span, entry: span.parentId === undefined, service, side },
          ns: quiet,
        });
        if (line) queue.addLog(side, line);

        queue.publishQueued();
      },
      log(entry) {
        const record: Telemetry.Log = {
          level: entry.level,
          time: entry.time,
          service,
          side,
          traceId: entry.span?.traceId,
          spanId: entry.span?.spanId,
          attributes: Object.fromEntries(
            Object.entries(entry.attributes).map(([key, value]) => [
              key.slice(0, 256),
              encodeValue.run({ input: value, ns: quiet }),
            ]),
          ),
          msg: entry.message.slice(0, 2048),
        };
        const clean = queue.addLog(side, record);
        if (side !== "browser") queue.writeConsole(clean);
        else if (!show) {
        } else if (record.level >= LEVELS.error) show.error(record);
        else if (record.level >= LEVELS.warn) show.warn(record);
        else show.info(record);
        queue.publishQueued();
      },
    };
  },
});

export const tabErrors = resource({
  label: "telemetry.tabErrors",
  target: "scope",
  depends: { queue, source: tabErrorSource, service: telemetryService, encodeValue },
  factory: ({ queue, source, service, encodeValue }, ctx) => {
    if (!source) return;
    const stop = new AbortController();
    for (const type of ["error", "unhandledrejection"] as const) {
      source.addEventListener(
        type,
        (event) => {
          const thrown =
            type === "error"
              ? (Object(event).error ?? Object(event).message)
              : Object(event).reason;
          const plain = thrown instanceof Error;
          const record: Telemetry.Log = {
            level: LEVELS.error,
            time: ctx.clock.currentTimeMillis(),
            service,
            side: "browser",
            traceId: undefined,
            spanId: undefined,
            attributes: {
              name: encodeValue.run({ input: plain ? thrown.name : "Error", ns: quiet }),
              message: encodeValue.run({
                input: plain ? thrown.message : String(thrown),
                ns: quiet,
              }),
            },
            msg: "tab error",
          };
          queue.addLog("browser", record);
          queue.publishQueued();
        },
        { signal: stop.signal },
      );
    }
    ctx.defer(() => stop.abort());
  },
});

export const tabSink: Capsule.Hooks = {
  ...queueSink,
  async start(event) {
    event.tap(
      await event.load(observer, { role: "state", explain: "Queues each record" }, { ns: quiet }),
    );
    const owned = await event.load(queue, held, { ns: quiet });
    owned.start(() => event.run(flushTelemetry, { ns: quiet }, sends));
    await event.load(
      tabErrors,
      { role: "state", explain: "Queues each uncaught error of the tab" },
      { ns: quiet },
    );
    await event.next();
  },
};
