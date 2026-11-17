import { capsule } from "@tinkered/core";

import { loginApi, ownerApi, userApi } from "./contract";

/**
 * access's capsule: who may use easel (SPEC-access.md). Others import a file of the feature by
 * its own path. The server's side is in `./*.server.ts`: the guards other modules put in their
 * `onStart` are in `./guards.server`.
 * - `login`: the calls with no token (`login.start`, `login.setup`, `login.wait`).
 * - `user`: a user's calls (`users.me`, `login.end`).
 * - `owner`: an owner's calls (`users.list`, `users.approve`, `users.deny`, `users.revoke`).
 */
export const access = capsule({
  label: "access",
  exports: { login: loginApi, user: userApi, owner: ownerApi },
});
