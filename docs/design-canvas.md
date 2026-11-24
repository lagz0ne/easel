# The design canvases

How easel keeps its design material on easel itself (https://easel.vibea.dev): which canvas holds
what, how the pages are named, and how a part or a screen moves from draft to done. The reason for this structure is in
[decisions/design-canvases.md](decisions/design-canvases.md).

Status: **in use**. Since 2026-11-24 (D9-8) the canvases on easel are the only source. The Doop
canvases are not read any more. The record of the first migration (on Doop, 2026-11-20) is at the
end.

## Two canvases

All easel design material is on the easel https://easel.vibea.dev. It has one library canvas and
one product canvas. Each has its own reader and its own lifecycle.

| Canvas              | Holds                                                        | Who changes it              |
| ------------------- | ------------------------------------------------------------ | --------------------------- |
| **`design-system`** | The tokens, the component mains, Foundations                 | Only a change to the system |
| **`product`**       | The screens and state sheets of each epic, and the page Live | Each design of an epic      |

- An agent reads and writes the two canvases with the easel CLI or the easel MCP, as the member
  `vibea-claude` (`EASEL_CONFIG_HOME=~/.config/easel-agent`). Never delete a frame or a canvas.
- A screen on `product` holds a copy of each part that it uses. The copy keeps the ID of its main
  in `data-doop-instance` and its revision in `data-doop-rev`. A part is never drawn again on a
  screen.
- A copy does not follow its main by itself yet. That is V5 of E11, deferred to
  [SPEC-pieces](../SPEC-pieces.md). Until then, change each copy by hand (see "Change a part"). The
  proof counts the parts whose copies differ.
- Do not start a new canvas for a round or for an epic. An epic gets a page.
- **Tokens are copied.** Each frame on `product` has a copy of the tokens of `design-system` in its
  `<style data-doop-tokens>` block. A token changes on `design-system` first, then on each copy.
  The proof (S13) finds a token that is not the same on the two canvases.
- The page Live of `product` is the job's page, not a design page (SPEC-live-screens.md). Do not
  put a design there.

## The pages

### `design-system`

| Page (key)            | What is on it                                                                         |
| --------------------- | ------------------------------------------------------------------------------------- |
| `Read me` (`read-me`) | What this canvas is, its pages, how to change a part. Start here.                     |
| `Foundations`         | The Foundations frame: tokens and the rules S1 to S12 and T1.                         |
| `Primitives`          | One element, no other part inside: Button, Count, StateBadge, Pin, Status, Avatar ... |
| `Patterns`            | Parts that do one job and hold primitives: Card, RequestRow, Message, Composer ...    |
| `Layout`              | Regions of a screen: Toolbar, Dock, Sidebar.                                          |

The proof reads the pages `foundations`, `primitives`, `patterns` and `layout`. Each part's
description starts with its level: `Primitive.`, `Pattern.` or `Layout.`

### `product`

| Page                                      | What is on it                                                     |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `0 · Read me`                             | What this canvas is, the pages, how to start a design.            |
| `Work · E<n> <epic title>`                | One page for each epic in design. See "An epic page" below.       |
| `Work · E<n> · click-path copies`         | Copies of a screen that only the prototype needs (see below).     |
| `Archive · E<n> <epic title> (concluded)` | The concluded design of an epic. Explorations are deleted.        |
| `Live`                                    | The live screens of each build beside their designs (E11, V1-V3). |

Example: `Work · E4 Comment and get a change`.

### An epic page

A person reads the page from the top left, without help. This follows the create canvas
(`create · Product design`: a sheet first, one page for each epic) and Figma sections (a title
over a group of frames). easel has no sections, and each frame is a full HTML document, so a group
is shown by a small **header frame** above its screens and by space, never by a frame behind them.

1. **The sheet** `E<n>.00 Requirements and review`, at x 0, y 0. It is the traceability matrix:
   each requirement ID of the epic, its need and fit criterion, the frames that prove it (links),
   and the last review verdict. It says how to read the page and names the prior art.
2. **Each journey, top to bottom**, at the right of the sheet: a grey **title** (at most
   4400 × 620) with the actor, need, trigger, the two ends, and a link that opens the prototype at
   the start of the journey.
3. **Groups under the title, by number.** Group 0 is the journey's state sheet. Each other group
   is one short path: 1 to 5 screens in click order, left to right. Its **header** (at most 2560
   px wide, as tall as its text) has the number, the title, one or two sentences that say what
   happens, and the IDs that the screens prove. Groups wrap into rows of at most 10,400 px.
4. **Click-path copies** go to `Work · E<n> · click-path copies`, in the same layout. A link
   always opens a frame at its top, so a screen with a tab (Before or After) needs one copy for each
   tab. People read the screen on the epic page; only the prototype needs the copies. A prototype
   link works across pages. Change a copy when you change its screen.

**No frame behind a screen.** The canvas draws each frame as a picture, and up close as a live
page. Frames behind the screens made the E4 page 3 to 5 times slower to open, zoom and pan (Doop's
maintainer measured it on Doop, 2026-11-21: 260 Mpx of backdrop under 50 Mpx of screens). Headers
and titles are about a third of the screens' area. Do not use a frame for a colour.

**Space shows the groups.** 120 px between screens in a group, 400 px between groups side by side,
600 px between rows, 900 px between journeys, and 220 px between a header and its screens. The
canvas draws frame names at one size on the screen, so at low zoom a name covers more of the canvas above
its frame.

**No endless animation in a canvas frame.** A live frame with an endless animation paints all the
time. A part that shows a waiting state pulses a few times, then rests (the Composer pulses 4
times). The app may animate until the wait ends.

Headers and titles stay `draft`, and the proof does not check them. Keep each screen as its own
frame: a link to a state inside a tall frame opens at its top, and the prototype needs each state
as a frame.

## Frame names

- A screen: `E<n>.<m> <what the person sees> (<IDs it proves>)`. Example:
  `E4.1 Ask for a change (N1 N2)`.
- A state sheet: `E<n>.<m> states: <what> (<IDs>)`. One sheet for each journey.
- The epic sheet: `E<n>.00 Requirements and review`.
- A header: a journey title `E<n>.<m> · <title>`, or a group `E<n>.<m> · <number> <title>`.
- An exploration: `E<n>.W<nn> <what>`. It stays `draft`. The index counts for each epic. Do not use
  an index again.
- A component main has the name of the component. Its frame is on the page of its level.

## Lifecycle

- **Draft is free.** A draft frame may break any rule. The proof counts it and does not check it.
- **Review is strict.** A frame that asks for sign-off (status `ready`) uses the system only.
  `bun run design:proof` must print `design proof: OK` before you ask for review.
- **Only the human marks a frame ready.** An accepted request also starts the change of the app
  (E11 V4, SPEC-live-screens.md).
- **Concluded.** When the epic's design is concluded, its page becomes
  `Archive · E<n> <epic title> (concluded)`. Delete the explorations on that page.

## Change a part

1. Change the main on **`design-system`** (`easel put` or `put_frame`). A new part goes on the
   page of its level, with a description that says when to use it and when to use another part.
2. A new value is a token first (light and dark, contrast checked), then the part uses it. Ask the
   user before you change a value of the look. Copy the token to the frames of **`product`** too
   (S13).
3. Change each copy of the part on `product`, and give it the revision of the main.
4. Run `bun run design:proof`. It checks the mains, the copies (S5) and the page Live (V1, V2,
   V6).
5. In the same ship, update `src/design` if the change is in code, and the proof's list of parts.

## Start a design for an epic

1. The epic's journeys and their fit criteria are agreed in `docs/epics.md`
   (`writing-requirements`).
2. Find two or three products that solve the same job (Figma, Linear, Vercel, Liveblocks). Name
   them on the sheet.
3. Make the page `Work · E<n> <epic title>` on **`product`** (`easel page new`).
4. Compose each screen from the library: layout parts first, then patterns, then primitives. Write
   new CSS only for the page grid. A missing part is made on the library first (see above).
5. Add the sheet `E<n>.00` and the headers, and put the screens in their groups (see "An epic
   page"). Add the page key to `EPIC_PAGES` in `scripts/design-proof.ts`
   in the same ship. The proof finds the screens (1280 × 800) and the sheets on that page.
6. Prove the design round by round with `epic-flow`, until each ID is proven.

## Migration on Doop (done, 2026-11-20)

This record is history. The canvases moved to easel after it; D9-8 (2026-11-24) ended the reads
of Doop.

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
