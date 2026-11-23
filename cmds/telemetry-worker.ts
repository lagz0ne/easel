import { createScope } from "@tinkered/core";

import { serveTelemetryWorker, telemetryWorkerInput } from "~/base/telemetry-worker";
import { telemetry, threadDrain } from "~/components/telemetry/index.server";

const { settings, console } = telemetryWorkerInput();

const root = createScope({
  capsules: [
    telemetry.worker({
      service: settings.service,
      tracesUrl: settings.traces === null ? undefined : new URL(settings.traces),
      logsUrl: settings.logs === null ? undefined : new URL(settings.logs),
      console,
    }),
  ],
});

await root.ready;

await serveTelemetryWorker(root.resolve(threadDrain));

const ended = await root.close({ graceful: true });

if (ended.status === "failed") throw ended.error;
if (ended.teardownErrors?.length) throw ended.teardownErrors[0];
