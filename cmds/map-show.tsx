import { createScope } from "@tinkered/core";
import { ScopeProvider } from "@tinkered/react";
import { shown } from "map:units";
import { createRoot } from "react-dom/client";

import { pressIn, showScope, shownMark } from "@/map/show";

const boot = createScope();
const wanted = decodeURIComponent(location.hash.slice(1));
const plan = shown.plans.find((each) => each.state === wanted);
const root = document.getElementById("app");

if (plan && root) {
  const options = boot.run(showScope, {
    input: { cell: shown.cell, actions: shown.actions, plan },
  });
  const live = await createScope(options).ready;
  const { View } = shown;
  createRoot(root).render(
    <ScopeProvider scope={live}>
      <View />
    </ScopeProvider>,
  );

  const pressed = await boot.run(pressIn, { input: { page: document, press: plan.press } });
  document.documentElement.setAttribute(shownMark, JSON.stringify(pressed));
} else {
  document.documentElement.setAttribute(
    shownMark,
    JSON.stringify({ kind: "noState", state: wanted }),
  );
}
