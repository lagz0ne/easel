---- MODULE ViewerPin ----
\* Pinning a comment in the easel viewer while the frame, the socket and the link change
\* (SPEC-viewer.md "Pin a comment", "When the link ends"; SPEC-queue.md comment.add).
\* comment.add carries a client key, made when the textbox opens and sent again with each retry
\* of that draft, so the server saves one draft once. An unshare pushes the refusal
\* { ended: true } to the tab; a password set or changed ends its pass and pushes { locked: true },
\* and the tab goes back to the password page. Either way a typed or unsure draft stays visible.
EXTENDS Naturals

\* Switches, so that one spec gives two readable charts:
\*   ViewerPinPost.cfg: the socket can drop, and the server can answer full, slow or failed
\*                      (Socket).
\*   ViewerPinLink.cfg: the link can end, its password can change, and the frame can change
\*                      (Changes); the socket stays up.
CONSTANTS Socket, Changes

VARIABLES page,      \* "canvas", "ended" (the ended page) or "password" (the password page)
          link,      \* the share link on the server: "live", "ended", or "locked" (a password
                     \* set or changed ended this tab's pass)
          conn,      \* the one socket: "up" or "down"
          pin,       \* "off", "placing" (Comment pressed), "typing" (textbox open, Post and Cancel),
                     \* "sending" (Post pressed), "unsure" (after a fault: textbox kept, no Cancel)
          note,      \* what the textbox says: "none", "unknown" (not known yet if it saved),
                     \* "refused" (full or slow: not saved, Post again)
          copies,    \* comments on the server with this draft's client key
          frame,     \* the frame on the server: "there" or "gone"
          updated,   \* an agent has rewritten the frame's document (bound: once)
          closedBy,  \* how the draft closed: "none", "post", "cancel", "gone"
          endText,   \* what the ended or password page shows of the draft: "none", "not posted",
                     \* "unknown"
          lost       \* a step threw away typed text that was not saved

vars == <<page, link, conn, pin, note, copies, frame, updated, closedBy, endText, lost>>

Drafting == {"typing", "sending", "unsure"}

Init ==
  /\ page = "canvas" /\ link = "live" /\ conn = "up"
  /\ pin = "off" /\ note = "none" /\ copies = 0
  /\ frame = "there" /\ updated = FALSE
  /\ closedBy = "none" /\ endText = "none" /\ lost = FALSE

\* The tab is refused { ended: true } (the ended page) or { locked: true } (the password page),
\* with the typed text kept to copy.
RefusedPage == IF link = "ended" THEN "ended" ELSE "password"
EndThePage ==
  /\ page' = RefusedPage /\ pin' = "off" /\ note' = "none"
  /\ endText' = CASE pin = "typing"                -> "not posted"
                  [] pin \in {"sending", "unsure"} -> "unknown"
                  [] OTHER                         -> "none"
  /\ lost' = (pin \in Drafting /\ endText' = "none")

\* One draft per run is enough to show each rule; a second draft repeats the first.
YouPressComment ==
  /\ page = "canvas" /\ pin = "off" /\ closedBy = "none"
  /\ pin' = "placing"
  /\ UNCHANGED <<page, link, conn, note, copies, frame, updated, closedBy, endText, lost>>

\* The textbox opens, and the tab makes the draft's client key.
YouClickOnTheFrame ==
  /\ page = "canvas" /\ pin = "placing" /\ frame = "there"
  /\ pin' = "typing"
  /\ UNCHANGED <<page, link, conn, note, copies, frame, updated, closedBy, endText, lost>>

\* Escape, or the button Cancel. There is no Cancel while it is not known if the draft saved.
YouCancel ==
  /\ page = "canvas" /\ pin \in {"placing", "typing"}
  /\ pin' = "off" /\ note' = "none"
  /\ closedBy' = IF pin = "typing" THEN "cancel" ELSE "none"
  /\ UNCHANGED <<page, link, conn, copies, frame, updated, endText, lost>>

