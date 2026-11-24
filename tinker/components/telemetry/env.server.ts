import { z } from "zod";

const given = z
  .string()
  .optional()
  .transform((raw) => raw?.trim() || undefined);

const number = given.transform((raw) => (raw === undefined ? undefined : Number(raw)));

const pairs = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? "").split(",").flatMap((pair): [string, string][] => {
      const at = pair.indexOf("=");
      const [key = "", value = ""] = [pair.slice(0, at), pair.slice(at + 1)].map((part) => {
        try {
          return decodeURIComponent(part.trim());
        } catch {
          return part.trim();
        }
      });
      return at > 0 && key ? [[key, value]] : [];
    }),
  );

export const telemetryEnv = z
  .object({
    OTEL_EXPORTER_OTLP_ENDPOINT: given.transform((raw) => raw?.replace(/\/+$/, "")),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: given,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: given,
    OTEL_RESOURCE_ATTRIBUTES: pairs,
    GIT_SHA: given.transform((raw) => raw ?? "dev"),
    LOG_LEVEL: number,
    SPAN_HISTORY: number,
  })
  .transform((env) => {
    const base = env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const [traces, logs] = [
      [env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, "traces"],
      [env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, "logs"],
    ].map(([own, kind]) => own ?? (base === undefined ? undefined : `${base}/v1/${kind}`));
    return {
      tracesUrl: traces === undefined ? undefined : new URL(traces),
      logsUrl: logs === undefined ? undefined : new URL(logs),
      version: env.GIT_SHA,
      resource: env.OTEL_RESOURCE_ATTRIBUTES,
      level: env.LOG_LEVEL,
      history: env.SPAN_HISTORY,
    };
  });
