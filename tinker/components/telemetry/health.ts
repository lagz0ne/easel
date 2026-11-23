import { data } from "@tinkered/core";

import type { Telemetry } from "./records";

export const exportHealth = data<Telemetry.Health>({
  label: "telemetry.exportHealth",
  initial: { kind: "idle", pending: 0, dropped: 0 },
});
