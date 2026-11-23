import { capsule } from "@tinkered/core";

import { logConsole } from "./console";
import { queueSink } from "./observer";
import { firstSendMark, firstSendMaxMs, telemetryService, telemetrySide } from "./settings";

export type { Telemetry } from "./records";
export { exportHealth } from "./health";

export const telemetry = {
  browser: capsule({
    label: "telemetry",
    config: {
      service: telemetryService.required,
      console: logConsole,
      firstSendMark,
      firstSendMaxMs,
    },
    tags: [telemetrySide("browser")],
    hooks: queueSink,
  }),
};
