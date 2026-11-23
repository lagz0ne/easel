import { expect, test } from "vite-plus/test";

import { baseVersion } from "~/components/health";

test("the base version is a release version, the template's own inside tinker-app", async () => {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  expect(baseVersion).toMatch(/^\d+\.\d+\.\d+$/);
  if (pkg.name === "tinker-app") expect(baseVersion).toBe(pkg.version);
});
