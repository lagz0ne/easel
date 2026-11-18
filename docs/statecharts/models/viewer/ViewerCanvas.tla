---- MODULE ViewerCanvas ----
\* One frame on an open canvas in the easel viewer: pan, zoom and Fit, the frame's shell (shown,
\* or hidden when far), the live set, the paint signal, live changes from an agent (add, write,
\* delete), the empty canvas, and the socket with its Reconnecting status (SPEC-viewer.md "See the
\* frames", "Pan and zoom", "Watch an agent work", "Lose the socket"; judged rules 2, 3 and 5).
\* The tab is past the gate; the link stays live (see ViewerGate).

VARIABLES gesture,  \* "rest" or "moving" (a drag, a scroll, Ctrl+scroll, a pinch, a zoom button, Fit)
          zone,     \* where the frame's box is from the view: "in" (in view at 30% or more),
                    \* "small" (in view under 30%), "far" (more than the far margin away). For a
                    \* frame not made yet, or deleted, where it would be: the camera moves anyway.
          hidden,   \* the frame's shell is out of the render tree (the `hidden` attribute)
          fitted,   \* the camera is where Fit put it: no pan, zoom or new frame since
          live,     \* the frame's live document (iframe) is in the live set
          painted,  \* the live document's paint script has posted that it painted (or 1.5 s passed)
          top,      \* what is on top in the frame's box: "picture" (the card, until pictures) or "document"
          conn,     \* the one socket: "up", "down", or "reading" (back, the full board read in flight)
          status,   \* the page's status: "none" or "reconnecting"
          server,   \* the frame on the server: "none" (not made yet), "v1", "v2", "gone"
          shown,    \* the frame as this tab shows it: "none", "v1", "v2", "gone"
          empty,    \* the page says the canvas has no frames yet
          jolt      \* what changed the live set while the canvas moved: "none", "delete", "other"

vars == <<gesture, zone, hidden, fitted, live, painted, top, conn, status, server, shown, empty, jolt>>

Moving == gesture = "moving"

Zones == {"in", "small", "far"}

InView == {"in", "small"}

\* The tab draws the frame: it knows the frame and the frame is not deleted.
Drawn(v) == v \in {"v1", "v2"}

Init ==
  /\ gesture = "rest"
  /\ server = "none"
  /\ shown = "none"
  /\ empty = TRUE
  /\ zone = "in"
  /\ hidden = FALSE
  /\ fitted = FALSE
  /\ live = FALSE
  /\ painted = FALSE
  /\ top = "picture"
  /\ conn = "up"
  /\ status = "none"
  /\ jolt = "none"

\* A drag, a scroll, a zoom: the camera moves, and the shell is culled in the same write.
YouPanOrZoom ==
  /\ gesture' = "moving"
  /\ zone' \in Zones
  /\ hidden' = (zone' = "far")
  /\ fitted' = FALSE
  /\ jolt' = IF Moving THEN jolt ELSE "none"
  /\ UNCHANGED <<live, painted, top, conn, status, server, shown, empty>>

\* Fit: the camera moves so that every frame is in view.
YouPressFit ==
  /\ Drawn(shown)
  /\ gesture' = "moving"
  /\ zone' \in InView
  /\ hidden' = FALSE
  /\ fitted' = TRUE
  /\ jolt' = IF Moving THEN jolt ELSE "none"
  /\ UNCHANGED <<live, painted, top, conn, status, server, shown, empty>>

\* The camera stops.
TheCanvasRests ==
  /\ Moving
  /\ gesture' = "rest"
  /\ jolt' = "none"
  /\ UNCHANGED <<zone, hidden, fitted, live, painted, top, conn, status, server, shown, empty>>

\* At rest, frames in view go live, nearest first, one at a time. The picture stays on top.
TheFrameGoesLive ==
  /\ gesture = "rest"
  /\ zone = "in" /\ Drawn(shown) /\ ~live
  /\ live' = TRUE
  /\ painted' = FALSE
  /\ top' = "picture"
  /\ jolt' = IF Moving THEN "other" ELSE "none"
  /\ UNCHANGED <<gesture, zone, hidden, fitted, conn, status, server, shown, empty>>

\* At rest, a frame out of view (or under 30%) stops being live; its last picture is on top at once.
TheFrameStopsBeingLive ==
  /\ gesture = "rest"
  /\ zone # "in" /\ live
  /\ live' = FALSE
  /\ painted' = FALSE
  /\ top' = "picture"
  /\ jolt' = IF Moving THEN "other" ELSE "none"
  /\ UNCHANGED <<gesture, zone, hidden, fitted, conn, status, server, shown, empty>>

\* The paint script the viewer put into the document posts that it painted (or 1.5 s pass);
\* only then does the document come on top of its picture.
ItPaints ==
  /\ live /\ ~painted
  /\ painted' = TRUE
  /\ top' = "document"
  /\ jolt' = "none"
  /\ UNCHANGED <<gesture, zone, hidden, fitted, live, conn, status, server, shown, empty>>

