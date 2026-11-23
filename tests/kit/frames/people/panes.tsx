// The panes of the frame (SPEC-kit.md § The capsules, "A control in its own scope"): React
// components that the viewer draws beside the frame, each in a scope of its own. A pane reads the
// frame's cells through `board` (a live mirror), and changes the frame only with a call of `api`.
// Its own state (the name in its field) is a cell of its own scope.
import { ui } from "@easel/kit";
import { data, operation, resource } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { CaseUpper, Plus } from "lucide-react";
import { z } from "zod";

import { text } from "./copy";
import { api, board } from "./entities";

/** The name in the field of the right pane: a state of the pane's scope, not of the frame. */
const draft = data({ label: "people.draft", initial: "" });

/** The count of the names that the field sent: a new field shows after each one, empty. */
const sent = data({ label: "people.sent", initial: 0 });

/** The person types in the field. */
const typeDraft = operation({
  label: "people.typeDraft",
  input: z.string(),
  depends: { draft: draft.controller },
  run: ({ draft }, { input }) => draft.set(input),
});

/** The pane calls the frame to add the person with the name in the field, then empties it. */
const addDraft = operation({
  label: "people.addDraft",
  depends: { draft: draft.controller, sent: sent.controller, add: api["people.call.add"] },
  run: async ({ draft, sent, add }) => {
    const one = await add.run({ input: draft.get() });
    draft.set("");
    sent.update((n) => n + 1);
    return one;
  },
});

/** The top pane: the count of the frame's list, and a switch of the capitals. */
export const Toolbar = resource({
  label: "people.Toolbar",
  depends: { ui: ui.pieces, t: text },
  factory: ({ ui: { Badge, Button }, t }) =>
    function Toolbar() {
      const list = useData(board.people);
      const upper = useData(board.capitals);
      const turn = useRun(api["people.call.capitals"]);
      return (
        <div className="flex items-center gap-2 p-1">
          <Badge>{t("people.count", { count: list.length })}</Badge>
          <Button
            tone={upper ? "primary" : "ghost"}
            small
            onClick={() => turn.run({ input: !upper })}
          >
            <span className="flex items-center gap-1">
              <CaseUpper size={14} aria-hidden />
              {t("people.capitals")}
            </span>
          </Button>
        </div>
      );
    },
});

/** The right pane: a name field and a button that adds the person, and the last name. */
export const AddPanel = resource({
  label: "people.AddPanel",
  depends: { ui: ui.pieces, t: text },
  factory: ({ ui: { Button }, t }) =>
    function AddPanel() {
      const name = useData(draft);
      const field = useData(sent);
      const list = useData(board.people);
      const type = useRun(typeDraft);
      const add = useRun(addDraft);

      const last = list.at(-1);
      return (
        <div className="flex w-56 flex-col gap-2 p-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("people.name")}
            <input
              key={field}
              className="rounded-md border border-input bg-background px-2 py-1"
              defaultValue={name}
              onChange={(event) => type.run({ input: event.target.value })}
            />
          </label>
          <Button small disabled={!name.trim()} onClick={() => add.run()}>
            <span className="flex items-center gap-1">
              <Plus size={14} aria-hidden />
              {t("people.add")}
            </span>
          </Button>
          {last ? <p className="text-sm">{t("people.last", { name: last.name })}</p> : null}
        </div>
      );
    },
});
