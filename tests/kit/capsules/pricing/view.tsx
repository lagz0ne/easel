import { resource } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";

import { copy } from "@/kit/capsules/copy";
import { ui } from "@/kit/capsules/ui";

import { chosen, type Plan, plans } from "./entities";
import { choose } from "./logic";

/** One plan: a component that the View depends on, as it depends on the pieces. */
const PlanCard = resource({
  label: "pricing.PlanCard",
  depends: { ui: ui.pieces, t: copy.t, format: copy.format },
  factory: ({ ui: { Card, Button, Badge }, t, format }) =>
    function PlanCard({ plan }: { plan: Plan }) {
      const picked = useData(chosen);
      const pick = useRun(choose);

      return (
        <Card title={plan.name}>
          <p className="text-2xl font-semibold">
            {t("pricing.per", { price: format.money(plan.price, "USD") })}
          </p>
          <Badge tone="info">{t("pricing.features", { count: plan.features.length })}</Badge>
          <ul className="flex flex-col gap-1 text-sm">
            {plan.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <Button wide onClick={() => pick.run({ input: plan.id })}>
            {picked === plan.id ? t("pricing.chosen") : t("pricing.choose", { plan: plan.name })}
          </Button>
        </Card>
      );
    },
});

export const View = resource({
  label: "pricing.View",
  depends: { ui: ui.pieces, t: copy.t, PlanCard },
  factory: ({ ui: { Empty }, t, PlanCard }) =>
    function Pricing() {
      const rows = useData(plans);

      return (
        <main className="mx-auto flex max-w-5xl flex-col gap-8 p-8">
          <h1>{t("pricing.title")}</h1>
          {rows.length === 0 ? (
            <Empty />
          ) : (
            <section className="grid gap-6 md:grid-cols-3">
              {rows.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </section>
          )}
        </main>
      );
    },
});
