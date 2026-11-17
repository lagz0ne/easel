import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { release } from "@/release";

test("the version names the commit and the build the cmd gave the release capsule", async () => {
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      release({ commit: "523889a", build: 412 }),
    ],
  }).ready;

  const got = scope.run(release.version, {});
  await scope.close();

  expect(got).toEqual({ commit: "523889a", build: 412 });
});

test("a server run from source is build 0", async () => {
  const scope = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), release({ commit: "dev" })],
  }).ready;

  const got = scope.run(release.version, {});
  await scope.close();

  expect(got).toEqual({ commit: "dev", build: 0 });
});
