import { capsule } from "@tinkered/core";

import { kitApi } from "./contract";

/**
 * kit's capsule: the look and the kit of one easel (SPEC-kit.md). Others import a file of the
 * feature by its own path; the server's side is in `./*.server.ts`.
 * - `api`: a user's calls (`look.get`, `look.set`, `look.undo`).
 */
export const kit = capsule({ label: "kit", exports: { api: kitApi } });
