import { capsule } from "@tinkered/core";

import { routes } from "~/components/requests/index.server";

import { consoleOutput } from "./console";
import { telemetryOrigin, telemetryRoute } from "./ingest.server";
import { queueSend, queueSink } from "./observer";
import { quiet } from "./records";
import {
  logLevel,
  logsUrl,
  spanHistory,
  telemetryService,
  telemetrySide,
  tracesUrl,
} from "./settings";
import { telemetryWorker, threadRoute, threadSink } from "./thread.server";

export type { Telemetry } from "./records";
export { exportHealth } from "./health";

export type { ThreadSettings, ThreadMessage, ThreadRing, ThreadWorker } from "./thread.server";
export { threadDrain } from "./drain.server";

const sends = {
  service: telemetryService.required,
  tracesUrl: tracesUrl.optional,
  logsUrl: logsUrl.optional,
  console: consoleOutput,
} as const;

const records = { level: logLevel, history: spanHistory, origin: telemetryOrigin } as const;

export const telemetry = {
  server: capsule({
    label: "telemetry",
    config: { ...sends, ...records },
    tags: [telemetrySide("server"), routes.ns({ op: telemetryRoute, ns: quiet })],
    exports: { route: telemetryRoute },
    hooks: queueSink,
  }),
  thread: capsule({
    label: "telemetry",
    config: { ...sends, ...records, worker: telemetryWorker.required },
    tags: [telemetrySide("server"), routes.ns({ op: threadRoute, ns: quiet })],
    exports: { route: threadRoute },
    hooks: threadSink,
  }),
  worker: capsule({
    label: "telemetry",
    config: sends,
    tags: [telemetrySide("server")],
    hooks: queueSend,
  }),
};
