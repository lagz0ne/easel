---- MODULE ViewerCanvas ----
\* One frame on an open canvas in the easel viewer: pan and zoom, the live set, the paint
\* signal, live changes from an agent, and the socket with its Reconnecting status
\* (SPEC-viewer.md "See the frames", "Pan and zoom", "Watch an agent work", "Lose the socket";
\* judged rules 2, 3 and 5). The tab is past the gate; the link stays live (see ViewerGate).

VARIABLES gesture,  \* "rest" or "moving" (a drag, a scroll, Ctrl+scroll, a pinch, a zoom button)
          inView,   \* the frame is in view at a zoom of 30% or more
          live,     \* the frame's live document (iframe) is in the live set
          painted,  \* the live document's paint script has posted that it painted (or 1.5 s passed)
          top,      \* what is on top in the frame's box: "picture" or "document"
          conn,     \* the one socket: "up", "down", or "reading" (back, the full board read in flight)
          status,   \* the page's status: "none" or "reconnecting"
          server,   \* the frame on the server: "v1", "v2", "gone"
          shown,    \* the frame as this tab shows it: "v1", "v2", "gone"
          jolt      \* what changed the live set while the canvas moved: "none", "delete", "other"

vars == <<gesture, inView, live, painted, top, conn, status, server, shown, jolt>>

Moving == gesture = "moving"

Init ==
  /\ gesture = "rest"
  /\ inView = TRUE
  /\ live = FALSE
  /\ painted = FALSE
  /\ top = "picture"
  /\ conn = "up"
  /\ status = "none"
  /\ server = "v1"
  /\ shown = "v1"
  /\ jolt = "none"

YouPanOrZoom ==
  /\ gesture = "rest"
  /\ gesture' = "moving"
  /\ jolt' = "none"
  /\ UNCHANGED <<inView, live, painted, top, conn, status, server, shown>>

\* The move ends somewhere: the frame is now in view at 30% or more, or it is not.
TheCanvasRests ==
  /\ Moving
  /\ gesture' = "rest"
  /\ inView' \in BOOLEAN
  /\ jolt' = "none"
  /\ UNCHANGED <<live, painted, top, conn, status, server, shown>>

\* At rest, frames in view go live, nearest first, one at a time. The picture stays on top.
TheFrameGoesLive ==
  /\ gesture = "rest"
  /\ inView /\ shown # "gone" /\ ~live
  /\ live' = TRUE
  /\ painted' = FALSE
  /\ top' = "picture"
  /\ jolt' = IF Moving THEN "other" ELSE "none"
  /\ UNCHANGED <<gesture, inView, conn, status, server, shown>>

\* At rest, a frame out of view stops being live; its last picture is on top at once.
TheFrameStopsBeingLive ==
  /\ gesture = "rest"
  /\ ~inView /\ live
  /\ live' = FALSE
  /\ painted' = FALSE
  /\ top' = "picture"
  /\ jolt' = IF Moving THEN "other" ELSE "none"
  /\ UNCHANGED <<gesture, inView, conn, status, server, shown>>

\* The paint script the viewer put into the document posts that it painted (or 1.5 s pass);
\* only then does the document come on top of its picture.
ItPaints ==
  /\ live /\ ~painted
  /\ painted' = TRUE
  /\ top' = "document"
  /\ jolt' = "none"
  /\ UNCHANGED <<gesture, inView, live, conn, status, server, shown>>

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
  /\ UNCHANGED <<gesture, inView, live, conn, status>>

\* The frame as the tab learns it: the agent's delete takes the frame out of the live set at
\* once, also mid-move (the one change to the live set that does not wait for rest).
Learn(v) ==
  /\ shown' = v
  /\ IF v = "gone"
       THEN /\ live' = FALSE /\ painted' = FALSE /\ top' = "picture"
            /\ jolt' = IF live /\ Moving THEN "delete" ELSE "none"
       ELSE /\ live' = live
            /\ painted' = IF v # shown THEN FALSE ELSE painted
            /\ top' = IF v # shown THEN "picture" ELSE top
            /\ jolt' = "none"

\* An agent deletes the frame. Every tab shows it gone, with its pins.
AgentDeletesTheFrame ==
  /\ server \in {"v1", "v2"}
  /\ server' = "gone"
  /\ IF conn = "up"
       THEN Learn("gone")
       ELSE UNCHANGED <<shown, live, painted, top>> /\ jolt' = "none"
  /\ UNCHANGED <<gesture, inView, conn, status>>

\* The page shows the status Reconnecting at once.
TheSocketDrops ==
  /\ conn = "up"
  /\ conn' = "down"
  /\ status' = "reconnecting"
  /\ jolt' = "none"
  /\ UNCHANGED <<gesture, inView, live, painted, top, server, shown>>

\* The socket is back. The tab subscribes, then reads the whole board; Reconnecting stays.
TheSocketIsBack ==
  /\ conn = "down"
  /\ conn' = "reading"
  /\ jolt' = "none"
  /\ UNCHANGED <<gesture, inView, live, painted, top, status, server, shown>>

\* The full board read arrives: the tab catches up, then the status clears.
TheBoardReadArrives ==
  /\ conn = "reading"
  /\ conn' = "up"
  /\ status' = "none"
  /\ Learn(server)
  /\ UNCHANGED <<gesture, inView, server>>

Next == YouPanOrZoom \/ TheCanvasRests \/ TheFrameGoesLive \/ TheFrameStopsBeingLive
     \/ ItPaints \/ AgentWritesTheFrame \/ AgentDeletesTheFrame
     \/ TheSocketDrops \/ TheSocketIsBack \/ TheBoardReadArrives

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ gesture \in {"rest", "moving"}
  /\ inView \in BOOLEAN /\ live \in BOOLEAN /\ painted \in BOOLEAN
  /\ top \in {"picture", "document"}
  /\ conn \in {"up", "down", "reading"}
  /\ status \in {"none", "reconnecting"}
  /\ server \in {"v1", "v2", "gone"}
  /\ shown \in {"v1", "v2", "gone"}
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

====
