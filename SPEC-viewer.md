# Spec: viewer — V1

Module `viewer` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md),
[frames](SPEC-frames.md), [queue](SPEC-queue.md) and [design](SPEC-design.md).

## Objective

The browser page a person reaches by a share link ([frames](SPEC-frames.md)). It shows a canvas's
frames, lets the person pan, zoom and ask for changes, and shows each change an agent makes and
each request, live. It
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
3. An agent moves or removes a frame. Every tab shows it moved, or gone along with its pins. The
   requests of a removed frame stay in the panel, marked "may be outdated" ([queue](SPEC-queue.md)).
   A move is unreached until `frame.move` ships: the stage reads a shell's box once, so a moved
   frame would keep its old box for `Fit` and for what shows and goes live. The `frame.move` work
   fixes that, with a test that moves a frame far away and back.

### Lose the socket

1. While the socket is down, a `status` says `Reconnecting`. What the page shows may be behind.
2. When the socket is back, the page reads the whole board again and shows what changed while it
   was down. Only then does `Reconnecting` go.

### Ask for a change

1. A viewer presses the button `Request` (it shows pressed), and the canvas goes into request mode.
2. They click a place on a frame, or on the canvas out of all frames, for a request about the
   whole canvas. A textbox `Request` opens there. The page makes a client key for this request,
   and keeps the frame version that it shows.
3. They type and press the button `Send`. It sends `request.add` with the key and the version. A
   pin (button `Request #<n>`) shows at that place, in every tab on the canvas within 1 s, and the
   button `Request` turns off. While the socket is down, `Send` waits.
4. Escape, or the button `Cancel`, closes the textbox and sends nothing.
5. If the frame was removed meanwhile, nothing is saved. The textbox stays with the text and says
   that the frame is gone. An agent's change to the frame leaves the textbox as it is.
6. If the call faults (the socket drops, or the server fails), the textbox stays with the text and
   says it is not known yet whether it saved. It has no `Cancel` then. When the socket is back
   (or, after a server fault, when the viewer presses `Send`), the page sends the request again
   with the same key. The server saves a key once, so the request is never saved twice, and its
   answer says whether it saved.
7. If the canvas has too many open requests (`full`), or the viewer sends too fast (`slow`),
   nothing is saved: the textbox stays with the text and says why.

### When the link ends

1. A user unshares the canvas. Each open tab on the link is told at once: the server pushes the
   refusal `{ ended: true }`. A tab whose socket was down is told by its read when it is back.
2. The tab shows the ended page. If a request or an answer was being typed, the page keeps its
   text to copy, and says it was not sent, or that it is not known whether it saved.

### When a password is set

1. A user sets or changes the link's password. That ends every pass on the link
   ([frames](SPEC-frames.md)), and each open tab on it is told at once: the server pushes the
   refusal `{ locked: true }`. A tab whose socket was down is told by its read when it is back.
2. The tab goes back to the password page. If a request or an answer was being typed, its text
   stays visible there to copy, as on the ended page, and the page says it was not sent, or that it is not
   known whether it saved.

### Follow the requests

1. The toolbar has the button `Requests`. It always shows the count of requests that wait for a
   viewer: a question, a result to check, or "needs a person". Its name says the count, for
   example `Requests, 2 wait for you`. When the count is 0, the button has no count.
2. The button opens a panel (a `complementary` region named `Requests`). It has three groups, each
   with a heading and oldest first:
   - `For a viewer`: questions, results to check, and requests that need a person.
   - `In the queue`: waiting, and in work (with the name of the agent).
   - `Done`: accepted and closed. This group is collapsed when the panel opens.
3. Each row shows the number, the author, the start of the text, and the state. Each state has its
   own icon, color and word, so a viewer can tell the states apart without reading. A waiting
   request can also show the mark "may be outdated" ([queue](SPEC-queue.md)).
4. A searchbox `Find` above the groups keeps only the rows whose number, author or text matches.
5. Each change of a request shows in every tab within 1 s, with no reload. A lease that runs out
   shows with no write to the board: the board stores no "in work" and no "needs a person". The
   page derives each state as the queue spec says, from the board and its estimate of the server's
   time. The board carries the server's clock offset, and a clock capsule keeps the estimate.
6. A click on a row moves the canvas to the place of the request and opens it. A click on a pin
   opens its request. A request of a removed frame moves the canvas to where the frame was.
7. An open request (a `dialog` named `Request #<n>`) shows all its messages, oldest first, each
   with its kind, the name of its sender and its time. An HTML part shows in a sandboxed iframe,
   as a live document does. A result shows the pictures of the frame before and after, side by
   side. A question with options shows one button for each option, side by side.
