import { capsule } from "@tinkered/core";

import { wordsApi } from "./contract";

export const words = capsule({ label: "words", exports: { api: wordsApi } });
