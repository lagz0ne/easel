import { capsule } from "@tinkered/core";

import { partsApi } from "./contract";

export const parts = capsule({ label: "parts", exports: { api: partsApi } });
