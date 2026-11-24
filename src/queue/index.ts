import { capsule } from "@tinkered/core";

import { channelApi } from "./channels";
import { queueApi, requestApi } from "./contract";
import { startsApi } from "./starts";

export const queue = capsule({
  label: "queue",
  exports: { api: queueApi, viewer: requestApi, channels: channelApi, starts: startsApi },
});
