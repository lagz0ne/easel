import { capsule } from "@tinkered/core";

import { greetApi } from "./contract";

export const greet = capsule({ label: "greet", exports: { api: greetApi } });