8. The controls of an open request follow its state. Any viewer of the link can use them, and each
   use is a message with the name of the viewer.

   | State          | Controls                                                  | Call                       |
   | -------------- | --------------------------------------------------------- | -------------------------- |
   | waiting        | `Edit` (the text), `Close`                                | `request.edit`, `close`    |
   | in work        | none: it says which agent works on it                     |                            |
   | question       | an option button, or textbox `Answer` and `Send`; `Close` | `request.answer`, `close`  |
   | result         | `Accept`; `Open again`, with a textbox for the note       | `request.accept`, `reopen` |
   | needs a person | the reason; `Edit`, `Close`                               | `request.edit`, `close`    |
   | accepted       | `Open again`, with a textbox for the note                 | `request.reopen`           |
   | closed         | none                                                      |                            |

9. If the request changed state since the dialog opened (`wrongState`), nothing is saved. The
   dialog shows the new state and keeps the typed text. `full` and `slow` keep the text too and say
   why.
10. A request that changed since the last visit shows the mark `Changed`, and the button
    `Requests` also shows how many changed. The browser keeps in `localStorage`, for each canvas,
    the time of the last visit, and for each request, its `updated` time when the viewer last
    opened it. A request shows `Changed` when its `updated` is after both. When the canvas opens,
    the page reads the time of the last visit, then writes the time now.

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

The page reads `easel.board` (cells `frames`, `docs`, `requests` and `messages`, keyed by canvas,
and the server's clock offset). Its calls are:

- `share.open { link, password?, name }` ([frames](SPEC-frames.md)), once at the gate.
- `request.add { canvas, frameId, version, x, y, text, key }` ([queue](SPEC-queue.md)). `key` is
  the client key: one per request, the same on each retry of it.
- `request.edit`, `answer`, `accept`, `reopen` and `close` ([queue](SPEC-queue.md)), from the
  controls of an open request.

The pictures of a result (before and after) are pictures of frame versions. [frames](SPEC-frames.md)
keeps each version that a request refers to.

A read or a call can be refused with `{ ended: true }`, and the server pushes that refusal to open
tabs when the link ends. Then the page shows that the link has ended. A read or a call can be
refused with `{ locked: true }`, and the server pushes that refusal to open tabs when a password
set or changed ends their pass. Then the page shows the password page.

The behaviour above is checked against the statecharts in `docs/statecharts/`: `viewer-gate`,
`viewer-canvas`, `viewer-pin-post`, `viewer-pin-link` and `viewer-queue`. Until requests ship, the
gate as built is checked against `viewer-gate-password`: the full gate, with the canvas's three
camera controls.

## Rules

### Fact rules (the code graph decides)

1. Every board read runs `mayRead` first.
2. No page module writes `frames`, `docs`, `requests` or `messages`, and the page calls no frame
   operation.
3. No page module calls `fetch`, `XMLHttpRequest`, `EventSource` or `WebSocket`.
4. No page module imports a `.server.` file (the page build refuses one).
5. The page reads `docs` only by `of({ canvas, id })`, never by `where`.
6. Each stateful page feature (camera, live set, request mode, open request, connection status,
   clock, last visit) is a Tinker cell or resource. There is no useState, useEffect or useReducer.
7. The page's only calls are `share.open` and `request.add`, `edit`, `answer`, `accept`, `reopen`
   and `close`.
8. One page module adds the paint script, to the document it gives the iframe. No server module
   and no stored document carries it.
9. The panel reads time only from the clock capsule, never from `Date.now()`.
10. One page function derives the state of a request (queue spec, table `State`). The panel, the
    pin, the dialog and the count all use it.

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
6. A request's client key is made once, when its textbox opens, and every send of that request
   carries it. While it is not known whether a send saved, the textbox offers no `Cancel`.
7. The ended page, and the password page after `{ locked: true }`, keep the text of a request or
   an answer being typed, and never say "not sent" of one that may have saved.
8. The server refuses an `/rpc` upgrade whose `Origin` is present and is not `PUBLIC_ORIGIN`, so a
   frame's script (`Origin: "null"`) cannot open a socket of its own ([access](SPEC-access.md)
   judged rule 15).
9. An HTML part of a message runs in the same sandbox as a live document (judged rule 4), never in
   the page.
10. A refused viewer call (`wrongState`, `gone`, `full`, `slow`) never clears the typed text.
11. The mark `Changed` reads and writes only `localStorage`. It sends nothing to the server.

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
- A page test answers each state of a request on the board and finds its row in the right group,
  with its own icon and word, the right count on `Requests`, and the controls of the table.
- A page test with a moved clock shows a lease that runs out as waiting, or as "needs a person",
  with no board write.
- A page test with a stored last visit shows `Changed` on each request updated after it, and the
  mark goes when the viewer opens the request.
- The smoke has one canvas flow: open a board, frames show, pan and zoom.

## Out of Scope (Deferred)

- Editing anything in the browser.
- Cursors and presence of other viewers.
- A minimap.
