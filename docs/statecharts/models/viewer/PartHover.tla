---- MODULE PartHover ----
\* SPEC-viewer.md § Ask for a change 1 (request #10, 2026-11-23): in the request mode, the part of
\* a live frame under the pointer gets an outline, before a click, as the comment modes of Figma
\* and Vercel do. The page asks the paint script in the frame for the box of the element under
\* the pointer, at most once in each animation frame. Only the answer to the last ask shows. The
\* outline goes when the pointer leaves the frames, when a draft opens, and out of the request mode.
\*
\* Two parts are enough to show an old answer that comes after a new ask.
EXTENDS Naturals

Parts == {"p1", "p2"}
Off == "off"

VARIABLES
  mode,    \* "view" or "request"
  draft,   \* "none" or "typing"
  under,   \* the part under the pointer, or Off out of all live frames
  asked,   \* the part of the last ask, or Off
  late,    \* the parts whose answers are still on the way
  shown,   \* the part whose outline shows, or Off
  budget   \* the moves of the pointer that are left

vars == <<mode, draft, under, asked, late, shown, budget>>

TypeOK ==
  /\ mode \in {"view", "request"}
  /\ draft \in {"none", "typing"}
  /\ under \in Parts \cup {Off}
  /\ asked \in Parts \cup {Off}
  /\ late \subseteq Parts
  /\ shown \in Parts \cup {Off}
  /\ budget \in 0..3

Init ==
  /\ mode = "view" /\ draft = "none" /\ under = Off /\ asked = Off
  /\ late = {} /\ shown = Off /\ budget = 3

Hovering == mode = "request" /\ draft = "none"

\* The pointer moves onto a part. In the request mode with no draft, the page asks for its box.
Move(p) ==
  /\ budget > 0 /\ p # under
  /\ under' = p /\ budget' = budget - 1
  /\ IF Hovering
       THEN asked' = p /\ late' = late \cup {p}
       ELSE UNCHANGED <<asked, late>>
  /\ UNCHANGED <<mode, draft, shown>>

\* The pointer leaves the frames: the outline goes.
Leave ==
  /\ under # Off
  /\ under' = Off /\ asked' = Off /\ shown' = Off
  /\ UNCHANGED <<mode, draft, late, budget>>

\* The paint script answers an ask. Only the answer to the last ask shows.
Answer(p) ==
  /\ p \in late
  /\ late' = late \ {p}
  /\ shown' = IF p = asked /\ Hovering THEN p ELSE shown
  /\ UNCHANGED <<mode, draft, under, asked, budget>>

\* The button Request: the request mode turns on or off. Off, the outline goes.
Mode ==
  /\ draft = "none"
  /\ mode' = IF mode = "view" THEN "request" ELSE "view"
  /\ asked' = Off /\ shown' = Off
  /\ UNCHANGED <<draft, under, late, budget>>

\* A click on a part opens a draft: the hover outline goes, and the draft has its own outline.
Click ==
  /\ Hovering /\ under # Off
  /\ draft' = "typing" /\ asked' = Off /\ shown' = Off
  /\ UNCHANGED <<mode, under, late, budget>>

\* Send or Escape ends the draft, and the request mode with it.
EndDraft ==
  /\ draft = "typing"
  /\ draft' = "none" /\ mode' = "view"
  /\ UNCHANGED <<under, asked, late, shown, budget>>

Next ==
  \/ \E p \in Parts : Move(p)
  \/ Leave
  \/ \E p \in Parts : Answer(p)
  \/ Mode
  \/ Click
  \/ EndDraft

Spec == Init /\ [][Next]_vars

\* An outline shows only in the request mode, with no draft.
AnOutlineOnlyWhileHovering == shown # Off => Hovering

\* An outline shows only for the part of the last ask: a late answer never shows.
OnlyTheLastAskShows == [][(shown' # Off /\ shown' # shown) => shown' = asked]_vars
====
