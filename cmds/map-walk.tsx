import { createScope } from "@tinkered/core";
import { shown } from "map:units";

import { walkBoot } from "@/map/walk-frame";

const boot = createScope();
const host = document.getElementById("app");

if (host) {
  const { View, cell, actions } = shown;
  await boot.run(walkBoot, { input: { page: document, to: parent, host, View, cell, actions } });
}
