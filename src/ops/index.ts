import { capsule } from "@tinkered/core";

import { opsOwnerApi, opsUserApi } from "./contract";

export const ops = capsule({
  label: "ops",
  exports: { user: opsUserApi, owner: opsOwnerApi },
});
