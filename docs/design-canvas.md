# The design canvases

How easel keeps its design material on Doop: which canvas holds what, how the pages are named, and
how a part or a screen moves from draft to done. The reason for this structure is in
[decisions/design-canvases.md](decisions/design-canvases.md).

Status: **in use** (2026-11-20). The migration is done; its record is at the end.

## One workspace, two canvases, one archive

All easel design material is in the Doop workspace **easel** (`wEwPhtO4I6`). The workspace has one library canvas
and one product canvas. Each has its own reader and its own lifecycle.

| Canvas                                         | Holds                                                   | Who changes it                 |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| **easel · Design system** (`zPdfXgdRrQ`)       | The tokens, the component mains, Foundations, the guide | Only a change to the system    |
| **easel · Product design** (`xFJSTXA-v5`)      | The screens and state sheets of each epic               | Each design of an epic         |
| **easel · Archive · viewer v0** (`3Io4CqJYjF`) | The first viewer design (old parts, old screens)        | Nobody. Read it for reference. |

- The Design system canvas is the **workspace library**. The Product design canvas uses its parts
  by their names: `<doop-use component="RequestRow">`. A part is never drawn again on a screen.
- A screen does not change while a part is in review. A part goes to the screens only when it is
  published and the Product design canvas pulls it.
- Do not start a new canvas for a round or for an epic. An epic gets a page.
- **Tokens are copied.** Doop does not share tokens through a library. The Product design canvas
  has a copy of the library tokens. A token changes on the library first, then on the copy. The
  proof (S13) finds a token that is not the same on the two canvases.
- Each canvas has the guide `easel-system`, with the same text. Change it on both.

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

| Page                                      | What is on it                                                 |
| ----------------------------------------- | ------------------------------------------------------------- |
| `0 · Read me`                             | What this canvas is, the pages, how to start a design.        |
| `Work · E<n> <epic title>`                | One page for each epic in design. See "An epic page" below.   |
| `Work · E<n> · click-path copies`         | Copies of a screen that only the prototype needs (see below). |
| `Archive · E<n> <epic title> (concluded)` | The concluded design of an epic. Explorations are deleted.    |

Example: `Work · E4 Comment and get a change`.

### An epic page

A person reads the page from the top left, without help. This follows the create canvas
(`create · Product design`: a sheet first, one page for each epic) and Figma practice (one page
for one kind of material, a section for each flow).

1. **The sheet** `E<n>.00 Requirements and review`, at x 0, y 0. It is the traceability matrix:
   each requirement ID of the epic, its need and fit criterion, the frames that prove it (links),
   and the last review verdict. Its status box says how to read the page and names the prior art.
2. **One band for each journey**, top to bottom, at the right of the sheet. A band is:
   - a **banner** `E<n>.<m> · <journey title>` (640 × 800): actor, need, trigger, the two ends,
     the lines of the band, and a link that opens the prototype at the start of the journey;
   - the journey's **state sheet**;
   - the **screens in click order**, left to right. A journey with more than one path has one
     line for each path, under the first. The banner names each line.
3. **Click-path copies** go to `Work · E<n> · click-path copies`. A Doop link always opens a frame
   at its top, so a screen with a tab (Before or After) needs one copy for each tab. People read
   the screen on the epic page; only the prototype needs the copies. A prototype link works across
   pages. Change a copy when you change its screen.

Do not put all states of a screen into one tall frame (create does this). A link to a state in
such a frame opens at its top, and the prototype needs each state as a frame.

## Frame names

- A screen: `E<n>.<m> <what the person sees> (<IDs it proves>)`. Example:
  `E4.1 Ask for a change (N1 N2)`.
- A state sheet: `E<n>.<m> states: <what> (<IDs>)`. One sheet for each journey.
- The epic sheet: `E<n>.00 Requirements and review`. A journey banner: `E<n>.<m> · <title>`.
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
   uses it. Copy the token to **easel · Product design** too (S13).
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
5. Add the sheet `E<n>.00`, a banner for each journey, and put the frames in bands (see "An epic
   page"). Add the frames and the IDs to `scripts/design-proof.ts` in the same ship.
6. Prove the design round by round with `epic-flow`, until each ID is proven.

## Migration (done, 2026-11-20)

The E4 fix pass on `zPdfXgdRrQ` ended first (easel-5f, after `0a7e313`).

0. The hub made the workspace `easel` (`wEwPhtO4I6`), with the Doop agent account as owner, as
   for `create`, and moved and renamed the two canvases. The agent key cannot make a workspace or
   move a canvas (those routes need a session). For such a change again, ask the hub
   (`hubq send`).
1. On `zPdfXgdRrQ`: the pages `0 · Read me` to `4 · Layout` and `Archive`; each main on the page
   of its level; Foundations on `1 · Foundations`; the level at the start of each description; a
   `0 · Read me` frame. The component IDs did not change.
2. The library is published to the workspace (30 parts).
3. `easel · Product design` (`xFJSTXA-v5`) is in the workspace, with a copy of the 52 tokens
   (light and dark), `0 · Read me` and `Work · E4 Comment and get a change`. The 60 E4 frames are
   copied. Each instance links to the library by name and keeps the library's component ID. The
   prototype links use the new frame IDs; the prototype starts on E4.1 Ask for a change.
4. The rendered HTML of each copy is the same as its original, byte for byte, after the frame IDs
   are mapped (60 of 60). Then the E4 frames and the `E4 viewer` page on the library were
   deleted. The old HTML and the map of old to new IDs are in
   `~/work/tmp/easel-doop/backup-e4-old/`.
5. `scripts/design-proof.ts` reads the two canvases, the new system pages and the new E4 IDs, and
   checks the tokens (S13). Its trace is the same as before the move.
6. The guide `easel-system` is on both canvases, with the canvas map.
