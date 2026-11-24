import { LEVELS, resource } from "@tinkered/core";

import { exportHealth } from "./health";
import { queue } from "./queue";
import { encodeValue, interactionLine, quiet, spanBody } from "./records";
import type { Telemetry } from "./records";
import { telemetryService } from "./settings";

type SpanLine = Extract<Telemetry.Wire, [tag: "s", ...rest: unknown[]]>;
type LogLine = Extract<Telemetry.Wire, [tag: "l", ...rest: unknown[]]>;

export const threadDrain = resource({
  label: "telemetry.drain",
  depends: {
    queue,
    service: telemetryService,
    health: exportHealth.controller,
    encodeValue,
    spanBody,
    interactionLine,
  },
  factory: ({ queue, service, health, encodeValue, spanBody, interactionLine }, ctx) => {
    let bad = 0;
    let changes = 0;
    let reported = -1;
    let changed: (() => void) | undefined;

    ctx.defer(
      health.watch((next, previous) => {
        if (next.kind === previous.kind) return;
        changes++;
        changed?.();
      }),
    );

    const owned = {
      watch(listener: () => void) {
        changed = listener;
      },
      health(): Telemetry.Health {
        const current = health.get();
        return { ...current, dropped: current.dropped + bad };
      },
      report() {
        if (changes === reported) return undefined;
        reported = changes;
        return owned.health();
      },
      flush() {
        return queue.flush();
      },
      async close() {
        await queue.close(true);
        return owned.health();
      },
      take(line: string) {
        let wire: Telemetry.Wire;
        try {
          wire = JSON.parse(line) as Telemetry.Wire;
        } catch {
          bad++;
          return;
        }

        if (wire[0] === "b") queue.ingest(wire[1]);
        else if (wire[0] === "s") owned.span(wire);
        else owned.log(wire);
      },
      span(wire: SpanLine) {
        const [, side, time, encoded, traceId, spanId, parentSpanId, sampled, name, kind] = wire;
        const [, , , , , , , , , , start, end, status, error, attributes, events, entry] = wire;
        const span: Telemetry.SpanFields = {
          traceId,
          spanId,
          parentSpanId: parentSpanId ?? undefined,
          sampled,
          name,
          kind,
          start,
          end: end ?? undefined,
          status: status ?? undefined,
          error: error ?? undefined,
          attributes,
          events,
        };
        queue.addSpan(side, spanBody.run({ input: { span, encoded: encoded === 1 }, ns: quiet }));

        const record: Telemetry.Log = {
          level: LEVELS.info,
          time,
          service,
          side,
          traceId,
          spanId,
          attributes: undefined,
          msg: "core.span",
        };
        queue.writeConsole(record);

        const line = interactionLine.run({
          input: { span, entry: entry === 1, service, side },
          ns: quiet,
        });
        if (line) queue.addLog(side, line);
        queue.publishQueued();
      },
      log(wire: LogLine) {
        const [, side, encoded, level, time, traceId, spanId, message, attributes] = wire;
        const record: Telemetry.Log = {
          level,
          time,
          service,
          side,
          traceId: traceId ?? undefined,
          spanId: spanId ?? undefined,
          attributes: Object.fromEntries(
            Object.entries(attributes).map(([key, value]) => [
              key.slice(0, 256),
              encoded ? (value as string) : encodeValue.run({ input: value, ns: quiet }),
            ]),
          ),
          msg: message.slice(0, 2048),
        };
        queue.writeConsole(queue.addLog(side, record));

        queue.publishQueued();
      },
    };
    return owned;
  },
});
