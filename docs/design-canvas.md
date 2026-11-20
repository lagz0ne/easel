# The design canvases

How easel keeps its design material on Doop: which canvas holds what, how the pages are named, and
how a part or a screen moves from draft to done. The reason for this structure is in
[decisions/design-canvases.md](decisions/design-canvases.md).

Status: **in migration** (2026-11-20). Step 0 is done; steps 1 to 6 are not. Until they are done,
the E4 design is on `easel · Design system` (`zPdfXgdRrQ`), as `docs/method.md` says.

## One workspace, two canvases, one archive

All easel design material is in the Doop workspace **easel** (`wEwPhtO4I6`). The workspace has one library canvas
and one product canvas. Each has its own reader and its own lifecycle.

| Canvas                                         | Holds                                                   | Who changes it                 |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| **easel · Design system** (`zPdfXgdRrQ`)       | The tokens, the component mains, Foundations, the guide | Only a change to the system    |
| **easel · Product design**                     | The screens and state sheets of each epic               | Each design of an epic         |
| **easel · Archive · viewer v0** (`3Io4CqJYjF`) | The first viewer design (old parts, old screens)        | Nobody. Read it for reference. |

- The Design system canvas is the **workspace library**. The Product design canvas uses its parts
  by their names: `<doop-use component="RequestRow">`. A part is never drawn again on a screen.
- A screen does not change while a part is in review. A part goes to the screens only when it is
  published and the Product design canvas pulls it.
- Do not start a new canvas for a round or for an epic. An epic gets a page.

## The pages

### easel · Design system

| Page              | What is on it                                                                         |
| ----------------- | ------------------------------------------------------------------------------------- |
| `0 · Read me`     | What this canvas is, its pages, how to change a part. Start here.                     |
| `1 · Foundations` | The Foundations frame: tokens and the rules S1 to S12 and T1.                         |
| `2 · Primitives`  | One element, no other part inside: Button, Count, StateBadge, Pin, Status, Avatar ... |
| `3 · Patterns`    | Parts that do one job and hold primitives: Card, RequestRow, Message, Composer ...    |
| `4 · Layout`      | Regions of a screen: Toolbar, Dock, Sidebar.                                          |
| `Archive`         | Retired parts, for reference only.                                                    |

The three levels are the ones that the guide `easel-system` already uses. Each part's description
starts with its level: `Primitive.`, `Pattern.` or `Layout.`

### easel · Product design

| Page                                      | What is on it                                                        |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `0 · Read me`                             | What this canvas is, the pages, how to start a design.               |
| `Work · E<n> <epic title>`                | One page for each epic in design. Screens on row 1, sheets on row 2. |
| `Archive · E<n> <epic title> (concluded)` | The concluded design of an epic. Explorations are deleted.           |

Example: `Work · E4 Comment and get a change`.

## Frame names

- A screen: `E<n>.<m> <what the person sees> (<IDs it proves>)`. Example:
  `E4.1 Ask for a change (N1 N2)`.
- A state sheet: `E<n>.<m> states: <what> (<IDs>)`. One sheet for each journey.
- An exploration: `E<n>.W<nn> <what>`. It stays `draft`. The index counts for each epic. Do not use
  an index again.
- A component main has the name of the component. Its frame is on the page of its level.

## Lifecycle

- **Draft is free.** A draft frame may break any rule. The proof counts it and does not check it.
- **Review is strict.** A frame that asks for sign-off (`needs_review`, `ready_for_dev`) uses the
  system only. `bun run design:proof` must print `design proof: OK` before you ask for review.
- **Only the human marks Ready for dev.** Only Ready-for-dev frames go to code.
- **Concluded.** When the epic's design is concluded, its page becomes
  `Archive · E<n> <epic title> (concluded)`. Delete the explorations on that page.

## Change a part

1. Change the main on **easel · Design system** (`update_component`). A new part goes on the page
   of its level, with a description that says when to use it and when to use another part.
2. A new value is a token first (`create_tokens`, light and dark, contrast checked), then the part
   uses it.
3. Run `bun run design:proof`. It checks the mains on the library pages.
4. Publish the library (`publish_library`). Then pull it into the Product design canvas
   (`sync_component`). Each screen that uses the part follows.
5. In the same ship, update `src/design` if the change is in code, and the proof's list of parts.

## Start a design for an epic

1. The epic's journeys and their fit criteria are agreed in `docs/epics.md`
   (`writing-requirements`).
2. Find two or three products that solve the same job (Figma, Linear, Vercel, Liveblocks). Name
   them on the sheet.
3. Make the page `Work · E<n> <epic title>` on **easel · Product design**.
4. Compose each screen from the library: layout parts first, then patterns, then primitives. Write
   new CSS only for the page grid. A missing part is made on the library first (see above).
5. Add the frames and the IDs to `scripts/design-proof.ts` in the same ship.
6. Prove the design round by round with `epic-flow`, until each ID is proven.

## Migration

Step 1 and the later steps wait until the E4 fix pass on `zPdfXgdRrQ` ends, because another agent
is editing that canvas now.

0. **Done** (2026-11-20, by the hub). The workspace `easel` (`wEwPhtO4I6`) exists. Its owner is the
   Doop agent account, as for `create`. `zPdfXgdRrQ` and `3Io4CqJYjF` are in it, with the names
   `easel · Design system` and `easel · Archive · viewer v0`. The agent key cannot make a
   workspace or move a canvas (those routes need a session). For such a change again, ask the hub
   (`hubq send`).
1. On `zPdfXgdRrQ`: make the library pages, move each main to the page of its level, and put
   Foundations on `1 · Foundations`. Put the level at the start of each description. Add the
   `0 · Read me` frame.
2. Publish the library.
3. Make `easel · Product design` in the workspace (`create_canvas`, `workspace_id=wEwPhtO4I6`), with `0 · Read me` and
   `Work · E4 Comment and get a change`. Copy the E4 frames to it. Their `<doop-use>` links to the
   library by name. Map the old frame IDs to the new ones, also in the prototype links.
4. Check each copy with a screenshot against its original. Then delete the E4 frames and the
   `E4 viewer` page on the library canvas.
5. Ship the change to `scripts/design-proof.ts` (two canvases, the new system pages, the new E4
   IDs), `docs/method.md`, `docs/epics.md` and `SPEC-design.md` together. The proof must print
   `design proof: OK`.
6. Copy the guide `easel-system` to the Product design canvas. Add the canvas map to it.
