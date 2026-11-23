import { capsule } from "@tinkered/core";

import { loginApi, ownerApi, userApi } from "./contract";

export const access = capsule({
  label: "access",
  exports: { login: loginApi, user: userApi, owner: ownerApi },
});