\* You press Post: comment.add goes over the socket with the draft's key. Post waits for the socket.
YouPost ==
  /\ page = "canvas" /\ pin = "typing" /\ conn = "up"
  /\ pin' = "sending" /\ note' = "none"
  /\ UNCHANGED <<page, link, conn, copies, frame, updated, closedBy, endText, lost>>

\* The server runs comment.add: mayRead, the frame, then the key. A key it has seen answers
\* added with the same n and saves nothing. The answer comes back in the same step.
TheServerAnswers ==
  /\ page = "canvas" /\ pin \in {"sending", "unsure"} /\ conn = "up"
  /\ CASE link # "live" ->
            /\ EndThePage
            /\ UNCHANGED <<link, conn, copies, frame, updated, closedBy>>
       [] frame = "gone" ->
            /\ pin' = "off" /\ note' = "none" /\ closedBy' = "gone"
            /\ UNCHANGED <<page, link, conn, copies, frame, updated, endText, lost>>
       [] OTHER ->
            /\ copies' = 1
            /\ pin' = "off" /\ note' = "none" /\ closedBy' = "post"
            /\ UNCHANGED <<page, link, conn, frame, updated, endText, lost>>

\* A new key on a canvas with too many open comments (full), or from a pass that posts too fast
\* (slow): nothing saved, the textbox stays with the text, says why, and offers Post again.
\* It answers so to a first send and to a resend from "unsure" alike; a key the server has seen
\* answers added first, so this answer means this draft is not saved.
TheServerAnswersFull ==
  /\ Socket /\ page = "canvas" /\ pin \in {"sending", "unsure"} /\ conn = "up" /\ copies = 0
  /\ link = "live" /\ frame = "there"
  /\ pin' = "typing" /\ note' = "refused"
  /\ UNCHANGED <<page, link, conn, copies, frame, updated, closedBy, endText, lost>>

\* The server fails (failed) on a send or a resend. This call saved nothing, but an earlier send
\* of the draft may have, so the textbox stays unsure, with no Cancel; Post sends it again.
TheServerFails ==
  /\ Socket /\ page = "canvas" /\ pin \in {"sending", "unsure"} /\ conn = "up"
  /\ pin' = "unsure" /\ note' = "unknown"
  /\ UNCHANGED <<page, link, conn, copies, frame, updated, closedBy, endText, lost>>

\* The server saves the comment, and the socket drops before the answer arrives.
TheServerSavesThenTheSocketDrops ==
  /\ Socket /\ page = "canvas" /\ pin = "sending" /\ conn = "up" /\ link = "live" /\ frame = "there"
  /\ copies' = 1 /\ conn' = "down"
  /\ pin' = "unsure" /\ note' = "unknown"
  /\ UNCHANGED <<page, link, frame, updated, closedBy, endText, lost>>

\* The socket drops. A call in flight fails with a link fault: the textbox stays, unsure.
TheSocketDrops ==
  /\ Socket /\ page = "canvas" /\ conn = "up" /\ closedBy = "none"
  /\ conn' = "down"
  /\ IF pin = "sending"
       THEN pin' = "unsure" /\ note' = "unknown"
       ELSE UNCHANGED <<pin, note>>
  /\ UNCHANGED <<page, link, copies, frame, updated, closedBy, endText, lost>>

\* Back up, the tab reads the whole board. An unsure draft is sent again with its key at once
\* (TheServerAnswers); on an ended link the read is refused.
TheSocketReconnects ==
  /\ page = "canvas" /\ conn = "down"
  /\ conn' = "up"
  /\ IF link # "live"
       THEN EndThePage
       ELSE UNCHANGED <<page, pin, note, endText, lost>>
  /\ UNCHANGED <<link, copies, frame, updated, closedBy>>

\* An agent writes the frame's document. An open textbox stays as it is.
AgentUpdatesTheFrame ==
  /\ Changes /\ page = "canvas" /\ frame = "there" /\ ~updated
  /\ updated' = TRUE
  /\ UNCHANGED <<page, link, conn, pin, note, copies, frame, closedBy, endText, lost>>

