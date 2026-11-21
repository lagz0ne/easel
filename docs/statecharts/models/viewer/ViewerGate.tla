---- MODULE ViewerGate ----
\* The share-link gate of the easel viewer (SPEC-viewer.md "Open the link", "When the link ends";
\* the share calls are in SPEC-frames.md). The page asks no name at the link: share.open needs
\* only the link, and the first request asks for the name (viewer-pin-post). An unshare pushes
\* the refusal { ended: true } to every open tab; a password set or changed ends every pass and
\* pushes { locked: true }.
\* share.open with no password on a password link always answers `locked` (the password page),
\* even while the address is slowed for wrong tries. Past the flood limit (30 opens a minute per
\* address) share.open answers `slow`; the page stays on Opening and calls again, so the model
\* leaves that stutter out. A link keeps at most 1000 passes: an open past that ends the link's
\* oldest pass (ThePassIsTrimmed). Nothing is pushed; the tab learns it when its next read starts,
\* on a reconnect, is refused { ended: true }, and opens the link once more.
\* Within a minute, password tries 1-5 that are wrong answer `wrong`; any try after 5 wrong ones
\* answers `slow`, even the right password.
\* MaxWrong stands for the spec's 5 wrong tries in a minute, kept small for TLC.
EXTENDS Naturals

CONSTANTS PasswordLinks,  \* a link can have a password (FALSE until passwords are built)
          Unsharing,      \* a link can end: unshare or canvas rm (FALSE until either is built)
          CanvasControls  \* the controls the canvas page shows, by role and name, in this build

ASSUME PasswordLinks \in BOOLEAN /\ Unsharing \in BOOLEAN

MaxWrong == 2

VARIABLES page,      \* what the tab shows
          conn,      \* the tab's one socket, while it shows the canvas: "up" or "down"
          wrong,     \* wrong passwords from this address on this link in the last minute (server)
          link,      \* the share link on the server: "open", "password", "unknown", "ended"
          pass,      \* the tab's pass is live (share.open gave it, and no password since ended it)
          sawEnd,    \* this tab has been told that its link ended
          trimmed    \* the server ended this tab's pass as the link's oldest past 1000 (the tab
                     \* does not know until its next read starts)

vars == <<page, conn, wrong, link, pass, sawEnd, trimmed>>

Pages == {"opening", "password", "wait", "canvas", "ended"}
Dead  == {"unknown", "ended"}

\* The controls each page shows, by role and name.
Controls(p) ==
  CASE p = "opening"  -> {}
    [] p = "password" -> {"textbox Password", "button Open"}
    [] p = "wait"     -> {"textbox Password", "button Open"}
    [] p = "canvas"   -> CanvasControls
    [] p = "ended"    -> {}

\* Any control that would change a frame. The page must show none of them.
FrameControls == {"button Edit", "button Move", "button Delete", "button Put", "button Resize"}

Init ==
  /\ page = "opening"
  /\ conn = "up"
  /\ wrong = 0
  /\ link \in IF PasswordLinks THEN {"open", "password", "unknown"} ELSE {"open", "unknown"}
  /\ pass = FALSE
  /\ sawEnd = FALSE
  /\ trimmed = FALSE

\* share.open { link } with no password, at once: open (a pass), locked (the password page, also
\* while this address is slowed for wrong tries), or gone. A name the browser kept goes with it,
\* and changes nothing here.
YouOpenTheLink ==
  /\ page = "opening"
  /\ page' = CASE link \in Dead     -> "ended"
               [] link = "password" -> "password"
               [] OTHER             -> "canvas"
  /\ pass' = (page' = "canvas")
  /\ sawEnd' = (link \in Dead)
  /\ conn' = "up"
  /\ trimmed' = FALSE
  /\ UNCHANGED <<wrong, link>>

\* share.open { link, password }: open, or slow after 5 wrong tries even with the right
\* one, or gone.
YouEnterTheRightPassword ==
  /\ page \in {"password", "wait"}
  /\ page' = CASE link = "ended"    -> "ended"
               [] wrong >= MaxWrong -> "wait"
               [] OTHER             -> "canvas"
  /\ pass' = (page' = "canvas")
  /\ sawEnd' = (link = "ended")
  /\ conn' = "up"
  /\ trimmed' = FALSE
  /\ UNCHANGED <<wrong, link>>

\* share.open answers wrong (an alert) for tries 1-5 in a minute, and slow for any try after 5
\* wrong ones.
YouEnterAWrongPassword ==
  /\ page \in {"password", "wait"}
  /\ IF link = "ended"
       THEN /\ page' = "ended" /\ sawEnd' = TRUE /\ UNCHANGED wrong
       ELSE IF wrong >= MaxWrong
              THEN /\ page' = "wait" /\ UNCHANGED <<wrong, sawEnd>>
              ELSE /\ wrong' = wrong + 1 /\ page' = "password" /\ UNCHANGED sawEnd
  /\ UNCHANGED <<conn, link, pass, trimmed>>

