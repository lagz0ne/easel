# Spec delta: `pages`, the pages of a canvas and the place of each frame

Status: approved (user, 2026-11-23: "Approve").

## Objective

The end goal of Round 1 (the user, 2026-11-23): move the design from Doop to easel and develop it
further in easel. A Doop canvas has pages: `easel · Design system` has 6 (Read me, Foundations,
Primitives, Patterns, Layout, Archive) and `easel · Product design` has 5 (Read me, E4, E4
click-path copies, E3, E8). Each page holds frames in rows. The user said on 2026-11-23: "We missed
out pages of doop. Currently easel has only one page".

Today an easel canvas is one board, and a put places each new frame to the right of the others at
y 0. No call sets or changes the place of a frame (moving is deferred in E2). So the move made one
canvas for each Doop page, with five share links and no way from one page to the next, and lost the
rows of each page.

After this delta, a canvas has pages. Each frame is on one page, at a place that a put or a move
sets. The viewer shows one page at a time and a list of the pages. One share link opens the
canvas, and a person goes from page to page.

Prior art:

- **Figma pages.** A file has a list of pages at the left. Each page is its own board. A link can
  name a page (`node-id`). A frame moves to another page.
- **Doop pages.** The same list, and a prototype start for each page.
- **Miro and FigJam.** A board has frames at a place, and an agent or a person moves them.

## Current behavior

- `canvas.create`, `canvas.list`, `canvas.delete`, `canvas.share` and `canvas.unshare` work on a
  canvas. A share link opens the canvas (SPEC-frames § Contract).
- `frame.put` makes a frame to the right of the others, at y 0 (SPEC-frames, step 1). `frame.move`
  is in the contract of SPEC-frames (`moved | gone`), but it is not built: no call, command or
  tool sets a place, and moving a frame by hand is deferred (E2).
- The viewer shows each frame of the canvas, with Find (S15), the Requests panel and the controls.

## New behavior

### Pages

1. A canvas has 1 to 50 pages, in an order. A new canvas has one page, `Page 1`. A page has a name
   (1 to 80 characters) and a key, its slug, as a canvas has.
2. `page.create`, `page.rename`, `page.order` and `page.delete` change the pages. A delete of a page
   with frames is refused `notEmpty`, with the count. The last page cannot be deleted.
3. Each frame is on one page. A frame made before this delta is on the first page.

### The place of a frame

4. `frame.put` that makes a frame takes `page`, and `x` and `y` (whole numbers, 0 to 100 000). With
   no place, the frame goes to the right of the frames of its page, at y 0, as today.
5. `frame.move` takes `x`, `y` and `page`. It changes the place, and the page if one is given. It
   makes no frame version: a request on the frame stays on it.
6. The CLI: `easel put <canvas> <file> --page <page> --at <x>,<y>`, `easel move <canvas> <id>
--at <x>,<y> [--page <page>]`, `easel pages <canvas>`, `easel page new <canvas> <name>`,
   `easel page rename|rm <canvas> <page>`. MCP: `put_frame` takes `page`, `x` and `y`; new tools
   `move_frame`, `list_pages`, `create_page`.

### The viewer

7. The viewer shows the frames of one page. A list of the pages, in the dock, shows each name and
   the count of its frames. A pick shows that page at Fit.
8. The address names the page: `/s/<link>?page=<page>`. A link with no page opens the first page. A
   reload keeps the page.
9. Find (S15) finds a frame on each page. A pick shows its page, then the frame.
10. The Requests panel lists the requests of each page, with the name of the page. A pick of a
    request on another page shows that page, then the frame.
11. A switch of the board (SPEC-pieces § Switches) is for the canvas: a pick stays when the person
    goes to another page.

### Speed

12. The open of a share link loads the frames of one page only. The list of pages is names and
    counts. So Q1 holds for each page: a page of 200 frames opens in the budget of 200 frames, and
    the other pages cost nothing.

## Contract

```ts
type PageInfo = { key: string; name: string; frames: number }

"page.list":   { kind: "found"; pages: PageInfo[] } | { kind: "gone" }
"page.create": { kind: "created"; key: string } | { kind: "taken" } | { kind: "full" } | { kind: "gone" }
"page.rename": { kind: "renamed" } | { kind: "taken" } | { kind: "gone" }
"page.order":  { kind: "ordered" } | { kind: "gone" }
"page.delete": { kind: "deleted" } | { kind: "notEmpty"; frames: number } | { kind: "last" }
             | { kind: "gone" }
"frame.move":  { kind: "moved" } | { kind: "unchanged" } | { kind: "gone" }
```

- `FrameInfo` gets `page: string`. `frame.put` takes `page?`, `x?`, `y?`. `frame.move` takes
  `{ canvas, id, x, y, page? }`. A page that the canvas does not have is `gone`.
- The board of a share link gets the list of pages, and the frames of the page that the tab shows.

## Model

The page that a tab shows, Find, a request on another page, and a frame that moves to another page
while a tab shows it, are new state of the viewer. So a TLA+ model and its chart come first
(`viewer-pages`): two pages, a frame that moves between them, a tab, a pick of a page, a pick of a
request on the other page, and a reload. Its rules:

- A tab shows the frames of one page, and each of them.
- A pick of a request or of a found frame shows its page and the frame, also after a move.
- A reload shows the same page.

The chart is [viewer-pages](docs/statecharts/viewer-pages.md) (66 states, each rule holds).
[viewer-pages-old-page](docs/statecharts/viewer-pages-old-page.md) breaks on purpose: a pick of a
request that opens the page that the request names shows a page with no frame after a move. So the
pick asks for the frame, and the answer gives its page now.

## Fact rules

1. Each frame is on exactly one page of its canvas.
2. A move writes no frame version.
3. Each canvas has at least one page.

## Success criteria

1. **The move.** `easel · Design system` is one canvas with its 5 pages (Read me, Foundations,
   Primitives, Patterns, Layout). Each frame is at its place from Doop. One share link opens it, and
   the list of pages goes to each page.
2. An agent moves a frame to another place and to another page with `move_frame`. Each open tab
   shows the new place within 1 second.
3. A request on a frame of page 2, picked in the Requests panel on page 1, shows page 2 and the
   frame.
4. A share link with `?page=patterns` opens that page; a reload keeps it.
5. The open of a page of 20 frames, on a canvas with 5 pages of 20 frames each, is in the budget of
   20 frames.
6. The model holds its rules. `tinker check` finds no exit that a test does not reach.

## Boundaries

- Always: a page is part of its canvas. One share link, one password, one list of requests for the
  canvas.
- Ask first: a share link for one page only.
- Never: a move that makes a frame version.

## Out of scope (deferred)

- **A share link for one page.** Add it when a team shares a page with a person who must not see
  the other pages.
- **A prototype start for each page** (Doop). Add it with the flows of screens (SPEC-pieces,
  deferred).
- **Moving a frame by hand in the viewer** (drag). Agents move frames in Round 1. Add the drag when
  a person of the team arranges a board.
- **Sections or groups on a page** (Figma sections). Add them when a page holds more than one group
  that a person must name.
