# Spec delta: `copy`, the texts of the team by text key

Status: proposed (2026-11-23). After it ships, it goes into [SPEC-kit.md](SPEC-kit.md) as
§ The texts, and this file gets `Status: implemented`.

Module `copy` of [MAP-round-1.md](MAP-round-1.md). Requirements: L1, L3, L5 and L12 of
[E9](docs/epics.md#e9-one-voice).

## Objective

Round 1 outcome: a team shows its design on a canvas, and agents make and change the design
through MCP. Today each frame keeps its own texts. So two agents name one action in two ways, and
a change of a name means a change to each frame.

After this delta, each easel keeps the texts of the team in one place, next to the look. Each text
has a text key. A frame shows a text by its text key. One change of a text reaches each frame, and
no frame changes. A second language is one more text for each text key.

The user set the smallest form on 2026-11-23: "same text should be in same place, driven by key
and will be sufficient to derive the i18n".

Prior art:

- **Ditto and Frontitude.** The texts of a product are in one place, each with an ID, and design
  and code use the same IDs. easel is that place for its team.
- **i18next, FormatJS and Fluent.** A catalogue gives each key a text for each locale, with
  plurals and `{name}` parameters. A missing text in a locale shows the text of the default
  locale (`fallbackLng`). Their catalogues are files in the code, so a change needs a deploy.
  easel keeps the catalogue live, as the look.
- **Storybook locale global.** One pick of the locale for each story on the page. The viewer has
  this pick now (SPEC-kit § The capsules).

## Current behavior

- A part of an app frame keeps its texts in its own code (`Texts<K>` in
  `src/kit/capsules/copy.ts`). `say` gives the text of the locale. The locales are `en` and `vi`.
- The pieces of `ui` keep their own texts (`ui.empty`, `ui.close`).
- A kit version holds the look, the made CSS, the pieces and the runtime. Each change makes a new
  kit version. The page sends the new kit version on the port of each live document (K7). A
  picture asks for the kit version in its address, so a new kit version gives a new picture.
- A request keeps the kit version that the viewer saw.

## New behavior

1. **The texts of the team.** Each easel has one list of texts in its kit version. Each text has a
   text key, a text in `en`, and a text in `vi` if a person gave one. A text is a string, or
   `{ one, other }` for a plural. A text can have `{name}` parameters.
2. **A text key** is lowercase words with dots between them, for example `trial.start` or
   `people.empty`: `^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$`, 80 characters at most.
3. **A change of the texts.** `copy.set` writes one or more texts. It makes a new kit version, as
   `look.set` does. With a base, a change made on an old revision is refused `stale` (as K14).
4. **A frame uses a text by its text key.** In an app frame, `say("trial.start")` gives the text of
   the team in the locale of the frame. A part declares the text keys that it uses, as today.
5. **A frame has no text of its own.** The check of an app frame finds each text key that a part
   declares and each literal first argument of `say`:
   - A text key that the texts of the team do not have: the put is refused `offKit`, with the rule
     `copy/text` and the fix `easel copy set <text key> "<text>"`.
   - A text in the frame that is not the text of the team: the put is refused `offKit`, with the
     rule `copy/own`, the text of the team, and the fix: remove the text from the frame.
   - A text key that is not written as it is (a variable): the rule `copy/key`.
6. **Live.** The kit message carries the texts. The mount of each live document draws the frame
   again in a new scope, as for a new look. Each picture asks for the new kit version.
7. **A second language.** `easel copy set <text key> "<text>" --locale vi` gives a text in `vi`.
   The locale pick of the viewer shows `vi`. A text key with no `vi` text shows its `en` text.
   `copy.list` marks each text key with no `vi` text.
8. **The seed.** Kit version 1 holds the texts of the pieces of `ui` (`ui.empty`, `ui.close`). The
   texts of a frame put before this delta stay in that frame version; its next put follows rule 5.

## Contract

```ts
type TextKey = string                                   // rule 2
type Text = string | { one: string; other: string }
type TeamText = { en: Text; vi?: Text }
type CopyFinding = { key: TextKey; what: string; fix: string }

"copy.list": { kind: "found"; kit: number; rev: number; texts: Record<TextKey, TeamText>;
               noVi: TextKey[] }
"copy.set":  { kind: "updated" | "unchanged"; rev: number; kit: number }
           | { kind: "stale"; rev: number; kit: number }
           | { kind: "invalid"; findings: CopyFinding[] }
           | { kind: "tooBig"; maxBytes: number }
```

- `copy.set` takes `{ texts: Record<TextKey, { en?: Text; vi?: Text }>, base?: number }`. A new
  text key needs `en`. Each locale of one text key has the same parameters, and the same form
  (string or plural). The texts of the team are 64 KiB at most.
- `rev` is the revision of the texts. It starts at 1, and each change adds 1.
- The rule list of `Finding` (SPEC-kit § Contract) gets `copy/text`, `copy/own` and `copy/key`.
- The MCP gets two tools: `list_texts` (`copy.list`) and `set_texts` (`copy.set`).
- The CLI gets `easel copy ls [--json]`, `easel copy set <text key> "<text>" [--locale vi]
[--base <rev>]` and `easel copy set -f <file.json> [--base <rev>]`.

## Fact rules

1. The texts of the team are part of the kit version. A kit version never changes, so a request
   keeps the texts that its viewer saw.
2. Only `copy.set` writes the texts of the team. No call of a frame writes them.
3. A change of the texts writes no frame and no frame version.
4. Each text key of the texts of the team has an `en` text.

## Judged rules

1. The check of rule 5 reads the code of the frame. It does not run it.
2. The texts ride the kit message and the board of the kit. No new message, no new port.

## Success criteria

1. **L1.** Two frames of two agents use `trial.start`. Both show the same text.
2. **L3.** Agent A runs `copy.set` for `trial.start`. Agent B reads `list_texts` through MCP, and
   puts a frame that uses `trial.start`. The put is `created`, and B adds no text.
3. **L5.** After one `copy.set`, each live document in each open tab shows the new text within
   1 second, in the same iframe, with no reload. Each other frame in view shows it within
   10 seconds, on a canvas of 20 frames. No frame version changed.
4. **L12.** A person gives a `vi` text for each text key, with `copy.set` only. The locale pick
   `vi` shows each frame in `vi`. No frame version changed.
5. A put with a text that is not in the texts of the team, or with a text of its own, is refused
   with a finding that names the text key and the fix.
6. The speed gate stays green: the `open` step at 20 and at 200 frames is in its budget, and not
   slower than its base.
7. `tinker check` finds no exit of `copy` that a test does not reach.

## Testing strategy

- A server test for each kind of `copy.list` and `copy.set`, and for the 4 fact rules.
- A test of the app check: each of `copy/text`, `copy/own` and `copy/key`, and a frame that passes.
- A browser test (`tests/browser/viewer-kit.test.tsx`) for L5 and L12: the same iframe, the new
  text within 1 second, a new picture for a frame that is not live.
- An MCP test for L3, over HTTP: two users, `set_texts`, then `list_texts` and `put_frame`.
- `offload -- bun run speed`, before and after. The numbers go in the ship message.

## Boundaries

- Always: one kit version chain. The texts change through the kit version, as the look does.
- Ask first: a new table, or a new message on the port of a document.
- Never: a frame write for a change of the texts. Never run the code of a frame on the server.

## Out of scope (deferred)

- **L2:** a check of the visible text of a frame (a text with no text key, a banned term). Add it
  when a team finds a text in a frame that is not in its texts.
- **L4:** the speed of an agent with the texts. Add it when an agent says that the texts are slow.
- **L6:** undo of a change of the texts. The old kit versions keep the old texts, so it is one
  call. Add it when a team asks for it.
- **L9 to L11:** a page that shows all the texts, where each is used, and the texts that no frame
  uses. `easel copy ls` is the list for Round 1. Add the page when a person reviews the texts.
- **Remove a text key.** Add it when a team has a text key that no frame uses.
- **HTML frames.** A text key in an HTML frame. Add it when an agent makes HTML frames with texts
  that other frames use.
- **More locales than `en` and `vi`.** Add one when a team asks for its language.

## Open questions

1. **Own texts in a frame.** I recommend rule 5 (refuse them), so that the texts of the team are
   the one place. The other way: the put adds the new texts of a frame to the texts of the team.
   That is less work for an agent, but two agents can then add two texts for one thing (L1).
2. **The CLI noun.** I recommend `easel copy`, the name of the capsule. The other way:
   `easel texts`.
