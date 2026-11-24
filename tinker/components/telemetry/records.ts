import { LEVELS, namespace, operation } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { z } from "zod";

import type { span, logRecord, telemetryBatch } from "./records.server";

export declare namespace Telemetry {
  type Span = z.infer<typeof span>;
  type Log = z.infer<typeof logRecord>;
  type Batch = z.infer<typeof telemetryBatch>;
  type Side = Log["side"];
  type Health = { pending: number; dropped: number } & (
    | { kind: "idle" | "queued" | "sending" }
    | { kind: "failed"; failure: string }
  );
  type SpanBody = Omit<Span, "side">;
  type Attribute = { key: string; value: { stringValue: string } };
  type LogBody = {
    timeUnixNano: string;
    severityNumber: number;
    severityText: string;
    body: { stringValue: string };
    attributes: Attribute[];
    traceId?: string;
    spanId?: string;
  };
  type Record = { kind: "trace" | "log"; side: Side; json: string; bytes: number };
  type Delivery = { traces: boolean; logs: boolean };
  type SpanFields = Pick<
    Observe.Span,
    | "traceId"
    | "spanId"
    | "parentSpanId"
    | "sampled"
    | "name"
    | "kind"
    | "start"
    | "end"
    | "status"
    | "error"
    | "attributes"
    | "events"
  >;
  type Wire =
    | [
        tag: "s",
        side: Side,
        time: number,
        encoded: 0 | 1,
        traceId: string,
        spanId: string,
        parentSpanId: string | null,
        sampled: boolean,
        name: string,
        kind: Observe.Kind,
        start: number,
        end: number | null,
        status: "ok" | "failed" | null,
        error: string | null,
        attributes: { [key: string]: unknown },
        events: Observe.Event[],
        entry: 0 | 1,
      ]
    | [
        tag: "l",
        side: Side,
        encoded: 0 | 1,
        level: number,
        time: number,
        traceId: string | null,
        spanId: string | null,
        message: string,
        attributes: { [key: string]: unknown },
      ]
    | [tag: "b", batch: Batch];
}

export const quiet = namespace({ observe: false });

export const encodeValue = operation({
  label: "telemetry.encodeValue",
  input: (raw: unknown) => raw,
  run: (_deps, ctx): string => {
    const value = ctx.input;
    switch (typeof value) {
      case "string":
        return value.slice(0, 2048);
      case "number":
      case "boolean":
        return JSON.stringify(value).slice(0, 2048);
      case "bigint":
        return value.toString().slice(0, 2048);
      case "undefined":
        return "undefined";
    }
    try {
      return (
        JSON.stringify(value, (_key, entry) =>
          typeof entry === "bigint" ? entry.toString() : entry,
        ) ?? "undefined"
      ).slice(0, 2048);
    } catch {
      return "[Unserializable]";
    }
  },
});

export const spanBody = operation({
  label: "telemetry.spanBody",
  depends: { encodeValue },
  input: (raw: unknown) => raw as { span: Telemetry.SpanFields; encoded: boolean },
  run: ({ encodeValue }, ctx): Telemetry.SpanBody => {
    const { span, encoded } = ctx.input;
    const [startTimeUnixNano, endTimeUnixNano] = [span.start, span.end ?? span.start].map(
      (time) => {
        const millis = Math.trunc(time);
        return millis === 0 ? "0" : `${millis}000000`;
      },
    );

    const attributes = Object.entries(span.attributes)
      .slice(0, 31)
      .map(([key, value]) => ({
        key: key.slice(0, 256),
        value: { stringValue: encoded ? (value as string) : encodeValue.run({ input: value }) },
      }));
    attributes.push({ key: "tinker.kind", value: { stringValue: span.kind } });

    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      flags: span.sampled ? 1 : 0,
      name: span.name.slice(0, 256),
      kind: 1,
      startTimeUnixNano: startTimeUnixNano!,
      endTimeUnixNano: endTimeUnixNano!,
      attributes,
      events: span.events.slice(0, 32).map((event) => {
        const millis = Math.trunc(event.time);
        return {
          name: event.name.slice(0, 256),
          timeUnixNano: millis === 0 ? "0" : `${millis}000000`,
          attributes: Object.entries(event.attributes)
            .slice(0, 31)
            .map(([key, value]) => ({
              key: key.slice(0, 256),
              value: {
                stringValue: encoded ? (value as string) : encodeValue.run({ input: value }),
              },
            })),
        };
      }),
      status:
        span.status === "failed"
          ? { code: 2, message: String(span.error).slice(0, 2048) }
          : { code: 1 },
    };
  },
});

