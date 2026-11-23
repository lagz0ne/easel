import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { release } from "@/release";

test("the version names the commit, the build and the page client the cmd gave the release capsule", async () => {
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      release({ commit: "523889a", build: 412, client: "/assets/index-AbC123.js" }),
    ],
  }).ready;

  const got = scope.run(release.version, {});
  await scope.close();

  expect(got).toEqual({ commit: "523889a", build: 412, client: "/assets/index-AbC123.js" });
});

test("a server run from source is build 0, with no page client", async () => {
  const scope = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), release({ commit: "dev" })],
  }).ready;

  const got = scope.run(release.version, {});
  await scope.close();

  expect(got).toEqual({ commit: "dev", build: 0, client: null });
});
