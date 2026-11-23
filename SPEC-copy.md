# Spec delta: `copy`, the texts of the team by text key

Status: proposed (2026-11-23). After it ships, it goes into [SPEC-kit.md](SPEC-kit.md) as
§ The texts, and into [SPEC-frames.md](SPEC-frames.md) as § Exploring and ready. Then this file
gets `Status: implemented`.

Module `copy` of [MAP-round-1.md](MAP-round-1.md). Requirements: L1, L3, L5 and L12 of
[E9](docs/epics.md#e9-one-voice).

## Objective

Round 1 outcome: a team shows its design on a canvas, and agents make and change the design
through MCP. Today each frame keeps its own texts. So two agents name one action in two ways, and
a change of a name means a change to each frame.

After this delta, each easel keeps the texts of the team in one place, next to the look. Each text
has a text key. A ready frame shows each text by its text key. One change of a text reaches each
frame, and no frame changes. A second language is one more text for each text key.

An agent that explores a design is not slowed by these rules. A frame is `exploring` until an
agent marks it `ready`. An exploring frame may have its own texts, and colors and sizes that are
not in the look. To become ready, the frame settles them.

The user decided on 2026-11-23:

- "same text should be in same place, driven by key and will be sufficient to derive the i18n".
- "A frame can have text and even out of band color if they are in exploration mode. To switch to
  ready, they'll need to settle those".
- "Use texts or i18n": the calls, the CLI and the tools are named `texts`.

Prior art:

- **Ditto and Frontitude.** The texts of a product are in one place, each with an ID, and design
  and code use the same IDs. easel is that place for its team.
- **i18next, FormatJS and Fluent.** A catalogue gives each key a text for each locale, with
  plurals and `{name}` parameters. A missing text in a locale shows the text of the default
  locale (`fallbackLng`). Their catalogues are files in the code, so a change needs a deploy.
  easel keeps the catalogue live, as the look.
- **Figma "Ready for dev".** A designer explores freely, then marks a part ready. Doop has the same
  statuses (`needs_review`, `ready_for_dev`). This project uses the rule on its own canvas: "A
  draft frame is an exploration: it may break any rule" ([design](SPEC-design.md)).
- **Storybook locale global.** One pick of the locale for each story on the page. The viewer has
  this pick now (SPEC-kit § The capsules).

## Current behavior

- A part of an app frame keeps its texts in its own code (`Texts<K>` in
  `src/kit/capsules/copy.ts`). `say` gives the text of the locale. The locales are `en` and `vi`.
- The pieces of `ui` keep their own texts (`ui.empty`, `ui.close`).
- The check of an app frame replaces a color or a size that is not in the look with the nearest
  class of the look (SPEC-kit § App frames, "Fixes by position"). It refuses a put only for
  `kit/parse`, `kit/import`, `kit/react-state` and `kit/shape`.
- A kit version holds the look, the made CSS, the pieces and the runtime. Each change makes a new
  kit version. The page sends the new kit version on the port of each live document (K7). A
  picture asks for the kit version in its address, so a new kit version gives a new picture.
- A request keeps the kit version that the viewer saw.

## New behavior

### The texts of the team

1. Each easel has one list of texts in its kit version. Each text has a text key, a text in `en`,
   and a text in `vi` if a person gave one. A text is a string, or `{ one, other }` for a plural.
   A text can have `{name}` parameters.
2. A text key is lowercase words with dots between them, for example `trial.start` or
   `people.empty`: `^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$`, 80 characters at most.
3. `texts.set` writes one or more texts. It makes a new kit version, as `look.set` does. With a
   base, a change made on an old revision is refused `stale` (as K14). No call removes a text key.
4. In an app frame, `say("trial.start")` gives the text of the team in the locale of the frame. If
   the team has no text for that text key, `say` gives the text of the part, if it has one.
5. The kit message carries the texts. The mount of each live document draws the frame again in a
   new scope, as for a new look. Each picture asks for the new kit version.
6. `easel texts set <text key> "<text>" --locale vi` gives a text in `vi`. The locale pick of the
   viewer shows `vi`. A text key with no `vi` text shows its `en` text. `texts.list` names each
   text key with no `vi` text.
7. Kit version 1 holds the texts of the pieces of `ui` (`ui.empty`, `ui.close`).

### Exploring and ready

8. Each app frame has a status: `exploring` or `ready`. A new frame is `exploring`. A frame made
   before this delta is `exploring`.
9. **The settle rules.** The check finds these in an app frame:
   - `copy/text`: a text key that the texts of the team do not have.
   - `copy/own`: a text of a part that is not the text of the team for its text key.
   - `copy/key`: a text key that is not written as it is (a variable).
   - `look/color` and `look/size`: a color or a size that is not in the look.
     Each finding names the place, what is there, and the fix: `easel texts set <text key>
"<text>"`, remove the text from the part, or the class of the look.
10. **An exploring frame.** A put keeps the frame as the agent wrote it: no fix replaces a color
    or a size. The answer lists the findings of the settle rules, and they do not stop the put.
    The frame shows its own texts and its own colors.
11. **Mark a frame ready.** `frame.ready` checks the current version. With no finding of the
    settle rules, the status becomes `ready`. Else the answer is `unsettled`, with each finding
    and its fix, and nothing changes.
12. **A ready frame.** A put applies the fixes by position, as today. A finding with no fix (each
    `copy/*` finding) refuses the put `unsettled`. The frame keeps its version and its status.
    `frame.put` with `ready: true` makes or changes a frame and marks it ready in one call.
13. `frame.explore` gives a ready frame the status `exploring` again.
14. The viewer marks a ready frame with `Ready` in its label row, as the mark of Figma.
15. No change of the look or the texts makes a ready frame unsettled: the names of the look are
    fixed (SPEC-kit § Contract), and no call removes a text key. The model checks this
    (§ Model).

## Contract

```ts
type TextKey = string                                   // rule 2
type Text = string | { one: string; other: string }
type TeamText = { en: Text; vi?: Text }
type TextFinding = { key: TextKey; what: string; fix: string }
type Status = "exploring" | "ready"

"texts.list": { kind: "found"; kit: number; rev: number; texts: Record<TextKey, TeamText>;
                noVi: TextKey[] }
"texts.set":  { kind: "updated" | "unchanged"; rev: number; kit: number }
            | { kind: "stale"; rev: number; kit: number }
            | { kind: "invalid"; findings: TextFinding[] }
            | { kind: "tooBig"; maxBytes: number }

"frame.ready":   { kind: "ready" | "unchanged"; version: number }
               | { kind: "unsettled"; findings: Finding[]; more: number } | { kind: "gone" }
"frame.explore": { kind: "exploring" | "unchanged" } | { kind: "gone" }
"frame.put":     ... | { kind: "unsettled"; findings: Finding[]; more: number }
```

- `texts.set` takes `{ texts: Record<TextKey, { en?: Text; vi?: Text }>, base?: number }`. A new
  text key needs `en`. Each locale of one text key has the same parameters, and the same form
  (string or plural). The texts of the team are 64 KiB at most.
- `rev` is the revision of the texts. It starts at 1, and each change adds 1.
- `frame.put` takes `ready?: boolean`. `FrameInfo` and `Frame` get `status: Status`.
- The rule list of `Finding` (SPEC-kit § Contract) gets `copy/text`, `copy/own` and `copy/key`.
- The MCP gets `list_texts`, `set_texts`, `ready_frame` and `explore_frame`. `put_frame` takes
  `ready`.
- The CLI gets `easel texts ls [--json]`, `easel texts set <text key> "<text>" [--locale vi]
[--base <rev>]`, `easel texts set -f <file.json> [--base <rev>]`, `easel ready <canvas> <id>`,
  `easel explore <canvas> <id>`, and `easel put ... --ready`.

## Model

The status of a frame is new state. So a TLA+ model and its chart come first, before code
(AGENTS.md), as `docs/statecharts/frame-status.md`. The model has two frames, two text keys, a
put that settles or not, `frame.ready`, `frame.explore`, `texts.set` and `look.set`. Its rules:

- A ready frame has a current version with no finding of the settle rules (rule 15).
- `frame.ready` and a put on a ready frame never write an unsettled version.
- A second config breaks one rule on purpose (a `texts.set` that removes a text key), so the check
  is seen to work.

## Fact rules

1. The texts of the team are part of the kit version. A kit version never changes, so a request
   keeps the texts that its viewer saw.
2. Only `texts.set` writes the texts of the team. No call of a frame writes them.
3. A change of the texts writes no frame and no frame version.
4. Each text key of the texts of the team has an `en` text.
5. A ready frame has no finding of the settle rules in its current version.

## Judged rules

1. The check of the settle rules reads the code of the frame. It does not run it.
2. The texts ride the kit message and the board of the kit. No new message, no new port.

## Success criteria

1. **L1.** Two ready frames of two agents use `trial.start`. Both show the same text.
2. **L3.** Agent A runs `texts.set` for `trial.start`. Agent B reads `list_texts` through MCP, and
   puts a ready frame that uses `trial.start`. The put is `created`, and B adds no text.
3. **L5.** After one `texts.set`, each live document in each open tab shows the new text within
   1 second, in the same iframe, with no reload. Each other frame in view shows it within
   10 seconds, on a canvas of 20 frames. No frame version changed.
4. **L12.** A person gives a `vi` text for each text key, with `texts.set` only. The locale pick
   `vi` shows each ready frame in `vi`. No frame version changed.
5. An exploring frame with its own text and the color `bg-[#f00]` is `created`, shows both, and
   lists the two findings. `frame.ready` on it answers `unsettled` with the same findings and
   their fixes. After the agent settles them, `frame.ready` answers `ready`.
6. A put on a ready frame with a `copy/*` finding is refused `unsettled`, and the frame stays as
   it was.
7. The model holds its rules, and its second config breaks.
8. The speed gate stays green: the `open` step at 20 and at 200 frames is in its budget, and not
   slower than its base.
9. `tinker check` finds no exit of `copy` that a test does not reach.

## Testing strategy

- A server test for each kind of `texts.list`, `texts.set`, `frame.ready` and `frame.explore`,
  and for the 5 fact rules.
- A test of the check: each settle rule, on an exploring frame (a note) and on a ready frame (a
  refusal or a fix).
- A browser test (`tests/browser/viewer-kit.test.tsx`) for L5 and L12: the same iframe, the new
  text within 1 second, a new picture for a frame that is not live. The `Ready` mark.
- An MCP test for L3, over HTTP: two users, `set_texts`, then `list_texts` and `put_frame`.
- `scripts/statecharts.sh --check frame-status frame-status-broken`.
- `offload -- bun run speed`, before and after. The numbers go in the ship message.

## Boundaries

- Always: one kit version chain. The texts change through the kit version, as the look does.
- Ask first: a new table, or a new message on the port of a document.
- Never: a frame write for a change of the texts. Never run the code of a frame on the server.

## Out of scope (deferred)

- **L2:** a check of the visible text of a frame (a text in the markup with no text key, a banned
  term). Add it when a ready frame shows a text that is not in the texts of the team.
- **L4:** the speed of an agent with the texts. Add it when an agent says that the texts are slow.
- **L6:** undo of a change of the texts. The old kit versions keep the old texts, so it is one
  call. Add it when a team asks for it.
- **L9 to L11:** a page that shows all the texts, where each is used, and the texts that no frame
  uses. `easel texts ls` is the list for Round 1. Add the page when a person reviews the texts.
- **Remove a text key.** It needs a rule for the ready frames that use it (rule 15). Add it when a
  team has a text key that no frame uses.
- **HTML frames.** A text key and a status in an HTML frame. Add them when an agent makes HTML
  frames that other frames must match.
- **A status for review** (as `needs_review` of Doop). Add it when a team asks a person to sign
  off a frame in easel.
- **More locales than `en` and `vi`.** Add one when a team asks for its language.
