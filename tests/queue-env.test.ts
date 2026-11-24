import { expect, test } from "vite-plus/test";

import { queueEnv } from "@/queue/env.server";

test("the rule of agreement is on unless EASEL_AGREEMENT is off (SPEC-starts rule 20)", () => {
  expect(queueEnv.parse({}).agreement).toBe(true);
  expect(queueEnv.parse({ EASEL_AGREEMENT: "on" }).agreement).toBe(true);
  expect(queueEnv.parse({ EASEL_AGREEMENT: "" }).agreement).toBe(true);
  expect(queueEnv.parse({ EASEL_AGREEMENT: "off" }).agreement).toBe(false);
  expect(queueEnv.parse({ EASEL_AGREEMENT: " off " }).agreement).toBe(false);
});
