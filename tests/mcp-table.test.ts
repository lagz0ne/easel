import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { browserApi, loginApi, openApi, ownerApi, userApi } from "@/access/contract";
import { framesApi } from "@/frames/contract";
import { passApi, shareApi } from "@/frames/share";
import { kitApi } from "@/kit/contract";
import { noTool, tableGaps, tools } from "@/mcp/tools";
import { opsOwnerApi, opsUserApi } from "@/ops/contract";
import { channelApi } from "@/queue/channels";
import { queueApi, requestApi } from "@/queue/contract";
import { wordsApi } from "@/words/contract";

const easelApis = [
  loginApi,
  browserApi,
  openApi,
  userApi,
  ownerApi,
  opsUserApi,
  opsOwnerApi,
  framesApi,
  shareApi,
  passApi,
  kitApi,
  wordsApi,
  queueApi,
  requestApi,
  channelApi,
];

const addresses = easelApis.flatMap((api) => [...api.addresses]);

async function gaps(list: string[], lists: { tooled?: string[]; skipped?: string[] } = {}) {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  const found = scope.run(tableGaps, { input: { addresses: list, ...lists } });
  await scope.close();
  return found;
}

test("each call of easel's contracts is a tool or on the no-tool list, and none is both", async () => {
  expect(await gaps(addresses)).toEqual({ missing: [], both: [] });
  expect(Object.keys(tools)).toHaveLength(42);
});

test("the check finds a call that is in neither list, and one that is in both", async () => {
  expect(await gaps([...addresses, "frame.fly"])).toEqual({ missing: ["frame.fly"], both: [] });
  const tooled = [...Object.values(tools).map((row) => row.address), "login.start"];
  expect(await gaps(addresses, { tooled, skipped: Object.keys(noTool) })).toEqual({
    missing: [],
    both: ["login.start"],
  });
});

test("each description has two sentences at most; a queue tool has one more, on what a request allows", () => {
  for (const [name, row] of Object.entries(tools)) {
    const sentences = row.description.split(/[.?!](?:\s|$)/).filter((part) => part.trim());
    const queue = row.address.startsWith("request.") && /allows a change/.test(row.description);
    expect({ name, count: sentences.length <= (queue ? 3 : 2) }).toEqual({ name, count: true });
  }
});
