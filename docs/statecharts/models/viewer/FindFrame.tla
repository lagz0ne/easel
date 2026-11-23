---- MODULE FindFrame ----
\* SPEC-viewer.md § Find a frame (E3 S15, option A, decided on 2026-11-23). The button Find in the
\* dock, or the key /, opens a list of frame names over the dock. The viewer types a part of a
\* name; the list shows the names that have it. Enter or a click takes the selected name: the list
\* closes, the canvas shows that frame, and the frame is marked. Escape or Find closes the list
\* with no change. A pan or a zoom ends the mark.
\*
\* `match` says if the typed text has names in the list: "some" or "none". `budget` bounds the
\* moves of the canvas, so the model is finite.
EXTENDS Naturals

VARIABLES
  list,    \* "closed" or "open"
  match,   \* "some" or "none": the typed text matches some frame names, or none
  marked,  \* TRUE while the frame that was taken is marked
  view,    \* "found" when the canvas shows the frame that was taken, else "other"
  budget   \* the moves of the canvas that are left

vars == <<list, match, marked, view, budget>>

TypeOK ==
  /\ list \in {"closed", "open"}
  /\ match \in {"some", "none"}
  /\ marked \in BOOLEAN
  /\ view \in {"found", "other"}
  /\ budget \in 0..2

Init ==
  /\ list = "closed" /\ match = "some" /\ marked = FALSE /\ view = "other" /\ budget = 2

\* The button Find, or the key /: the list opens with no text, and shows all names.
Open ==
  /\ list = "closed"
  /\ list' = "open" /\ match' = "some"
  /\ UNCHANGED <<marked, view, budget>>

\* The viewer types or deletes: the list shows the names that have the text, or none.
Type(m) ==
  /\ list = "open"
  /\ match' = m
  /\ UNCHANGED <<list, marked, view, budget>>

\* Enter, or a click on a name: the canvas shows that frame, and the frame is marked.
Take ==
  /\ list = "open" /\ match = "some" /\ budget > 0
  /\ list' = "closed" /\ marked' = TRUE /\ view' = "found"
  /\ budget' = budget - 1
  /\ UNCHANGED match

\* Escape, or Find again: the list closes, and nothing else changes.
Close ==
  /\ list = "open"
  /\ list' = "closed"
  /\ UNCHANGED <<match, marked, view, budget>>

\* A pan or a zoom: the canvas moves, and the mark ends.
Pan ==
  /\ budget > 0
  /\ view' = "other" /\ marked' = FALSE
  /\ budget' = budget - 1
  /\ UNCHANGED <<list, match>>

Next == Open \/ Type("some") \/ Type("none") \/ Take \/ Close \/ Pan

Spec == Init /\ [][Next]_vars

\* A frame is marked only while the canvas shows it.
AMarkIsInView == marked => view = "found"

\* The list takes a name only when the text matches one.
ATakeNeedsAName == [][(marked' /\ ~marked) => match = "some"]_vars

\* The canvas moves only for a take or a pan: opening, typing and closing never move it.
OnlyATakeOrAPanMovesTheCanvas == [][(budget' # budget) => (Take \/ Pan)]_vars
====
