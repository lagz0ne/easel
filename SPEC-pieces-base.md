# Spec delta: `pieces-base`, a part of the design system and its copies

Status: approved by the requirements of 2026-11-24 (E11, V5; the user: "Now onto the custom
controller, copies, i18n, screen and flows"). The user granted autonomy for this round, so the
agent decided the open points below. Implemented: e656d71 (live at build 331), with the live
proof of V5 on 2026-11-24 (one put of the Dock main gave rev 7; each Dock copy on `product`
shows it, with no new frame version; `design:proof` OK).

It adds to [SPEC-pieces](SPEC-pieces.md) (its base: the parts in the kit version, and rules 18 and
19 for HTML copies), [SPEC-kit](SPEC-kit.md) (the kit version) and [SPEC-frames](SPEC-frames.md)
(the document that a tab and a picture get). It is the design of V5 in
[docs/epics.md](docs/epics.md#e11-the-design-and-the-app-agree).

## Objective

V5: "A change of a part reaches each screen that uses it. After a change of the dock, each
designed and each live screen with the dock shows the new dock."

After this delta, an agent changes the Dock on the canvas `design-system`, and each screen on
`product` with a copy of the Dock shows the new Dock, with no write of a screen. The person sees it
on the board within 2 seconds. A copy that an agent edited by hand keeps its edit, and easel says
which copies do not follow their part.

## Current

- The canvas `design-system` has 29 parts in HTML frames, moved from Doop. Each frame holds one
  main: an element with `data-doop-component="<id>"`, and its CSS in
  `<style data-doop-component-source="<id>">`.
- The canvas `product` has 191 HTML frames. They hold 2 663 copies of 20 parts. A copy is the whole
  markup of its part (`data-doop-instance="<id>"`, `data-doop-rev`, its props and overrides), and
  each frame holds the CSS of each part that it uses, in
  `<style data-doop-component-css="<id>">`.
- A change of a main changes no copy. `bun run design:proof` finds 3 S5 findings: Count and Dock
  are at revisions 5 and 6, Toolbar at revisions 3 and 4. 88 frames hold a Dock.
- No app frame uses a part: [SPEC-pieces](SPEC-pieces.md) (the design system as capsules) is not
  built.
- The live app has one dock (`src/viewer`). A change of it reaches each live screen at the next
  build, and the live screens show it (SPEC-live-screens, V1 and V4).
- A study of the copies on `product` (2026-11-24): 2 527 of 2 597 copies are exactly the markup of
  the main on `design-system` with their own props, overrides and slots. The other 70 copies (in
  8 frames) were edited by hand, outside their props and overrides.

## Prior art

| Tool                                 | What we take                                                                                                          | What we leave                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Figma libraries and instances        | A copy keeps a link to its main and its own overrides. Each property with no override follows the main.               | A publish step and "update available": one easel is one team and one library, so a change reaches at once. |
| Penpot components                    | The main lives on a page of the file, and a change of the main reaches the copies.                                    | The write of each copy: Penpot changes the copy shapes in the file data.                                   |
| Doop `update_instances`              | The markup of a copy (`data-doop-instance`, props, overrides, slots), so the moved designs stay as they are.          | A sync that writes each frame: 88 new versions for one change of the Dock, and each request on them old.   |
| shadcn/ui (a copy in your code)      | Nothing for the designs: a copy that never follows is the problem of V5.                                              | The copy-in model.                                                                                         |
| Web Components, 11ty WebC, Enhance   | Expand a short element into its markup when the page is made, in the light DOM, with slots.                           | A script in the frame: the server puts the part in, so a picture needs no script.                          |
| Storybook                            | One source for each part, and each screen imports it: the app frames of SPEC-pieces.                                  | (later, with SPEC-pieces rules 1 to 9)                                                                     |
| easel's own look (SPEC-kit, compose) | A change reaches each frame when easel gives the document, with no write of a frame. The kit version names the state. |                                                                                                            |

## Decisions

1. **HTML copies first, app frames later, on the same base.** Each designed screen and each part
   is an HTML frame now, and no app frame uses a part. So the person can see V5 only on HTML
   frames. The base (the parts in the kit version, `kit_design`) is the place where the TSX
   folder `design/` of SPEC-pieces comes later.
2. **A copy is a link, not a write.** easel puts the part in each copy when it gives the document
   of a frame: to a tab, to a picture, and to `parts.show`. The stored document does not change.
   A write of each frame (Doop, Penpot) makes a new version of each frame for each change, and
   each request on it says "may be outdated".
3. **The part is in the kit version.** The kit version is the library version (SPEC-pieces, prior
   art). A picture names its kit version, so a request shows the parts as the person saw them (the
   chart [part-copies-outside-kit](docs/statecharts/part-copies-outside-kit.md) shows why).
4. **The main stays a frame.** The source of a part is the frame that holds its main. An agent
   changes the part as it changes each frame: `easel put` with a base. The first link is one
   explicit step, `easel parts publish <canvas>`.
5. **A hand edit is never lost.** A copy follows its part only when it holds no edit outside its
   props, overrides and slots. Else it is an edited copy: easel shows it as written, and names it.
   Figma and Penpot keep the same rule with their overrides and "touched" properties.

## New

### Parts

1. **A main** is an element with `data-doop-component="<id>"` in an HTML frame, with its CSS in
   `<style data-doop-component-source="<id>">` of that frame. Its name is the name of the frame.
2. **The kit version holds the parts.** A part has an id, a name, a revision, a source (canvas,
   frame and version), its markup and its CSS. Each kit version names the revision of each part.
   A publish makes a new kit version, and a kit version never changes. The design revision of a
   kit version starts at 0 and adds 1 at each publish that changes a part.
3. **The first link.** `easel parts publish <canvas>` (`parts.publish`) publishes each main of the
   frames of a canvas, and makes each such frame the source of its part. The first revision of a
   part is the highest `data-doop-rev` of its copies on each canvas, or 1. A main that is the same
   as its part changes nothing.
4. **A put of a source publishes.** After a put of a source frame, easel publishes each main of
   the frame: a main that changed gets the next revision. All changed mains of one put go in one
   new kit version.
5. **A late publish.** The put and the publish are two writes. Each start of easel publishes each
   source frame whose main is not the part of the current kit version.

### Copies

6. **A copy** is an element with `data-doop-instance="<id>"` of a part. When easel gives the
   document of a frame, it puts the part of the kit version into each linked copy (the table
   below), and sets `data-doop-rev` to the revision of the part. It puts the CSS of the part,
   scoped to its copies, into each `<style data-doop-component-css="<id>">` of the frame. A copy
   in a slot of a copy (a Count in the Dock) follows its own part.
7. **Linked or edited.** A copy is linked when its markup is what one revision of its part gives
   with its own props, overrides, slots and root attributes (the attributes in each order). Else
   the copy is edited: easel gives it as it is written, and never changes it.
8. **Each tab gets the change.** After a publish, the board gives a new document for each frame
   that has a linked copy of a changed part, and for no other frame. The page keeps the old iframe
   until the new one draws. No frame and no frame version changes.
9. **A request keeps its parts.** A request keeps the kit version of its tab (SPEC-frames §
   Pictures), so its picture shows the parts of that kit version.
10. **Where a part is used.** `parts.list` gives each part with its source and its revision, and
    each frame that holds a copy of it, with its count of linked and of edited copies.

| In the copy                                       | What easel does                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `data-doop-props` (JSON)                          | A prop whose name is the `data-doop-prop` of an element of the main is the content of that element, as HTML (as Doop). |
|                                                   | Each other prop sets the attribute `data-<name>` on the root of the copy.                                              |
| `data-doop-overrides` (JSON, by `data-doop-part`) | `attrs` sets attributes on that element. `hidden: true` removes the element.                                           |
| an element with `data-doop-slot="<name>"`         | The copy gives the content of the slot. A slot that the copy does not have keeps the content of the main.              |
| an attribute on the root that the main has not    | It stays (a variant such as `data-mode`, or `data-doop-id`).                                                           |
| `data-doop-prop`, `data-doop-slot-suggest`        | The copy does not keep them, as Doop.                                                                                  |

## Contract

```ts
type PartCopies = { canvas: string; id: string; linked: number; edited: number }
type PartRow = { id: string; name: string; rev: number;
                 source: { canvas: string; frame: string; version: number };
                 copies: PartCopies[] }

"parts.list":    { kind: "found"; kit: number; rev: number; parts: PartRow[] }
"parts.publish": { kind: "updated" | "unchanged"; kit: number; rev: number;
                   parts: { id: string; name: string; rev: number }[] }
               | { kind: "gone" }
"parts.show":    { kind: "found"; kit: number; version: number; html: string } | { kind: "gone" }
```

- `parts.list` takes `{}`. `rev` is the design revision of the current kit version.
- `parts.publish` takes `{ canvas }`. `gone`: no such canvas. `parts` names each part of its
  frames, with its revision after the publish.
- `parts.show` takes `{ canvas, id }`: the document of the current version, as a tab gets it.
  `gone`: no such frame.
- The board document of a frame gets `parts`: the kit version whose parts are in its copies, or
  no field for a frame with no linked copy. The page draws a new iframe when it changes.
- CLI: `easel parts`, `easel parts publish <canvas>`, `easel parts show <canvas> <id> [-o file]`.
  MCP: `list_parts`, `publish_parts`, `show_frame_parts`.
- Any user may call them, as the kit (SPEC-kit § Contract).

## Fact rules

1. Only a publish writes `kit_parts` and `kit_design`.
2. A publish writes no frame and no frame version (SPEC-pieces fact rule 2).
3. Nothing of a frame runs on the server: easel reads the HTML as text (SPEC-pieces fact rule 4).

## Success criteria

1. **V5 on the live easel.** One put of the Dock source frame on `design-system`, with the zoom
   menu of the accepted design `product#1`, and each frame on `product` with a Dock copy shows the
   new Dock. No frame version on `product` changes. The pictures before and after show it.
2. `bun run design:proof` has no S5 finding: each copy of a part on `product` shows one revision.
   An edited copy is an S5 finding, with its frame.
3. A publish gives a new document to each frame with a linked copy of the changed part within 2
   seconds, and to no other frame (SPEC-pieces criterion 3, for HTML copies).
4. A picture of a request that was kept before a publish shows the old part.
5. An edited copy keeps each byte after a publish.
6. The chart [part-copies](docs/statecharts/part-copies.md) holds its rules, and
   [part-copies-outside-kit](docs/statecharts/part-copies-outside-kit.md) breaks as it says.
7. The speed gate stays green, and a frame with no copy loads no more bytes than today
   (SPEC-pieces criterion 10).

## Boundaries

- Always: a change of a part goes through the kit version. Keep each byte that an agent wrote in a
  frame.
- Ask first: a change of a look value of the design system; a second library canvas.
- Never: write a frame to move a copy. Run the code of a frame on the server. Delete a frame or a
  canvas that this work did not make.

## Out of scope (deferred)

- **App frames and `design/`** (SPEC-pieces rules 1 to 9 and 17). The TSX folder goes into
  `kit_design` beside the parts, with the same design revision.
- **Switches, fixtures and the matrix** (SPEC-pieces rules 10 to 16). The next agent builds them
  on this base (§ The base for the next steps).
- **A finding at the put** for an edited copy. `parts.list` and the proof name it now. Add it when
  agents edit copies by hand again.
- **A draft main**, a publish as a step of its own (Figma). Add it when a team asks to change a
  main without a change of the screens.
- **Detach and swap** of a copy, and a tool that inserts a copy. An agent writes the markup.
- **A main in an app frame**, and a copy of an HTML part in an app frame.

## The base for the next steps

The agent of the switches (X6 to X11, SPEC-pieces rules 10 to 16) gets:

- `kit_design`: one row for each kit version that changes the design system, with its design
  revision and the revision of each part. A kit version with no row has the design of the row
  before it. The TSX folder `design/` and the fixtures (rule 15) go into this row, as `files` and
  `fixtures`, with the same design revision and the same write with a base.
- `designAt(kit)`: the design of any kit version, for a picture and a kept view.
- One publish path: a write of the design makes one new kit version, and gives a new document to
  each frame that depends on a changed part, and to no other frame. A capsule of `design/` is one
  more kind of part in that list.
- The board document field `parts`: the page draws a new iframe when the design of a frame
  changes. A switch value is a field of the page, not of the board: it does not use it.
