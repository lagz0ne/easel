---- MODULE ViewerCard ----
\* SPEC-viewer.md § Follow the requests: the card of the Requests, docked at the right edge of the
\* view, over the canvas (docs/epics.md E4.4, decided on 2026-11-23). The card shows the list of
\* the requests, or one request (its thread). It does not move when the canvas pans, and the
\* canvas does not move when the card opens or changes. A press on a pin opens its request in the
\* card. A press on a row opens its request and moves the canvas to its place. Back goes to the
\* list, Close closes the card, and Escape closes the top: the thread to the list, the list away.
\*
\* A new request is typed in a draft by its pin, not in the card. Send saves it and opens it in the
\* card. The request mode and the draft move on their own; the card stays as it is.
\*
\* Two saved requests and one new one are enough to show each order. `budget` bounds the steps
\* that move the canvas, so the model is finite.
EXTENDS Naturals

Reqs == {1, 2, 3}
None == 0
Elsewhere == 0

VARIABLES
  card,    \* "closed", "list" or "thread"
  open,    \* the request in the card's thread (None: no thread)
  view,    \* the place that the canvas shows: a request's place, or Elsewhere after a pan
  saved,   \* the requests that are saved, each with its pin
  mode,    \* "view", or "request" while the button Request is pressed
  draft,   \* "none", or "typing": a new request typed by its pin
  budget   \* the moves of the canvas that are left

vars == <<card, open, view, saved, mode, draft, budget>>

TypeOK ==
  /\ card \in {"closed", "list", "thread"}
  /\ open \in Reqs \cup {None}
  /\ view \in Reqs \cup {Elsewhere}
  /\ saved \subseteq Reqs
  /\ mode \in {"view", "request"}
  /\ draft \in {"none", "typing"}
  /\ budget \in 0..2

Init ==
  /\ card = "closed" /\ open = None /\ view = Elsewhere
  /\ saved = {1, 2}
  /\ mode = "view" /\ draft = "none"
  /\ budget = 2

\* The button Requests: it opens the card on the list, or closes the card.
Toggle ==
  /\ IF card = "closed"
       THEN card' = "list" /\ open' = None
       ELSE card' = "closed" /\ open' = None
  /\ UNCHANGED <<view, saved, mode, draft, budget>>

\* A press on a pin opens its request in the card. The canvas stays where it is.
PressPin(r) ==
  /\ r \in saved /\ mode = "view"
  /\ card' = "thread" /\ open' = r
  /\ UNCHANGED <<view, saved, mode, draft, budget>>

\* A press on a row of the list opens its request, and the canvas moves to its place.
PressRow(r) ==
  /\ card = "list" /\ r \in saved /\ budget > 0
  /\ card' = "thread" /\ open' = r /\ view' = r
  /\ budget' = budget - 1
  /\ UNCHANGED <<saved, mode, draft>>

\* Back in the thread's head: the list again.
Back ==
  /\ card = "thread"
  /\ card' = "list" /\ open' = None
  /\ UNCHANGED <<view, saved, mode, draft, budget>>

\* Close in the head: the card goes.
Close ==
  /\ card # "closed"
  /\ card' = "closed" /\ open' = None
  /\ UNCHANGED <<view, saved, mode, draft, budget>>

\* Escape closes the top: a draft first, then the thread to the list, then the list.
Escape ==
  /\ draft = "none" /\ card # "closed"
  /\ card' = IF card = "thread" THEN "list" ELSE "closed"
  /\ open' = None
  /\ UNCHANGED <<view, saved, mode, draft, budget>>

\* The viewer pans or zooms: the canvas moves, and the card stays as it is.
Pan ==
  /\ budget > 0 /\ view # Elsewhere
  /\ view' = Elsewhere /\ budget' = budget - 1
  /\ UNCHANGED <<card, open, saved, mode, draft>>

\* The button Request: the request mode turns on or off. A draft goes with it.
Mode ==
  /\ mode' = IF mode = "view" THEN "request" ELSE "view"
  /\ draft' = "none"
  /\ UNCHANGED <<card, open, view, saved, budget>>

\* In the request mode, a click on a place opens a draft by its pin.
Place ==
  /\ mode = "request" /\ draft = "none" /\ 3 \notin saved
  /\ draft' = "typing"
  /\ UNCHANGED <<card, open, view, saved, mode, budget>>

\* Escape in a draft: the draft goes, and nothing is sent.
Cancel ==
  /\ draft = "typing"
  /\ draft' = "none"
  /\ UNCHANGED <<card, open, view, saved, mode, budget>>

\* Send saves the new request: its pin shows, the request mode ends, and the card opens on it.
Send ==
  /\ draft = "typing"
  /\ saved' = saved \cup {3}
  /\ draft' = "none" /\ mode' = "view"
  /\ card' = "thread" /\ open' = 3
  /\ UNCHANGED <<view, budget>>

Next ==
  \/ Toggle
  \/ \E r \in Reqs : PressPin(r)
  \/ \E r \in Reqs : PressRow(r)
  \/ Back
  \/ Close
  \/ Escape
  \/ Pan
  \/ Mode
  \/ Place
  \/ Cancel
  \/ Send

Spec == Init /\ [][Next]_vars

\* The card shows a thread exactly when it has a request, and that request is saved.
AThreadHasItsRequest == (card = "thread") <=> (open # None /\ open \in saved)

\* A draft is typed only in the request mode.
ADraftIsInRequestMode == draft = "typing" => mode = "request"

\* A pan moves only the canvas: the card and its request stay.
APanLeavesTheCard == [][Pan => (card' = card /\ open' = open)]_vars

\* The canvas moves only for a pan or a press on a row: opening the card never moves it.
OnlyARowOrAPanMovesTheCanvas ==
  [][(view' # view) => (Pan \/ \E r \in Reqs : PressRow(r))]_vars
====
