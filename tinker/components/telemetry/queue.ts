import { resource } from "@tinkered/core";

import { abortReasons } from "~/components/errors";

import { consoleOutput } from "./console";
import { delivery } from "./delivery";
import { exportHealth } from "./health";
import { logBody, quiet, redactSpan, redactText } from "./records";
import type { Telemetry } from "./records";
import { firstSendMark, firstSendMaxMs, telemetrySide } from "./settings";

export const queue = resource({
  label: "telemetry.queue",
  target: "scope",
  depends: {
    side: telemetrySide,
    mark: firstSendMark,
    maxMs: firstSendMaxMs,
    health: exportHealth.controller,
    delivery,
    console: consoleOutput,
    redactSpan,
    redactText,
    logBody,
  },
  factory: (
    { side, mark, maxMs, health, delivery, console, redactSpan, redactText, logBody },
    ctx,
  ) => {
    const encoder = new TextEncoder();
    let records: Telemetry.Record[] = [];
    const browser = side === "browser";
    const openedAt = ctx.clock.currentTimeMillis();
    let shown = !browser || mark === "";
    const batchLimit = browser ? 32_000 : 48_000;
    const recordLimit = browser ? batchLimit - 24 : batchLimit;
    const frameBytes = browser ? 23 : 0;
    const commaBytes = browser ? 1 : 0;
    const scratch = new Uint8Array(recordLimit + 4);

    const stdout = browser ? null : console;
    let consoleLines: string[] = [];
    let consoleBytes = 0;
    let draining = false;
    let queueBytes = 0;
    let dropped = 0;

    let timer: Promise<void> | undefined;
    let pending: Promise<void> | undefined;
    const stopTimer = new AbortController();
    const stopRequests = new AbortController();
    let state: "open" | "closing" | "closed" = "open";
    let publishing = true;
    let failed = false;

    const owned = {
      held() {
        shown ||=
          performance.getEntriesByName(mark).length > 0 ||
          ctx.clock.currentTimeMillis() - openedAt >= maxMs;
        return !shown;
      },
      sendable() {
        return state === "open" && !owned.held();
      },
      ingest(batch: Telemetry.Batch) {
        for (let index = 0; index < batch.traces.length; index++) {
          const { side, ...value } = batch.traces[index]!;
          owned.addSpan(side, value);
        }
        for (let index = 0; index < batch.logs.length; index++) {
          const value = batch.logs[index]!;
          owned.addLog(value.side, value);
        }
        if (batch.traces.length + batch.logs.length) owned.publishQueued();
      },
      addSpan(side: Telemetry.Side, value: Telemetry.SpanBody) {
        const body = browser ? value : redactSpan.run({ input: value, ns: quiet });
        owned.keep("trace", side, JSON.stringify(body));
      },
      addLog(side: Telemetry.Side, value: Telemetry.Log): Telemetry.Log {
        if (browser) {
          owned.keep("log", side, JSON.stringify(value));
          return value;
        }
        owned.keep("log", side, JSON.stringify(logBody.run({ input: value, ns: quiet })));
        const attributes = value.attributes;
        return {
          ...value,
          msg: redactText.run({ input: value.msg, ns: quiet }),
          attributes:
            attributes === undefined
              ? undefined
              : Object.fromEntries(
                  Object.entries(attributes).map(([key, entry]) => [
                    key,
                    redactText.run({ input: entry, ns: quiet }),
                  ]),
                ),
        };
      },
      keep(kind: Telemetry.Record["kind"], side: Telemetry.Side, json: string) {
        if (state === "closed" || records.length >= 512) {
          dropped++;
          return;
        }

        const { read, written } = encoder.encodeInto(json, scratch);
        const bytes = written + (kind === "trace" ? side.length + 10 : 0);

        if (read < json.length || bytes > recordLimit || queueBytes + bytes > 1_048_576) {
          dropped++;
        } else {
          records.push({ kind, side, json, bytes });
          queueBytes += bytes;
        }
      },
      writeConsole(value: Telemetry.Log) {
        if (state === "closed" || consoleLines.length >= 512 || consoleBytes >= 48_000) {
          dropped++;
          return;
        }
        const json = JSON.stringify(value);
        const size = encoder.encodeInto(json, scratch);
        if (size.read < json.length) {
          dropped++;
          return;
        }
        owned.retainConsole({ kind: "log", side: value.side, json, bytes: size.written });
      },
      retainConsole(record: Telemetry.Record) {
        if (record.bytes + 1 > 48_000 - consoleBytes) {
          dropped++;
          return;
        }
        consoleLines.push(record.json);
        consoleBytes += record.bytes + 1;
      },
      flushConsole() {
        if (!stdout || stdout.writableNeedDrain || !consoleLines.length) return;
        stdout.write(`${consoleLines.join("\n")}\n`);
        consoleLines = [];
        consoleBytes = 0;
      },
      publishQueued() {
        if (publishing) {
          const previous = health.get();
          health.set(
            previous.kind === "failed"
              ? { ...previous, pending: records.length, dropped }
              : { kind: pending ? "sending" : "queued", pending: records.length, dropped },
          );
        }
        if (owned.sendable() && (records.length >= 64 || queueBytes >= batchLimit)) {
          draining = true;
          pending ??= owned.flush();
        }
      },
      start(flush: () => Promise<void>) {
        if (side !== "ssr") {
          timer = Promise.resolve().then(async () => {
            while (!stopTimer.signal.aborted) {
              try {
                await ctx.clock.sleep(1000, stopTimer.signal);
              } catch (error) {
                if (!stopTimer.signal.aborted) throw error;
                return;
              }
              if (!stopTimer.signal.aborted && !owned.held()) await flush();
            }
          });
        }
      },
      takeBatch() {
        let bytes = frameBytes;
        const retained: typeof records = [];
        for (const record of records.slice(0, 64)) {
          const size = record.bytes + commaBytes;
          if (bytes + size > batchLimit) continue;
          bytes += size;
          retained.push(record);
        }
        return retained;
      },
      flush(): Promise<void> {
        if (!records.length && !pending) {
          owned.flushConsole();
          return Promise.resolve();
        }
        return (pending ??= Promise.resolve().then(async () => {
          try {
            do {
              owned.flushConsole();
              if (!records.length || stopRequests.signal.aborted) return;
              await owned.sendBatch();
            } while (draining && records.length && !failed);
          } finally {
            pending = undefined;
            draining = false;
          }
        }));
      },
      settle(retained: Telemetry.Record[], result: Telemetry.Delivery) {
        const taken = new Set(retained);
        records = records.filter((record) => !taken.has(record));
        for (const record of retained) {
          queueBytes -= record.bytes;
          if (!(record.kind === "trace" ? result.traces : result.logs)) dropped++;
        }
        failed = !result.traces || !result.logs;
      },
      async sendBatch() {
        const retained = owned.takeBatch();
        if (publishing) health.set({ kind: "sending", pending: records.length, dropped: dropped });

        const request = new AbortController();
        const deadline = new AbortController();
        const alarm = Promise.resolve().then(async () => {
          try {
            await ctx.clock.sleep(750, deadline.signal);
            request.abort(abortReasons.timeout);
          } catch (error) {
            if (!deadline.signal.aborted) throw error;
          }
        });

        let result: Telemetry.Delivery;
        try {
          result = await delivery.send(
            retained,
            AbortSignal.any([request.signal, stopRequests.signal]),
          );
        } finally {
          deadline.abort(abortReasons.done);
          await alarm;
        }

        owned.settle(retained, result);
        if (publishing) {
          health.set(
            !failed
              ? {
                  kind: records.length ? "queued" : "idle",
                  pending: records.length,
                  dropped: dropped,
                }
              : {
                  kind: "failed",
                  failure: "Telemetry storage did not accept the batch",
                  pending: records.length,
                  dropped: dropped,
                },
          );
        }
      },
      async close(publishFinal: boolean) {
        if (state !== "open") return;

        state = "closing";
        publishing = false;
        stopTimer.abort(abortReasons.closed);

        const deadline = new AbortController();
        const alarm = Promise.resolve().then(async () => {
          try {
            await ctx.clock.sleep(1500, deadline.signal);
            stopRequests.abort(abortReasons.timeout);
          } catch (error) {
            if (!deadline.signal.aborted) throw error;
          }
        });

        try {
          await timer;
          if (pending) await pending;
          while (records.length && !stopRequests.signal.aborted) {
            await owned.flush();
            if (failed) break;
          }
        } finally {
          state = "closed";
          stopRequests.abort(abortReasons.closed);
          deadline.abort(abortReasons.done);
          await alarm;

          owned.flushConsole();
          dropped += records.length + consoleLines.length;
          consoleLines = [];
          consoleBytes = 0;
          records = [];
          queueBytes = 0;

          if (publishFinal) {
            health.set(
              failed
                ? {
                    kind: "failed",
                    failure: "Telemetry storage did not accept the batch",
                    pending: 0,
                    dropped,
                  }
                : { kind: "idle", pending: 0, dropped },
            );
          }
        }
      },
    };

    ctx.defer(() => owned.close(!ctx.signal.aborted));
    return owned;
  },
});
