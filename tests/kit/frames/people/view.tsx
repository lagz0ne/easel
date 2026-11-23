import { ui } from "@easel/kit";
import { resource } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";

import { text } from "./copy";
import { capitals, people, remove } from "./entities";

export const View = resource({
  label: "people.View",
  depends: { ui: ui.pieces, t: text },
  factory: ({ ui: { Button, Card, Empty }, t }) =>
    function People() {
      const list = useData(people);
      const upper = useData(capitals);
      const drop = useRun(remove);
      return (
        <main className="p-6">
          <Card title={t("people.title")}>
            <p>{t("people.count", { count: list.length })}</p>
            {list.length === 0 ? <Empty /> : null}
            {list.map((one) => (
              <div key={one.id} className="flex items-center gap-2">
                <span>{upper ? one.name.toUpperCase() : one.name}</span>
                <Button tone="ghost" small onClick={() => drop.run({ input: one.id })}>
                  {t("people.remove")}
                </Button>
              </div>
            ))}
          </Card>
        </main>
      );
    },
});