\* An agent deletes the frame, with its comments. A draft on it stays open until Post.
AgentDeletesTheFrame ==
  /\ Changes /\ page = "canvas" /\ frame = "there"
  /\ frame' = "gone" /\ copies' = 0
  /\ IF pin = "placing" THEN pin' = "off" ELSE UNCHANGED pin
  /\ UNCHANGED <<page, link, conn, note, updated, closedBy, endText, lost>>

\* A user runs easel unshare. The server pushes the refusal to the tab (TheRefusalArrives).
TheLinkEnds ==
  /\ Changes /\ page = "canvas" /\ link = "live"
  /\ link' = "ended"
  /\ UNCHANGED <<page, conn, pin, note, copies, frame, updated, closedBy, endText, lost>>

\* A user sets or changes the link's password: every pass ends, and the server pushes the
\* refusal { locked: true } to the tab (TheRefusalArrives).
APasswordIsSet ==
  /\ Changes /\ page = "canvas" /\ link = "live"
  /\ link' = "locked"
  /\ UNCHANGED <<page, conn, pin, note, copies, frame, updated, closedBy, endText, lost>>

TheRefusalArrives ==
  /\ page = "canvas" /\ link # "live" /\ conn = "up"
  /\ EndThePage
  /\ UNCHANGED <<link, conn, copies, frame, updated, closedBy>>

\* The ended page is an end: nothing more happens on it that the viewer can see. So is the
\* password page here: what follows a right password is in ViewerGate.
Ended ==
  /\ page # "canvas"
  /\ UNCHANGED vars

\* The one draft of a run has closed: nothing more to show.
Closed ==
  /\ page = "canvas" /\ pin = "off" /\ closedBy # "none" /\ conn = "up" /\ link = "live"
  /\ UNCHANGED vars

Next == Closed \/ YouPressComment \/ YouClickOnTheFrame \/ YouCancel \/ YouPost
     \/ TheServerAnswers \/ TheServerAnswersFull \/ TheServerFails
     \/ TheServerSavesThenTheSocketDrops \/ TheSocketDrops \/ TheSocketReconnects
     \/ AgentUpdatesTheFrame \/ AgentDeletesTheFrame \/ TheLinkEnds \/ APasswordIsSet
     \/ TheRefusalArrives \/ Ended

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ page \in {"canvas", "ended", "password"} /\ link \in {"live", "ended", "locked"}
  /\ conn \in {"up", "down"}
  /\ pin \in {"off", "placing", "typing", "sending", "unsure"}
  /\ note \in {"none", "unknown", "refused"}
  /\ copies \in 0..2 /\ frame \in {"there", "gone"} /\ updated \in BOOLEAN
  /\ closedBy \in {"none", "post", "cancel", "gone"}
  /\ endText \in {"none", "not posted", "unknown"}
  /\ lost \in BOOLEAN

\* An open textbox survives a frame update; typed text is never thrown away unsaved.
NoTextLost == ~lost

\* One draft makes at most one comment, however often it is sent.
OnePostOneComment == copies <= 1

\* Escape, or the button Cancel, closes the textbox and posts nothing.
CancelPostsNothing == closedBy = "cancel" => copies = 0

\* If the frame was deleted meanwhile, nothing is posted, and a status says the frame is gone.
GonePostsNothing == closedBy = "gone" => copies = 0

\* The pin Comment #n shows only for a saved comment. (A deleted frame takes its pins away.)
PinShows == page = "canvas" /\ closedBy = "post" /\ frame = "there"
PinMeansSaved == PinShows => copies = 1

\* A textbox that offers Cancel has saved nothing; when the tab cannot know, it says so.
TextboxSaysWhetherSaved ==
  /\ pin = "typing" => copies = 0
  /\ copies = 1 /\ pin \in Drafting => note = "unknown"

\* An ended link shows only the ended page, and an ended pass only the password page: no
\* textbox, no pin.
EndedPageOnly == page # "canvas" => pin = "off"

\* The ended page and the password page keep the typed text to copy, and never say "not posted"
\* of a saved one.
EndedPageKeepsText == endText = "not posted" => copies = 0

====
