import { capsule } from "@tinkered/core";

import { kitApi } from "./contract";

export const kit = capsule({ label: "kit", exports: { api: kitApi } });