AMinutePasses ==
  /\ wrong > 0
  /\ wrong' = 0
  /\ page' = IF page = "wait" THEN "password" ELSE page
  /\ UNCHANGED <<conn, link, pass, sawEnd, trimmed>>

\* A user sets a password on the link, or changes it. That ends every pass; the server pushes
\* the refusal { locked: true } to each tab on the link whose socket is up, in the same step,
\* and the tab goes back to the password page.
APasswordIsSet ==
  /\ PasswordLinks
  /\ link \in {"open", "password"}
  /\ link' = "password"
  /\ pass' = FALSE
  /\ IF page = "canvas" /\ conn = "up"
       THEN page' = "password"
       ELSE UNCHANGED page
  /\ UNCHANGED <<conn, wrong, sawEnd, trimmed>>

\* A user runs `easel unshare` (or deletes the canvas). The server pushes the refusal
\* { ended: true } to each tab on the link whose socket is up, in the same step.
TheLinkEnds ==
  /\ Unsharing
  /\ link \in {"open", "password"}
  /\ link' = "ended"
  /\ IF page = "canvas" /\ conn = "up"
       THEN page' = "ended" /\ sawEnd' = TRUE
       ELSE UNCHANGED <<page, sawEnd>>
  /\ UNCHANGED <<conn, wrong, pass, trimmed>>

\* Others open the link past 1000 passes: the server ends this tab's pass, its oldest. No
\* refusal is pushed; the live read goes on until it starts again.
ThePassIsTrimmed ==
  /\ page = "canvas" /\ pass /\ ~trimmed
  /\ link \in {"open", "password"}
  /\ trimmed' = TRUE
  /\ UNCHANGED <<page, conn, wrong, link, pass, sawEnd>>

TheSocketDrops ==
  /\ page = "canvas" /\ conn = "up"
  /\ conn' = "down"
  /\ UNCHANGED <<page, wrong, link, pass, sawEnd, trimmed>>

\* Back up, the tab reads the whole board again; on an ended link that read is refused
\* { ended: true }, and with a pass a new password ended it is refused { locked: true }. A pass
\* trimmed on a live link is refused { ended: true } too: the tab opens the link once more, and
\* shows the ended page only if that answers gone.
TheSocketReconnects ==
  /\ page = "canvas" /\ conn = "down"
  /\ conn' = "up"
  /\ CASE link = "ended" -> page' = "ended" /\ sawEnd' = TRUE /\ UNCHANGED trimmed
       [] ~pass          -> page' = "password" /\ UNCHANGED <<sawEnd, trimmed>>
       [] trimmed        -> page' = "opening" /\ UNCHANGED <<sawEnd, trimmed>>
       [] OTHER          -> UNCHANGED <<page, sawEnd, trimmed>>
  /\ UNCHANGED <<wrong, link, pass>>

YouReload ==
  /\ page # "opening"
  /\ page' = "opening"
  /\ conn' = "up"
  /\ UNCHANGED <<wrong, link, pass, sawEnd, trimmed>>

Next == YouOpenTheLink \/ YouEnterTheRightPassword \/ YouEnterAWrongPassword \/ AMinutePasses
     \/ APasswordIsSet \/ TheLinkEnds \/ ThePassIsTrimmed \/ TheSocketDrops
     \/ TheSocketReconnects \/ YouReload

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ page \in Pages
  /\ conn \in {"up", "down"}
  /\ wrong \in 0..MaxWrong
  /\ link \in {"open", "password", "unknown", "ended"}
  /\ pass \in BOOLEAN
  /\ sawEnd \in BOOLEAN
  /\ trimmed \in BOOLEAN

\* A viewer never sees a control that changes a frame.
NoFrameControl == Controls(page) \cap FrameControls = {}

\* An ended or unknown link shows a page that says so, and no control.
EndedPageOnly == page = "ended" => Controls(page) = {}

\* While the page says to wait, even the right password does not open the canvas.
WaitMeansWait == page = "canvas" => wrong < MaxWrong

\* The gate never asks the name: the first request asks for it.
NameNotAtTheGate == "textbox Your name" \notin Controls(page)

\* A tab with a live socket is told at once when its link ends.
EndPushedAtOnce == page = "canvas" /\ link = "ended" => conn = "down"

\* Once a tab is told its link ended, it never shows the canvas or a gate again.
EndedStaysEnded == sawEnd => page \in {"ended", "opening"}

\* A tab with a live socket goes back to the password page as soon as a password set or changed
\* ends its pass: the canvas shows, connected, only under a live pass.
LockPushedAtOnce == page = "canvas" /\ conn = "up" => pass

\* The ended page shows only for a link that is gone: a trimmed pass on a live link opens it
\* again instead.
EndedOnlyWhenGone == page = "ended" => link \in Dead

\* Opening the link with no password never answers slow: it shows the password page.
OpenWithoutPasswordIsNeverSlow ==
  [][(page = "opening" /\ page' # "opening") => page' # "wait"]_vars

====
