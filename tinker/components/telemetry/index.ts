import { capsule } from "@tinkered/core";

import { consoleSpans, logConsole } from "./console";
import { tabSink } from "./observer";
import {
  firstSendMark,
  firstSendMaxMs,
  tabErrorSource,
  telemetryService,
  telemetrySide,
} from "./settings";

export type { Telemetry } from "./records";
export { exportHealth } from "./health";

export const telemetry = {
  browser: capsule({
    label: "telemetry",
    config: {
      service: telemetryService.required,
      console: logConsole,
      consoleSpans,
      firstSendMark,
      firstSendMaxMs,
      errors: tabErrorSource,
    },
    tags: [telemetrySide("browser")],
    hooks: tabSink,
  }),
};