\* The frame as the tab learns it. An agent's delete takes the frame out of the live set at once,
\* also mid-move (the one change to the live set that does not wait for rest). A frame the tab
\* did not know lands somewhere from the view, and its shell is culled as it lands.
Learn(v) ==
  /\ shown' = v
  /\ empty' = ~Drawn(v)
  /\ IF v = "gone"
       THEN /\ live' = FALSE /\ painted' = FALSE /\ top' = "picture"
            /\ jolt' = IF live /\ Moving THEN "delete" ELSE "none"
       ELSE /\ live' = live
            /\ painted' = IF v # shown THEN FALSE ELSE painted
            /\ top' = IF v # shown THEN "picture" ELSE top
            /\ jolt' = "none"
  \* A new frame no longer leaves Fit's view as it was: it may land out of view.
  /\ fitted' = (fitted /\ ~(Drawn(v) /\ ~Drawn(shown)))
  /\ UNCHANGED <<zone, hidden>>

\* An agent adds the frame. Every tab shows its shell; it goes live only at rest.
AgentAddsTheFrame ==
  /\ server = "none"
  /\ server' = "v1"
  /\ IF conn = "up"
       THEN Learn("v1")
       ELSE UNCHANGED <<shown, empty, live, painted, top, fitted>> /\ jolt' = "none"
  /\ UNCHANGED <<gesture, zone, hidden, conn, status>>

\* An agent writes the frame's document. Over a live socket every tab shows the new
\* version at once: the new picture goes on top, and the live document reloads under it.
AgentWritesTheFrame ==
  /\ server = "v1"
  /\ server' = "v2"
  /\ IF conn = "up"
       THEN /\ shown' = "v2"
            /\ painted' = FALSE
            /\ top' = "picture"
       ELSE UNCHANGED <<shown, painted, top>>
  /\ jolt' = "none"
  /\ UNCHANGED <<gesture, zone, hidden, fitted, live, conn, status, empty>>

\* An agent deletes the frame. Every tab shows it gone, with its pins.
AgentDeletesTheFrame ==
  /\ server \in {"v1", "v2"}
  /\ server' = "gone"
  /\ IF conn = "up"
       THEN Learn("gone")
       ELSE UNCHANGED <<shown, empty, live, painted, top, fitted>> /\ jolt' = "none"
  /\ UNCHANGED <<gesture, zone, hidden, conn, status>>

\* The page shows the status Reconnecting at once.
TheSocketDrops ==
  /\ conn = "up"
  /\ conn' = "down"
  /\ status' = "reconnecting"
  /\ jolt' = "none"
  /\ UNCHANGED <<gesture, zone, hidden, fitted, live, painted, top, server, shown, empty>>

\* The socket is back. The tab subscribes, then reads the whole board; Reconnecting stays.
TheSocketIsBack ==
  /\ conn = "down"
  /\ conn' = "reading"
  /\ jolt' = "none"
  /\ UNCHANGED <<gesture, zone, hidden, fitted, live, painted, top, status, server, shown, empty>>

\* The full board read arrives: the tab catches up, then the status clears.
TheBoardReadArrives ==
  /\ conn = "reading"
  /\ conn' = "up"
  /\ status' = "none"
  /\ Learn(server)
  /\ UNCHANGED <<gesture, zone, hidden, server>>

Next == YouPanOrZoom \/ YouPressFit \/ TheCanvasRests \/ TheFrameGoesLive
     \/ TheFrameStopsBeingLive \/ ItPaints \/ AgentAddsTheFrame \/ AgentWritesTheFrame
     \/ AgentDeletesTheFrame \/ TheSocketDrops \/ TheSocketIsBack \/ TheBoardReadArrives

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ gesture \in {"rest", "moving"}
  /\ zone \in Zones
  /\ hidden \in BOOLEAN /\ fitted \in BOOLEAN
  /\ live \in BOOLEAN /\ painted \in BOOLEAN
  /\ top \in {"picture", "document"}
  /\ conn \in {"up", "down", "reading"}
  /\ status \in {"none", "reconnecting"}
  /\ server \in {"none", "v1", "v2", "gone"}
  /\ shown \in {"none", "v1", "v2", "gone"}
  /\ empty \in BOOLEAN
  /\ jolt \in {"none", "delete", "other"}

\* During a move the live set changes only when an agent deletes a frame. (judged rule 2)
LiveSetOnlyAtRest == jolt # "other"

\* The viewer never sees a blank white box: a document is on top only once it painted.
NoBlankBox == top = "document" => live /\ painted

\* A connected tab shows the frame as the agent last left it.
ShowsLatest == conn = "up" => shown = server

\* A tab that may be behind says so: the status Reconnecting shows until the full read is in.
BehindSaysReconnecting == conn # "up" => status = "reconnecting"

\* A deleted frame draws nothing: it is never live.
GoneIsNotLive == shown = "gone" => ~live

\* Only a frame the tab draws is live: one it has not heard of yet never is.
LiveIsDrawn == live => Drawn(shown)

\* A frame in view always shows its shell; only a far one leaves the render tree.
InViewShows == Drawn(shown) /\ zone \in InView => ~hidden

\* A far shell is out of the render tree.
FarIsHidden == Drawn(shown) /\ zone = "far" => hidden

\* Fit shows every frame: each one is in view, and its shell shows.
FitShowsEveryFrame == fitted => zone \in InView /\ ~hidden

\* The page says the canvas has no frames yet exactly when it draws none.
EmptySaysSo == empty <=> ~Drawn(shown)

====
