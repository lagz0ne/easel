import { capsule } from "@tinkered/core";

import { opsOwnerApi, opsUserApi } from "./contract";

/**
 * ops's capsule: the error groups, readiness and the fixer's stamp (SPEC-ops.md). Others import
 * a file of the feature by its own path. The server's side is in `./*.server.ts`; the tags other
 * modules bind (checks, counters, the fixer's lease) are in `./registry`.
 * - `user`: `ops.status`.
 * - `owner`: `ops.errors`, `ops.error`, `ops.resolveError`, `ops.handOff`, `ops.fixerTick`.
 */
export const ops = capsule({
  label: "ops",
  exports: { user: opsUserApi, owner: opsOwnerApi },
});
