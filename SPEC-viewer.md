# Spec: viewer — V1

Module `viewer` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md),
[frames](SPEC-frames.md), [queue](SPEC-queue.md) and [design](SPEC-design.md).

## Objective

The browser page a person reaches by a share link ([frames](SPEC-frames.md)). It shows a canvas's
frames, lets the person pan, zoom and comment, and shows each change an agent makes, live. It
changes no frame. The speed it must reach is set in [canvas-speed](docs/canvas-speed.md), and the
rules below hold it to that.

## Journeys

### Open the link

1. The page asks for the viewer's name once per browser (textbox `Your name`, button `Continue`),
   before its first `share.open`, which takes the name.
2. The rest of the gate (password, wrong tries, an unknown link) is in
   [frames](SPEC-frames.md).

### See the frames

1. A viewer opens a canvas. Each frame shows at its place as a shell: its name and its picture (an
   img named for the frame).
2. A frame in view, at a zoom where it can be read (30% or more), shows its live document (an
   iframe titled with the frame's name). The viewer adds a small paint script to the document it
   gives the iframe; inside the sandbox, the script posts once the document has painted. Until
   then, its picture stays on top, so the viewer never sees a blank white box.
3. A frame far out of view draws nothing.
4. With pictures off (no Chromium on the server), a shell shows a plain card. The name sits on a
   label above the card, as Figma and tldraw show frame names, not on the card.
5. An empty canvas says it has no frames yet, once a board read has arrived. It still says so
   while `Reconnecting`; before any read has arrived it says nothing of the frames.

### Pan and zoom

1. The viewer drags on the canvas, or scrolls, and it pans.
2. Ctrl+scroll or a pinch zooms around the pointer. Buttons `Zoom in`, `Zoom out` and `Fit` in the
   toolbar do the same. A `status` shows the zoom, rounded down to steps of 10% (26% reads 20%).
3. While the canvas moves, the set of live documents stays as it is. When it rests, the frames now
   in view go live, nearest first, one at a time. The one change allowed mid-move: a frame an
   agent deletes goes at once.

### Watch an agent work

1. An agent writes a frame's document. Every open tab shows the new version: a new picture, and
   the live document reloads with no white flash.
2. An agent adds a frame. It shows in every tab.
3. An agent moves or deletes a frame. Every tab shows it moved, or gone along with its pins.
   A move is unreached until `frame.move` ships: the stage reads a shell's box once, so a moved
   frame would keep its old box for `Fit` and for what shows and goes live. The `frame.move` work
   fixes that, with a test that moves a frame far away and back.

### Lose the socket

1. While the socket is down, a `status` says `Reconnecting`. What the page shows may be behind.
2. When the socket is back, the page reads the whole board again and shows what changed while it
   was down. Only then does `Reconnecting` go.

### Pin a comment

1. A viewer presses the button `Comment` (it shows pressed), and the canvas goes into comment mode.
2. They click a place on a frame, and a textbox `Comment` opens there. The page makes a client key
   for this comment.
3. They type and press the button `Post`. It sends `comment.add` with the key. A pin (button
   `Comment #<n>`) shows at that place, in every tab on the canvas, and the button `Comment` turns
   off. While the socket is down, `Post` waits.
4. Escape, or the button `Cancel`, closes the textbox and posts nothing.
5. If the frame was deleted meanwhile, nothing is posted, and a `status` says the frame is gone.
   An agent's change to the frame leaves the textbox as it is.
6. If the call faults (the socket drops, or the server fails), the textbox stays with the text and
   says it is not known yet whether it saved. It has no `Cancel` then. When the socket is back
   (or, after a server fault, when the viewer presses `Post`), the page sends the comment again
   with the same key. The server saves a key once, so the comment never posts twice, and its
   answer says whether it saved.
7. If the canvas has too many open comments (`full`), or the viewer posts too fast (`slow`),
   nothing is saved: the textbox stays with the text and says why.

### When the link ends

1. A user unshares the canvas. Each open tab on the link is told at once: the server pushes the
   refusal `{ ended: true }`. A tab whose socket was down is told by its read when it is back.
2. The tab shows the ended page. If a comment was being typed, the page keeps its text to copy,
   and says it was not posted, or that it is not known whether it saved.

### When a password is set

1. A user sets or changes the link's password. That ends every pass on the link
   ([frames](SPEC-frames.md)), and each open tab on it is told at once: the server pushes the
   refusal `{ locked: true }`. A tab whose socket was down is told by its read when it is back.
2. The tab goes back to the password page. If a comment was being typed, its text stays visible
   there to copy, as on the ended page, and the page says it was not posted, or that it is not
   known whether it saved.

### Follow the queue

1. A panel (a `complementary` region named `Comments`) lists the canvas's comments, oldest first.
   Each shows its number, author, text and state: open, claimed (with the agent's name), stuck,
   or done.
2. When an agent claims a comment, every tab shows it as claimed at once.
3. When the agent resolves it, it shows as done, with the agent's reply. When it gives the claim
   back, it shows as open at once.
4. If an agent's lease runs out before it resolves, the comment shows as open again, with no write
   to the board: the board stores no `claimed` state. A comment shows as claimed while its
   `claimedUntil` is ahead of the server's time. The board carries the server's clock offset, and
   a clock capsule keeps the page's own estimate of server time.
5. A comment whose last allowed claim ran out shows as stuck ([queue](SPEC-queue.md)).
6. Clicking a comment in the panel moves the canvas to its frame and opens its pin.

## Numbers

The canvas's numbers, from `docs/canvas-speed.md`. A margin is a share of the viewport's own
width and height, added on each side of it.

| What                   | Number                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| Live documents at rest | 12 at most (decision C7)                                              |
| Reading zoom           | 30%: under it, no document is live                                    |
| Goes live              | a frame within 0.1 of the view, at rest                               |
| Stays live             | a live frame within 0.5 of the view, at rest                          |
| Shell shows            | a frame within 0.5 of the view                                        |
| Shell hidden           | at rest, a frame past 0.75; while moving, only past 1.5               |
| Rest                   | 120 ms with no pan or zoom                                            |
| Going live             | one new iframe per animation frame, nearest the view's centre first   |
| Paint wait             | the picture stays on top until the paint post, or 1.5 s               |
| Zoom                   | 0.1% to 400%; a button or a wheel notch is ×1.25                      |
| Fit                    | a 40 px edge; never past 100%                                         |
| Zoom status            | rounded down: steps of 10%; under 10% of 1%; under 1% of 0.1%         |
| Label                  | kept at its screen size; rewritten after a 10% zoom drift and at rest |

A shell's picture is its frame's address on the board: its version and its key `k`, at scale 0.5,
or 0.25 when 0.5 would be over 8 megapixels. Past that, and with pictures off (no `k`), the shell
is the plain card of "See the frames" step 4: a colour that is not white, under the frame's name on
its label. A picture that fails to load (a busy server answers 503) is asked again after 1 s, 2 s
and 4 s; after the third try the card shows.

## Contract

The page reads `easel.board` (cells `frames`, `docs` and `comments`, keyed by canvas, and the
server's clock offset). Its calls are two:

- `share.open { link, password?, name }` ([frames](SPEC-frames.md)), once at the gate.
- `comment.add { canvas, frameId, x, y, body, key }` ([queue](SPEC-queue.md)). `key` is the
  client key: one per comment, the same on each retry of it.

A read or a call can be refused with `{ ended: true }`, and the server pushes that refusal to open
tabs when the link ends. Then the page shows that the link has ended. A read or a call can be
refused with `{ locked: true }`, and the server pushes that refusal to open tabs when a password
set or changed ends their pass. Then the page shows the password page.

The behaviour above is checked against the statecharts in `docs/statecharts/`: `viewer-gate`,
`viewer-canvas`, `viewer-pin-post`, `viewer-pin-link` and `viewer-queue`. Until comments ship, the
gate as built is checked against `viewer-gate-password`: the full gate, with the canvas's three
camera controls.

## Rules

### Fact rules (the code graph decides)

1. Every board read runs `mayRead` first.
2. No page module writes `frames`, `docs` or `comments`, and the page calls no frame operation.
3. No page module calls `fetch`, `XMLHttpRequest`, `EventSource` or `WebSocket`.
4. No page module imports a `.server.` file (the page build refuses one).
5. The page reads `docs` only by `of({ canvas, id })`, never by `where`.
6. Each stateful page feature (camera, live set, comment mode, connection status, clock) is a
   Tinker cell or resource. There is no useState, useEffect or useReducer.
7. The page's only calls are `share.open` and `comment.add`.
8. One page module adds the paint script, to the document it gives the iframe. No server module
   and no stored document carries it.
9. The panel reads time only from the clock capsule, never from `Date.now()`.

### Judged rules (need reading the code)

1. A pan or a zoom writes one transform to the DOM. It does not render React on each pointer move.
2. The set of live frames changes only when the canvas rests. The one exception: a frame an agent
   deletes leaves the set at once, also during a move.
3. A shell's picture stays on top until its document posts that it painted, or until 1.5 s pass.
   A new version puts the new picture back on top until the reloaded document paints.
4. A frame's document runs in an iframe with `sandbox="allow-scripts"` and no
   `allow-same-origin`, so it cannot read the page, its storage or the pass.
5. `Reconnecting` shows from the moment the socket drops until the full board read after
   reconnect has arrived.
6. A comment's client key is made once, when its textbox opens, and every send of that comment
   carries it. While it is not known whether a send saved, the textbox offers no `Cancel`.
7. The ended page, and the password page after `{ locked: true }`, keep the text of a comment
   being typed, and never say "not posted" of one that may have saved.
8. The server refuses an `/rpc` upgrade whose `Origin` is present and is not `PUBLIC_ORIGIN`, so a
   frame's script (`Origin: "null"`) cannot open a socket of its own ([access](SPEC-access.md)
   judged rule 15).

### Accepted risk

A frame's script can read the page's URL through `document.baseURI`, and the page URL holds the
share link. The sandbox (judged rule 4) keeps the tab's storage, cookies, pass and socket from it,
and judged rule 8 keeps it from opening a socket, but it can send the link elsewhere. The author
owns the canvas and wrote the script, so this is accepted: it gives no one more than the author
already gave.

## Success Criteria

- Page tests find every control above by its role and name.
- On a board of 200 frames, at most 12 documents are live at rest (`docs/canvas-speed.md`).
- No white box, measured by screencast: each of the 200 test frames fills its box with a colour
  that is not white. In a screencast (CDP `Page.startScreencast`) of a pan across the whole board,
  a zoom, and an agent's write to a live frame, no captured image shows a frame's box more than
  5% white. Deferred: it is not built yet. Until then, browser tests hold the rule it measures (a
  picture stays on top until its document paints, also when a frame goes live again). A script
  over the smoke's built server will measure it: it drives the pan, the zoom and the write with
  CDP's screencast on, and counts the white pixels in each frame's box in each image.
- A test replays each statechart's steps in `docs/statecharts/viewer-*.md` and holds each of its
  rules.
- The smoke has one canvas flow: open a board, frames show, pan and zoom.

## Out of Scope (Deferred)

- Editing anything in the browser.
- Cursors and presence of other viewers.
- A minimap.
