# Spec: viewer — V1

Module `viewer` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md),
[frames](SPEC-frames.md), [queue](SPEC-queue.md), [design](SPEC-design.md) and [kit](SPEC-kit.md).

## Objective

The browser page a person reaches by a share link ([frames](SPEC-frames.md)). It shows a canvas's
frames, lets the person pan, zoom and ask for changes, and shows each change an agent makes and
each request, live. It
changes no frame. The speed it must reach is set in [canvas-speed](docs/canvas-speed.md), and the
rules below hold it to that.

The design is on the Doop canvas [easel · Product design](https://doop.vibea.dev/c/xFJSTXA-v5),
page `Work · E4 Comment and get a change` (E4.1 to E4.4). Where this spec and a screen disagree,
this spec wins, and the screen gets a fix.

## Journeys

### The page

1. A toolbar at the top shows the name of the canvas, and the status `Reconnecting` while the
   socket is down (E4.4).
2. A dock at the bottom centre of the canvas holds the canvas tools: the button `Request` (tooltip
   "Ask for a change"), the button `Requests` (tooltip "Requests on this canvas"), the button
   `Find` (tooltip "Find a frame (/)"), then `Zoom out`,
   the zoom `status`, `Zoom in` and `Fit`. The buttons show icons, and their names are their
   accessible names. A button shows pressed while its mode or its card is on.
3. The card `Requests` floats over the canvas at its right edge, 12 px from the top, right and
   bottom edges. The canvas and the dock keep the full width. Nothing
   on the canvas moves when the card opens, changes or closes, as the comments of Figma and
   Linear. Decided on 2026-11-23 (E4.4, requests #4 and #11).

### Open the link

1. The page asks for no name when the link opens. The viewer sees the canvas at once (after the
   password, if the link has one). The first `Send` of a request asks for the name in the same
   popover (textbox `Your name`), once per browser, and the browser keeps it. A viewer who only
   looks gives no name. `share.name` gives the name to the pass that the tab holds
   ([frames](SPEC-frames.md)): the page does not open the link again, so it does not ask the
   password again. A browser that kept a name sends it with `share.open`, so its first `Send` asks
   nothing. Decided on 2026-11-21 in the E3 design (page `Work · E3 Share and look`),
   as Pastel, BugHerd and Markup.io do.
2. While the link opens, the page shows the empty canvas and no text, as Figma and Miro do. The
   status `Opening the link` is for a screen reader only (user, 2026-11-23: "if I have the link
   already, I expect the page to open right off").
3. The rest of the gate (password, wrong tries, an unknown link) is in
   [frames](SPEC-frames.md).

### See the frames

1. A viewer opens a canvas. Each frame shows at its place as a shell: its name and its picture (an
   img named for the frame).
2. A frame in view, at a zoom where it can be read (30% or more), shows its live document (an
   iframe titled with the frame's name). The iframe gets `compose` of the frame's document, its
   made CSS and the current kit version ([kit](SPEC-kit.md)), so it shows in the look of the team.
   The viewer adds a small paint script to the end of that document; inside the sandbox, the script posts once the document has painted. Until
   then, its picture stays on top, so the viewer never sees a blank white box. An app frame
   ([kit](SPEC-kit.md) § App frames) goes live in the same way: its iframe gets `compose` of its
   JS, its made CSS and its kit version's runtime, and its app mounts in its own Tinker scope
   before the paint post (build order item 5 of [frame-apps](docs/decisions/frame-apps.md)).
   When an app frame leaves the live set (out of view at rest, deleted, or a new version), the
   page posts `close` to it and waits for `closed`, at most 200 ms, before it removes the iframe
   (the chart [kit-app-frame](docs/statecharts/kit-app-frame.md)).
   A capsule frame posts its axes on its port. Then the dock offers a locale for the canvas,
   and the frame's label offers its data states. A pick composes the frame again in a new scope
   ([kit](SPEC-kit.md) § The capsules, "The axes in the viewer"; the chart
   [kit-frame-axes](docs/statecharts/kit-frame-axes.md)).
   An app frame can also post its controls, each at its place. A `top` control is in the label
   row, and a `left` or `right` control is in a column at that edge of the frame. For `panel`
   controls, the label has a button `Controls`, which opens the panel `Controls` in the place of
   `Requests`. A control changes the state of the live document, with no new document ([kit](SPEC-kit.md) § The capsules, "The controls in the
   viewer"; the chart [kit-frame-controls](docs/statecharts/kit-frame-controls.md)).
3. A frame far out of view draws nothing.
4. With pictures off (no Chromium on the server), a shell shows a plain card. The name sits on a
   label above the card, as Figma and tldraw show frame names, not on the card.
5. An empty canvas says it has no frames yet, once a board read has arrived. It still says so
   while `Reconnecting`; before any read has arrived it says nothing of the frames.

### Pan and zoom

1. The viewer drags on the canvas, or scrolls, and it pans.
   With the canvas in focus (Tab reaches it first, a `region` named `Frames`), the arrow keys pan
   it, as in tldraw and Miro, so a person with only a keyboard can bring each frame into view (E3
   S14, WCAG 2.1.1). Decided in the E3 design on 2026-11-21; not built yet.
2. Ctrl+scroll or a pinch zooms around the pointer. Buttons `Zoom in`, `Zoom out` and `Fit` in the
   dock do the same. A `status` shows the zoom, rounded down to steps of 10% (26% reads 20%).
3. While the canvas moves, the set of live documents stays as it is. When it rests, the frames now
   in view go live, nearest first, one at a time. The one change allowed mid-move: a frame an
   agent deletes goes at once.

### Find a frame

Decided on 2026-11-23: option A of E3 S15, Find in the dock, as Miro and Excalidraw do. The
chart is [viewer-find](docs/statecharts/viewer-find.md).

1. The button `Find` (a magnifier) in the dock, or the key `/` out of a text field, opens the find
   list over the dock: 320 px wide, at its centre. `Find` shows pressed while the list is open.
2. The list has a combobox `Find a frame` with the focus, a hint, and a listbox `Frames` of frame
   names (the WAI-ARIA combobox pattern). With no text, it shows all names in the order of the
   board, and the hint says "<n> frames". With text, it shows the names that have the text, with
   no regard to case. The names that start with the text come first. The hint says "<n> of <total>
   frames", or "No frame name has this text.".
3. The first name is selected. Arrow Down and Arrow Up move the selection. Enter, or a click on a
   name, takes it.
4. A take closes the list, and the canvas shows the frame at its centre: with a 40 px edge, never
   past 100%. The frame gets a 2 px accent ring, and its name shows in accent. A pan or a zoom ends
   the mark.
5. Escape, a press on `Find`, or a move of the focus out of the list closes the list. The canvas
   stays where it is.

### Watch an agent work

1. An agent writes a frame's document. Every open tab shows the new version: a new picture, and
   the live document reloads with no white flash.
2. An agent adds a frame. It shows in every tab.
3. An agent moves or removes a frame. Every tab shows it moved, or gone along with its pins. The
   requests of a removed frame stay in the card, marked "may be outdated" ([queue](SPEC-queue.md)).
   A move is unreached until `frame.move` ships: the stage reads a shell's box once, so a moved
   frame would keep its old box for `Fit` and for what shows and goes live. The `frame.move` work
   fixes that, with a test that moves a frame far away and back.
4. A user changes the look or a piece of the kit ([kit](SPEC-kit.md)). Every open tab shows it.
   Each live document shows it within 1 s, with no reload: the page sends
   `{ easel: "kit", kit, look, css }` on the port of that document, and its piece script replaces
   the two style texts. A document can start before the page listens, so its piece script says
   hello to its parent at once and again each 50 ms until it gets a port (as penpal does). The page
   answers the hello with a port and the current kit at once, so a document composed in an older
   kit version also shows the new one. A
   live document that uses a changed template reloads, and its picture stays on top until it
   paints. Each frame shell gets the address of the picture in the new kit version; its last
   picture stays until the new one has decoded, so no shell is white. Each frame in view shows the
   change within 10 s on a canvas with 20 frames in view.

### Lose the socket

1. While the socket is down, a `status` says `Reconnecting`. What the page shows may be behind.
2. When the socket is back, the page reads the whole board again and shows what changed while it
   was down. Only then does `Reconnecting` go.

### Ask for a change

1. A viewer presses the button `Request` (it shows pressed), and the canvas goes into request mode.
   The pointer over the canvas is then the speech bubble of `Request`, with its tip at the tail
   (as in the comment mode of Figma and Miro). While the pointer moves over a live frame, the part
   under it gets a 1 px accent outline, as the comment modes of Figma and Vercel do (request #10).
   The page asks the paint script in the frame for that box, at most once in each animation frame,
   and shows only the answer to its last ask. The outline goes over the page's body, out of the
   frames, when a draft opens, and in view mode. The chart is
   [viewer-hover](docs/statecharts/viewer-hover.md).
2. They click a part of a frame. The part gets an outline and a draft pin. The page cannot read
   the frame's document in its sandbox, so it asks the paint script in the frame for the box of
   the element at the place clicked, and draws the outline from the answer, cut to the frame (as
   the comment overlays of Figma and Vercel do). A frame that is not live, or a click on its page's
   body, gets no outline: the draft pin shows the place. Or they click the
   canvas out of all frames, for a request about the whole canvas (E4.1 N2). A popover opens next
   to the pin, with a textbox `Request` and the button `Send`. Under the textbox, the place shows:
   "On <frame>" or "On the whole canvas". The page makes a client key for this request, and keeps
   the frame version that it shows.
3. They type and press `Send`, or Enter. It sends `request.add` with the key and the version.
   While it sends, the text stays in the textbox, muted. When easel saves it, a pin (button
   `Request #<n>`) shows at that place, in every tab on the canvas within 1 s. The textbox goes,
   the card opens on the new request, waiting, and the button `Request` turns off. The request shows in the list
   (E4.1 N5).
4. Escape, or a press on `Request`, closes the textbox and sends nothing.
5. If the call is refused, nothing is saved. The textbox stays with the text, gets a danger edge,
   and says why. Each text starts with "Not sent:" and says "Your text is kept":
   - `gone`: "an agent removed the <frame> frame. Click the canvas to put the pin again." The
     removed frame shows as a dashed area where it was. An agent's change to the frame leaves the
     textbox as it is.
   - `full`: "this canvas has too many open requests. Send again when some are done."
   - `slow`: "you sent many requests in a short time. Send again in a minute."
   - socket down: "no link to easel. Send again when Reconnecting goes." `Send` waits.
6. If the call faults (the socket drops, or the server fails), the textbox stays with the text and
   says it is not known yet whether it saved. Escape does nothing then. When the socket is back
   (or, after a server fault, when the viewer presses `Send`), the page sends the request again
   with the same key. The server saves a key once, so the request is never saved twice, and its
   answer says whether it saved.

### When the link ends

1. A user unshares the canvas. Each open tab on the link is told at once: the server pushes the
   refusal `{ ended: true }`. A tab whose socket was down is told by its read when it is back.
2. The tab shows the ended page. If a request or an answer was being typed, the page keeps its
   text to copy, and says it was not sent, or that it is not known whether it saved.

### When a password is set

1. A user sets or changes the link's password. That ends every pass on the link
   ([frames](SPEC-frames.md)), and each open tab on it is told at once: the server pushes the
   refusal `{ locked: true }`. A tab whose socket was down is told by its read when it is back.
2. The tab goes back to the password page. It says "The password of this link changed" and
   "Enter the new password to see the canvas again. Ask the person who shared it." (E3 S4); a
   first open says "This link needs a password". If a request or an answer was being typed, its
   text stays visible there to copy, as on the ended page, and the page says it was not sent, or
   that it is not known whether it saved.

### Follow the requests

1. The button `Requests` in the dock always shows the count of requests that wait for a viewer: a
   question, a result to check, or "needs a person" (E4.4 F2). Its name says the count, for
   example `Requests, 2 wait for you`. When the count is 0, the button has no count. The button
   shows no other number.
2. The button opens and closes the card (a `complementary` region named `Requests`). The card
   shows the list, or one request (step 10). The head of the list
   shows `Requests`, the same count, and a menu button that names the list on show: `Open` or
   `Done`. The menu gives the two lists, each with its count of rows.
3. The list `Open` has two groups, each with a heading, newest first:
   - `Waits for you`: questions, results to check, and requests that need a person.
   - `Other requests`: waiting, and in work.

   A request that leaves `Waits for you` goes to `Other requests`, in its place by age. A canvas
   with no requests says "No requests yet", and tells how to ask for one.

4. The list `Done` is one group, newest first: accepted, done with no answer, closed by a person,
   and taken back (E4.4 F5). A result that no viewer answers for 3 days shows there as "Done, no
   answer", and the count stops counting it (E4.2 M15).
5. Each row shows the avatar and the name of the author, the age, a hairline, the state mark, and
   `#<n>`. Under them: the start of the text (2 lines at most), and the place. A row has no fill for
   its state. The row of the open request has a hover fill and a 2 px ink bar on its left.
6. Each state has its own mark, named by its word (the accessible name and the tooltip), so a
   viewer can tell the states apart without reading (E4.4 F1):

   | State           | Mark                                         | Word                   |
   | --------------- | -------------------------------------------- | ---------------------- |
   | waiting         | a hollow circle                              | `Waiting for an agent` |
   | in work         | a half circle, then the agent's name in text | the name of the agent  |
   | question        | an accent bubble with "?"                    | `Question for you`     |
   | result          | an accent circle with a tick                 | `Result to check`      |
   | needs a person  | a danger square with "!"                     | `Needs a person`       |
   | accepted        | a grey dot                                   | `Done`                 |
   | done, no answer | a grey dot                                   | `Done, no answer`      |
   | closed          | a slashed circle                             | `Closed`               |
   | taken back      | a slashed circle                             | `Taken back`           |

   A closed request is "taken back" when the viewer who closed it has the author's name. A
   request that may be outdated ([queue](SPEC-queue.md)) keeps its state mark and adds a dotted
   circle, named `May be outdated` and its cause: `May be outdated: the frame changed`, `May be
outdated: the frame was removed`, or `May be outdated: a long wait`. Only a waiting request
   has it. When more than one cause is true, the first in that order names it. The page derives
   it from the board and its estimate of the server's time, with no write.

7. Pins show on the canvas for the requests of the list `Open`. A pin is a bubble with the
   author's initial. It has the accent look while the request waits for a viewer, the danger look
   while it needs a person, and a quiet look else. A done or closed request has no pin, except
   while it is open in the card. The pins of a removed frame go with it.
8. Each change of a request shows in every tab within 1 s, with no reload (E4.4 F4). A lease that
   runs out shows with no write to the board: the board stores no "in work" and no "needs a
   person". The page derives each state as the queue spec says, from the board and its estimate
   of the server's time. The board carries the server's clock offset, and a clock capsule keeps
   the estimate.
9. A click on a row opens the request in the card, and moves the canvas to the place of the
   request. A click on a pin opens its request in the card, and the canvas stays (E4.4 F3). The place comes to 40% of the canvas's width and height, at the
   zoom as it is, so the card does not cover it. A request of a removed frame moves the canvas to where
   the frame was: a dashed area that says "<frame> was removed", with the pin of the request in
   it. The board's cell `removed` gives the name and the last box of the frame. The area goes
   when the request leaves the card.
10. An open request shows in the card in the place of the list (a `region` named
    `Request #<n>`). Its pin shows pressed, with an accent ring. Above its head, the button
    `All requests` (a left chevron, as Miro and Linear) goes back to the list. Escape also goes
    back to the list, and Escape on the list closes the card. The
    button `Close` (×) closes the card. A press on another pin or row opens that request in its
    place. None of these changes the request. The textbox of a new request (§ Ask for a change)
    stays a popover next to its pin. It opens below its pin; with no room below, it goes above
    the pin, then to its right, then to its left, as Floating UI's `flip`. It moves along that
    side to stay in the canvas, as Floating UI's `shift`. It keeps 8 px from the edges of the
    canvas, out of the band of the dock (64 px at the bottom), and out of the card. It never
    covers its pin. The thread scrolls in the card, and the controls of the request stay at its
    bottom. The chart is [viewer-card](docs/statecharts/viewer-card.md).
11. The head of an open request shows the state mark, `#<n>` and the place, then the button `More`
    and the button `Close` (×). `More` opens a menu: `Correct the request` (off while an agent works,
    with the hint "Agent works"), `Copy link`, and `Take back` (danger). `Take back` shows while
    the request is waiting, in work, a question, or needs a person. Then a viewer who is not the
    author sees `Close request` in its place. `Copy link` copies the link of the page with
    `#request-<n>` after it. When the canvas opens at such a link, the card opens on request
    `<n>`, and the canvas moves to the request as a click on its row does (step 9),
    after the first Fit. Until the viewer pans or zooms, the place stays at 40% when the canvas
    changes size.
12. The thread shows all the messages, oldest first, with a hairline above each message after
    the first. A message shows the avatar, the name of the sender, the time, and the text. An
    agent has a square avatar. A step is one line: the name, what was done, and the time, for
    example "claude-1 took it", "Mai corrected it", "Mai took it back", "Mai closed it", "Mai
    accepted the result", "Mai opened it again", "claude-1 stopped with no outcome: <reason>" (a
    release), "claude-1 gave it back: <reason>" (a decline), "Back in the queue, in its first
    place", "No viewer answered in 3 days, so it is done", "3 tries with no outcome: it needs a
    person". The board has no message for a claim: "claude-1 took it" shows while the request is
    in work, at the time of the claim (`claimedAt`). A waiting request whose last lease ran out
    shows "claude-1 took it", then "claude-1 ran out of time with no outcome" at `claimedUntil`.
    Only the last lease shows: the board keeps no earlier claim. A correction of a request that needs a person shows as a message,
    then "Mai sent it back". The first message shows the text of the request now: its ask, or
    its last correction.
13. An HTML part shows in a sandboxed iframe, as a live document does. A result shows one picture
    of the frame, with a switch `Before` | `After` on its top edge; it opens on `After` (E4.2
    M11). After a decision, and while the viewer writes a note, the picture is folded: only the
    switch shows, and a click on a side opens the picture on that side. A question with options
    shows one button for each option, under its HTML part, and a textbox `Answer`. After the
    answer, the options show as text, and the option that the answer picked has an accent
    outline. The picture is 16:10 and shows the top of the frame. `Before` is the version at the
    claim, and `After` the version at the result, each in the kit version that the result keeps
    for it (`beforeKit`, `afterKit`), so a later change of the look does not change them (K10). The
    When asked picture uses the kit version of the request. The picture of a view that is not
    current has its key in the board's cell `kept`; a version with no key shows the plain card. Only the
    last result opens on `After`, and only while it waits for a decision. The side that the
    viewer picks stays until the request changes; a side picked while a textbox is open stays
    only while the textbox is open.
14. A request that may be outdated shows what the viewer saw: a switch `When asked` | `Now` on
    the picture under its first message, open on `When asked` (E4.1 N8). `Now` shows the frame
    now, or "Frame removed". The last step says what changed: "The Sign-up frame changed 3 times
    since Tom asked", or "The Sign-up frame was removed", with its time. A request that is only
    old has no switch and no such step.
15. The controls of an open request follow its state. Any viewer of the link can use them, and
    each use is a message with the name of the viewer (E4.2 M16).

    | State           | Controls                                                                        | Call                       |
    | --------------- | ------------------------------------------------------------------------------- | -------------------------- |
    | waiting         | in `More`: `Correct the request` (Cancel, Save), `Take back`                    | `request.edit`, `close`    |
    | in work         | in `More`: `Take back`; the head names the agent                                | `request.close`            |
    | question        | an option button, or textbox `Answer` and `Send`; in `More`: `Take back`        | `request.answer`           |
    | result          | `Accept`; `Open again`, then a textbox for the note, `Send` and `Cancel`        | `request.accept`, `reopen` |
    | needs a person  | the reason; textbox "Make it clear, then send it back", `Send`; `Close request` | `request.edit`, `close`    |
    | accepted        | `Open again`, then a textbox for the note                                       | `request.reopen`           |
    | done, no answer | `Open again`, then a textbox for the note                                       | `request.reopen`           |
    | closed          | none                                                                            |                            |

    A request that may be outdated also has `Close request`. The button that closes the request
    is always `Close request`, as GitHub's "Close issue", so it never shares the name `Close` of
    the ×.

16. If another viewer acted first (`wrongState`), nothing is saved. The card shows the new
    state, keeps the typed text in its textbox, and says who acted: "Not sent: Tom accepted this
    first. Your text is kept." When the new state takes the same text in another call, the text
    says so, and `Send` makes that call: after an accept, "Send it to open the request again"
    (`reopen`). A correction that an agent started on first says "Not saved: claude-1 started work
    on it first. Your text is kept.", with `Copy text` and `Take back` (E4.2 M20, E4.1 N10).
    `full` and `slow` keep the text too and say why. The page checks first: a text typed for a
    state that the request left is not sent, and the card says who acted, as above. Its
    `Send` is off when no call of the new state takes the text. The copy for the other answers:
    "Not sent: this request is not on the canvas any more. Your text is kept." (`gone`), "Not sent: this canvas
    has too many open requests. Your text is kept. Send again when some are done." (`full`),
    "Not sent: you sent many changes in a short time. Your text is kept. Send again in a
    minute." (`slow`), "Not sent: no link to easel. Your text is kept. Send again when
    Reconnecting goes." (no socket), and "Not sent: easel had a problem. Your text is kept. Send
    again." (a fault). A browser that kept no name asks it at the first act, as at the first
    `Send` of a request (`Your name`); then the same button acts.
17. A request that changed since the last visit shows the mark `Changed since your last visit`: an
    accent squircle on the top right corner of the row's avatar (E4.4 F6). It goes when the viewer
    opens the request. The button `Requests` shows no count of changed requests. The browser keeps
    in `localStorage`, for each canvas, the time of the last visit, and for each request, its
    `updated` time when the viewer last opened it. A request shows the mark when its `updated` is
    after both. When the canvas opens, the page reads the time of the last visit, then writes the
    time now.

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
| Going live, app frame  | under 150 ms p95 with 12 live app frames (measured: 48.6 / 71.9 ms)   |
| Close wait             | an app frame's `closed`, or 200 ms; then the iframe goes              |
| Zoom                   | 0.1% to 400%; a button or a wheel notch is ×1.25                      |
| Pinch rate             | Ctrl+wheel, as a trackpad pinch: ×e^0.01 per px; ×1.25 at most        |
| Fit                    | a 40 px edge; never past 100%                                         |
| Zoom status            | rounded down: steps of 10%; under 10% of 1%; under 1% of 0.1%         |
| Label                  | kept at its screen size; rewritten after a 10% zoom drift and at rest |
| Done, no answer        | a result that no viewer answers for 3 days (from its `updated`)       |
| Request card           | 340 px wide; 12 px from the edges of the canvas                       |
| Find list              | 320 px wide; 8 names show, then it scrolls                            |

A shell's picture is its frame's address on the board: its version, the kit version and its key
`k`, at scale 0.5,
or 0.25 when 0.5 would be over 8 megapixels. Past that, and with pictures off (no `k`), the shell
is the plain card of "See the frames" step 4: a colour that is not white, under the frame's name on
its label. A picture that fails to load (a busy server answers 503) is asked again after 1 s, 2 s
and 4 s; after the third try the card shows.

## Contract

The page reads `easel.board` (cells `frames`, `docs`, `kept`, `removed`, `requests`, `messages` and `kit`, keyed by canvas,
and the server's clock offset). Its calls are:

- `share.open { link, password?, name? }` ([frames](SPEC-frames.md)), once at the gate. `name` is
  the name this browser kept, if it kept one.
- `share.name { canvas, name }` ([frames](SPEC-frames.md)), at the first `Send` of a browser that
  kept no name, or when `request.add` is refused `{ name: true }` because the pass has no name.
- `request.add { canvas, frameId, version, kit, x, y, text, key }` ([queue](SPEC-queue.md)). `key`
  is the client key: one per request, the same on each retry of it. `kit` is the kit version that
  the page shows.
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
7. The page's only calls are `share.open`, `share.name` and `request.add`, `edit`, `answer`,
   `accept`, `reopen` and `close`.
8. One page module adds the paint script, to the end of the document that `compose` gives
   ([kit](SPEC-kit.md)). The look, the kit and the piece script come only from `compose`. No server
   module and no stored document carries the paint script. The script posts that the document painted, and answers a
   place with the box of the element there. It posts nothing else.
9. The card reads time only from the clock capsule, never from `Date.now()`.
10. One page function derives the state of a request (queue spec, table `State`), and "done, no
    answer" and "taken back" from it. The card, the pin and the count all use it.

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
   carries it. While it is not known whether a send saved, Escape does not close the textbox.
7. The ended page, and the password page after `{ locked: true }`, keep the text of a request or
   an answer being typed, and never say "not sent" of one that may have saved.
8. The server refuses an `/rpc` upgrade whose `Origin` is present and is not `PUBLIC_ORIGIN`, so a
   frame's script (`Origin: "null"`) cannot open a socket of its own ([access](SPEC-access.md)
   judged rule 15).
9. An HTML part of a message runs in the same sandbox as a live document (judged rule 4), never in
   the page.
10. A refused viewer call (`wrongState`, `gone`, `full`, `slow`) never clears the typed text: of
    a request, a correction, an answer or a note (E4.1 N10).
11. The changed mark reads and writes only `localStorage`. It sends nothing to the server.
12. The page answers a hello only when its `event.source` is the window of one of its own live
    iframes, and sends kit messages only on the port that it gave that iframe. A frame's piece
    script, and the runtime of an app frame, take a port only from their parent. The sandbox of
    judged rule 4 stays as it is, for HTML frames and app frames.
13. The page removes the iframe of an app frame only after its `closed`, or after 200 ms with no
    `closed`. Then it ends its own work on the frame's port: no kit message goes there after, and
    each subscription that crosses the port ends. The deadline is the one exception to judged
    rule 2: a frame that an agent deletes leaves the live set at once, and its iframe goes after
    `closed` or 200 ms.

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
- A page test answers each state of a request on the board and finds its row in the right list
  and group, with its own mark and word, the right count on `Requests`, its pin look, and the
  controls of the table.
- A page test refuses each viewer call with `wrongState` and finds the typed text kept, and the
  name of the viewer who acted first.
- A page test with a moved clock shows a lease that runs out as waiting, or as "needs a person",
  with no board write.
- A page test with a stored last visit shows the changed mark on each request updated after it,
  and the mark goes when the viewer opens the request.
- The smoke has one canvas flow: open a board, frames show, pan and zoom.

## Out of Scope (Deferred)

- Editing anything in the browser.
- Cursors and presence of other viewers.
- A minimap.
- Search in the list of requests. Add it when a canvas has more open requests than a viewer can
  read in one list.
