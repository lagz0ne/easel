// Form 1 of a frame (docs/decisions/kit-capsules.md): a component in the body of a factory. It
// sees only what it depends on: the pieces of the kit and the `t` of its own texts. Its own state
// is a cell.
import { data, operation, resource } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { z } from "zod";

import { copy, type Texts } from "@/kit/capsules/copy";
import { ui } from "@/kit/capsules/ui";

const texts = {
  en: {
    "invite.title": "Invite your team",
    "invite.access": { one: "{count} person has access", other: "{count} people have access" },
    "invite.remove": "Remove {email}",
  },
  vi: {
    "invite.title": "Mời nhóm của bạn",
    "invite.access": { one: "{count} người có quyền", other: "{count} người có quyền" },
    "invite.remove": "Xóa {email}",
  },
} satisfies Texts;

/** The `t` of the frame: its texts in the locale of the scope. */
export const text = resource({
  label: "invite.text",
  depends: { say: copy.say },
  factory: ({ say }) => say(texts),
});

const people = data<string[]>({ label: "invite.people", initial: ["ana@acme.com", "bo@acme.com"] });

const remove = operation({
  label: "invite.remove",
  input: z.string(),
  depends: { people: people.controller },
  run: ({ people }, { input }) => people.update((list) => list.filter((one) => one !== input)),
});

export const View = resource({
  label: "invite.View",
  depends: { ui: ui.pieces, t: text },
  factory: ({ ui: { Card, Button, Empty }, t }) =>
    function Invite() {
      const list = useData(people);
      const drop = useRun(remove);

      return (
        <Card title={t("invite.title")}>
          <p className="text-sm text-muted-foreground">
            {t("invite.access", { count: list.length })}
          </p>
          {list.length === 0 ? (
            <Empty />
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((email) => (
                <li key={email} className="flex items-center justify-between">
                  {email}
                  <Button
                    tone="ghost"
                    small
                    label={t("invite.remove", { email })}
                    onClick={() => drop.run({ input: email })}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    },
});