const secretName =
  "[\\w.-]*?(?:token|password|passwd|pwd|pass|secret|key|authorization|cookie|share)[\\w.-]*";

const secretAttribute = new RegExp(`^${secretName}$`, "i");

const secretPair = new RegExp(
  `\\b(${secretName})(["']?\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s,;&"]+)`,
  "gi",
);

export const redactText = operation({
  label: "telemetry.redactText",
  input: (raw: unknown) => String(raw),
  run: (_deps, ctx): string =>
    ctx.input
      .replace(/<[!?/]?[a-z][\s\S]*/i, "[document removed]")
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[removed]@")
      .replace(/\b(bearer|basic)\s+\S+/gi, "$1 [removed]")
      .replace(secretPair, "$1$2[removed]")
      .replace(/[A-Za-z0-9+/_-]{20,}={0,2}/g, (run) => (/\d/.test(run) ? "[removed]" : run)),
});

export const redactAttribute = operation({
  label: "telemetry.redactAttribute",
  depends: { redactText },
  input: z.custom<Telemetry.Attribute>(),
  run: ({ redactText }, ctx): Telemetry.Attribute => ({
    key: ctx.input.key,
    value: {
      stringValue: secretAttribute.test(ctx.input.key)
        ? "[removed]"
        : redactText.run({ input: ctx.input.value.stringValue }),
    },
  }),
});

const severities = [
  [20, 5, "DEBUG"],
  [30, 9, "INFO"],
  [40, 13, "WARN"],
  [50, 17, "ERROR"],
] as const;

export const logBody = operation({
  label: "telemetry.logBody",
  depends: { redactText, redactAttribute },
  input: z.custom<Telemetry.Log>(),
  run: ({ redactText, redactAttribute }, ctx): Telemetry.LogBody => {
    const log = ctx.input;
    const [, severityNumber, severityText] = severities.find(([level]) => log.level <= level) ?? [
      60,
      21,
      "FATAL",
    ];
    return {
      timeUnixNano: log.time === 0 ? "0" : `${Math.trunc(log.time)}000000`,
      severityNumber,
      severityText,
      body: { stringValue: redactText.run({ input: log.msg }) },
      attributes: Object.entries(log.attributes ?? {}).map(([key, value]) =>
        redactAttribute.run({ input: { key, value: { stringValue: value } } }),
      ),
      ...(log.traceId ? { traceId: log.traceId } : {}),
      ...(log.spanId ? { spanId: log.spanId } : {}),
    };
  },
});

export const redactSpan = operation({
  label: "telemetry.redactSpan",
  depends: { redactText, redactAttribute },
  input: z.custom<Telemetry.SpanBody>(),
  run: ({ redactText, redactAttribute }, ctx): Telemetry.SpanBody => {
    const span = ctx.input;
    return {
      ...span,
      attributes: span.attributes.map((entry) => redactAttribute.run({ input: entry })),
      events: span.events.map((event) => ({
        ...event,
        attributes: event.attributes.map((entry) => redactAttribute.run({ input: entry })),
      })),
      status:
        span.status.message === undefined
          ? span.status
          : { ...span.status, message: redactText.run({ input: span.status.message }) },
    };
  },
});

export const interactionLine = operation({
  label: "telemetry.interactionLine",
  depends: { encodeValue },
  input: z.custom<{
    span: Telemetry.SpanFields;
    entry: boolean;
    service: string;
    side: Telemetry.Side;
  }>(),
  run: ({ encodeValue }, ctx): Telemetry.Log | undefined => {
    const { span, entry, service, side } = ctx.input;
    const interaction = entry && side !== "browser" && span.kind === "operation";
    if (!interaction || span.status === "failed") return undefined;

    const end = span.end ?? span.start;
    const exit = span.attributes["tinker.exit"];
    return {
      level: LEVELS.info,
      time: Math.trunc(end),
      service,
      side,
      traceId: span.traceId,
      spanId: span.spanId,
      attributes: {
        ms: encodeValue.run({ input: Math.round(end - span.start) }),
        outcome: encodeValue.run({ input: "ok" }),
        ...(exit === undefined ? {} : { exit: encodeValue.run({ input: exit }) }),
      },
      msg: span.name.slice(0, 2048),
    };
  },
});
