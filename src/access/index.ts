import { capsule } from "@tinkered/core";

import { browserApi, loginApi, openApi, ownerApi, userApi } from "./contract";

export const access = capsule({
  label: "access",
  exports: {
    login: loginApi,
    browser: browserApi,
    open: openApi,
    user: userApi,
    owner: ownerApi,
  },
});
