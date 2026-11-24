import { LEVELS, tag } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { z } from "zod";

export const telemetrySide = tag({
  label: "telemetry.side",
  parse: z.enum(["server", "browser", "ssr", "worker"]),
});

export const telemetryService = tag({
  label: "telemetry.service",
  parse: z.string().min(1),
});

export const firstSendMark = tag({
  label: "telemetry.firstSendMark",
  default: "",
  parse: z.string(),
});

export const firstSendMaxMs = tag({
  label: "telemetry.firstSendMaxMs",
  default: 10_000,
  parse: z.number().int().min(0),
});

export const tracesUrl = tag({ label: "telemetry.tracesUrl", parse: z.instanceof(URL) });
export const logsUrl = tag({ label: "telemetry.logsUrl", parse: z.instanceof(URL) });

export const logLevel = tag<Observe.Level>({
  label: "telemetry.logLevel",
  default: LEVELS.info,
  parse: z.union([z.literal(20), z.literal(30), z.literal(40), z.literal(50)]),
});

export const spanHistory = tag<number>({
  label: "telemetry.spanHistory",
  default: 80,
  parse: z.number().int().min(0),
});

export const serviceVersion = tag({
  label: "telemetry.serviceVersion",
  default: "",
  parse: z.string(),
});

export const resourceAttributes = tag<[string, string][]>({
  label: "telemetry.resourceAttributes",
  default: [],
  parse: z.array(z.tuple([z.string(), z.string()])),
});

export const tabErrorSource = tag<EventTarget | null>({
  label: "telemetry.tabErrorSource",
  default: null,
});
