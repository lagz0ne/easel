import { resource } from "@tinkered/core";

import { httpBackend } from "~/components/http";

import type { Telemetry } from "./records";
import {
  logsUrl,
  resourceAttributes,
  serviceVersion,
  telemetryService,
  telemetrySide,
  tracesUrl,
} from "./settings";

type Batch = { url: string; body: string | undefined; contentType: string };

const sides = ["server", "browser", "ssr", "worker"] as const;

export const otlpResources = resource({
  label: "telemetry.otlpResources",
  target: "scope",
  depends: { service: telemetryService, version: serviceVersion, attributes: resourceAttributes },
  factory: ({ service, version, attributes }) => {
    const shared = new Map(attributes);
    if (version) shared.set("service.version", version);

    return new Map(
      sides.map((one) => {
        const named = new Map(shared);
        named.set("service.name", one === "browser" ? `${service}-web` : service);
        named.set("tinker.side", one);
        const list = [...named].map(([key, value]) => ({ key, value: { stringValue: value } }));
        return [one, JSON.stringify({ attributes: list })];
      }),
    );
  },
});

const scope = `{"name":"tinker"}`;

export const delivery = resource({
  label: "telemetry.delivery",
  depends: {
    side: telemetrySide,
    backend: httpBackend,
    resources: otlpResources,
    tracesUrl: tracesUrl.optional,
    logsUrl: logsUrl.optional,
  },
  factory: ({ side, backend, resources, tracesUrl, logsUrl }) => {
    const browser = side === "browser";
    const href = {
      trace: tracesUrl.present ? tracesUrl.value.href : "",
      log: logsUrl.present ? logsUrl.value.href : "",
    };

    const owned = {
      otlpBody(kind: Telemetry.Record["kind"], records: Telemetry.Record[]) {
        const groups = sides.flatMap((one) => {
          const items = records
            .filter((record) => record.kind === kind && record.side === one)
            .map((record) => record.json)
            .join(",");
          if (!items) return [];
          const inner =
            kind === "trace"
              ? `"scopeSpans":[{"scope":${scope},"spans":[${items}]}]`
              : `"scopeLogs":[{"scope":${scope},"logRecords":[${items}]}]`;
          return [`{"resource":${resources.get(one)},${inner}}`];
        });

        if (!groups.length) return undefined;
        return kind === "trace"
          ? `{"resourceSpans":[${groups.join(",")}]}`
          : `{"resourceLogs":[${groups.join(",")}]}`;
      },
      batchesOf(records: Telemetry.Record[]): Batch[] {
        if (!browser) {
          return (["trace", "log"] as const).map((kind) => ({
            url: href[kind],
            body: href[kind] ? owned.otlpBody(kind, records) : undefined,
            contentType: "application/json",
          }));
        }

        const traces = records
          .filter((record) => record.kind === "trace")
          .map((record) => `{"side":"${record.side}",${record.json.slice(1)}`);
        const lines = records
          .filter((record) => record.kind === "log")
          .map((record) => record.json);
        const body = `{"traces":[${traces.join(",")}],"logs":[${lines.join(",")}]}`;
        return [{ url: "/api/telemetry", body, contentType: "application/json" }];
      },
      async send(records: Telemetry.Record[], signal: AbortSignal): Promise<Telemetry.Delivery> {
        const batches = owned.batchesOf(records);
        const accepted = await Promise.all(
          batches.map(async ({ url, body, contentType }) => {
            if (body === undefined) return true;
            try {
              const response = await backend(url, {
                method: "POST",
                headers: { "content-type": contentType },
                body,
                signal,
                redirect: "error",
                ...(browser ? { credentials: "same-origin", keepalive: true } : {}),
              });
              await response.body?.cancel();
              return response.ok;
            } catch {
              return false;
            }
          }),
        );
        return { traces: accepted[0]!, logs: browser ? accepted[0]! : accepted[1]! };
      },
    };
    return owned;
  },
});
