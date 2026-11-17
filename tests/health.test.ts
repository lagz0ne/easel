import { expect, test } from "vite-plus/test";

import { baseVersion } from "~/components/health";

// The template's release bumps both together. A copy of the template (degit) keeps the base it
// started from and sets its own package.json version, so there only the shape holds.
test("the base version is a release version, the template's own inside tinker-app", async () => {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(baseVersion).toMatch(/^\d+\.\d+\.\d+$/);
  if (pkg.name === "tinker-app") expect(baseVersion).toBe(pkg.version);
});
