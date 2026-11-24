import { writeSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parentPort, workerData } from "node:worker_threads";

export declare namespace TelemetryWorker {
  type Health = { kind: string; pending: number; dropped: number };
  type Settings = {
    service: string;
    traces: string | null;
    logs: string | null;
    fd: number | null;
    relay: boolean;
    version: string;
    resource: [string, string][];
  };
  type Output = { writableNeedDrain: boolean; write(text: string): void };
  type Input = { settings: Settings; console: Output | null };
  type Drain = {
    take(line: string): void;
    health(): Health;
    report(): Health | undefined;
    watch(listener: () => void): void;
    flush(): Promise<void>;
    close(): Promise<Health>;
  };
}

type Shared = { data: Uint8Array; state: Int32Array; settings: TelemetryWorker.Settings };

export function telemetryWorkerInput(): TelemetryWorker.Input {
  const { settings } = workerData as Shared;
  if (settings.fd === null) {
    if (!settings.relay) return { settings, console: null };
    const port = parentPort!;
    return {
      settings,
      console: { writableNeedDrain: false, write: (text) => port.postMessage({ console: text }) },
    };
  }

  const fd = settings.fd;
  const held: Buffer[] = [];
  const console = {
    writableNeedDrain: false,
    write(text: string) {
      if (text) held.push(Buffer.from(text));

      while (held.length) {
        const next = held[0]!;
        let written: number;
        try {
          written = writeSync(fd, next);
        } catch (error) {
          if ((error as { code?: string }).code !== "EAGAIN") throw error;
          console.writableNeedDrain = true;
          setTimeout(() => console.write(""), 1);
          return;
        }
        if (written < next.length) held[0] = next.subarray(written);
        else held.shift();
      }

      console.writableNeedDrain = false;
    },
  };
  return { settings, console };
}

export async function serveTelemetryWorker(drain: TelemetryWorker.Drain) {
  const { data, state } = workerData as Shared;
  const port = parentPort!;
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const control = { closing: false, flushes: [] as number[] };
  let read = Atomics.load(state, 1);

  const post = () => {
    const health = drain.report();
    if (health) port.postMessage({ health });
  };
  drain.watch(post);

  port.on("message", (message: { close?: true; flush?: number }) => {
    if (message.close) control.closing = true;
    if (message.flush !== undefined) control.flushes.push(message.flush);
    Atomics.notify(state, 0);
  });

  port.postMessage({ ready: true });

  for (;;) {
    const at = Atomics.load(state, 0);
    if (at !== read) {
      const lines = ringLines(bytes, read, at);
      read = at;
      Atomics.store(state, 1, read);
      await takeLines(drain, lines, control);
      continue;
    }

    while (control.flushes.length) {
      await drain.flush();
      port.postMessage({ flushed: control.flushes.shift()! });
    }
    if (control.closing) break;

    const wait = Atomics.waitAsync(state, 0, at, 10);
    if (wait.async) await wait.value;
  }

  port.postMessage({ final: await drain.close() });
  port.close();
}

function ringLines(bytes: Buffer, from: number, to: number) {
  const mask = bytes.length - 1;
  const start = from & mask;
  const end = to & mask;
  const text =
    start < end
      ? bytes.toString("utf8", start, end)
      : Buffer.concat([bytes.subarray(start), bytes.subarray(0, end)]).toString("utf8");

  const lines = text.split("\n");
  lines.pop();
  return lines;
}

async function takeLines(
  drain: TelemetryWorker.Drain,
  lines: string[],
  control: { closing: boolean },
) {
  for (let index = 0; index < lines.length;) {
    const health = drain.health();
    if (!control.closing && health.kind !== "failed" && health.pending >= 384) {
      await sleep(1);
      continue;
    }

    const stop = Math.min(lines.length, index + 64);
    for (; index < stop; index++) drain.take(lines[index]!);
    await new Promise(setImmediate);
  }
}
