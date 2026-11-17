---- MODULE ViewerGate ----
\* The share-link gate of the easel viewer (SPEC-viewer.md "Open the link", "When the link ends";
\* the share calls are in SPEC-frames.md). share.open takes the viewer's name, so the page asks
\* for it first, once per browser. An unshare pushes the refusal { ended: true } to every open
\* tab; a password set or changed ends every pass and pushes { locked: true }.
\* share.open with no password on a password link always answers `locked` (the password page).
\* Within a minute, password tries 1-5 that are wrong answer `wrong`; any try after 5 wrong ones
\* answers `slow`, even the right password.
\* MaxWrong stands for the spec's 5 wrong tries in a minute, kept small for TLC.
EXTENDS Naturals

MaxWrong == 2

VARIABLES page,      \* what the tab shows
          conn,      \* the tab's one socket, while it shows the canvas: "up" or "down"
          wrong,     \* wrong passwords from this address on this link in the last minute (server)
          nameKept,  \* this browser remembers the viewer's name
          link,      \* the share link on the server: "open", "password", "unknown", "ended"
          pass,      \* the tab's pass is live (share.open gave it, and no password since ended it)
          sawEnd     \* this tab has been told that its link ended

vars == <<page, conn, wrong, nameKept, link, pass, sawEnd>>

Pages == {"opening", "name", "password", "wait", "canvas", "ended"}
Dead  == {"unknown", "ended"}

\* The controls each page shows, by role and name.
Controls(p) ==
  CASE p = "opening"  -> {}
    [] p = "name"     -> {"textbox Your name", "button Continue"}
    [] p = "password" -> {"textbox Password", "button Open"}
    [] p = "wait"     -> {"textbox Password", "button Open"}
    [] p = "canvas"   -> {"button Zoom in", "button Zoom out", "button Fit", "button Comment",
                          "region Comments"}
    [] p = "ended"    -> {}

\* Any control that would change a frame. The page must show none of them.
FrameControls == {"button Edit", "button Move", "button Delete", "button Put", "button Resize"}

Init ==
  /\ page = "opening"
  /\ conn = "up"
  /\ wrong = 0
  /\ nameKept \in BOOLEAN
  /\ link \in {"open", "password", "unknown"}
  /\ pass = FALSE
  /\ sawEnd = FALSE

\* share.open { link, name } with no password: open (a pass), locked (the password page, also
\* while this address is slowed: slow only answers a password try), or gone.
OpenNoPassword ==
  /\ page' = CASE link \in Dead     -> "ended"
               [] link = "password" -> "password"
               [] OTHER             -> "canvas"
  /\ pass' = (page' = "canvas")
  /\ sawEnd' = (link \in Dead)
  /\ conn' = "up"

YouOpenTheLink ==
  /\ page = "opening"
  /\ IF nameKept
       THEN OpenNoPassword
       ELSE /\ page' = "name" /\ UNCHANGED <<conn, pass, sawEnd>>
  /\ UNCHANGED <<wrong, nameKept, link>>

\* Continue: the name is kept in this browser, and share.open runs with it.
YouGiveYourName ==
  /\ page = "name"
  /\ nameKept' = TRUE
  /\ OpenNoPassword
  /\ UNCHANGED <<wrong, link>>

\* share.open { link, password, name }: open, or slow after 5 wrong tries even with the right
\* one, or gone.
YouEnterTheRightPassword ==
  /\ page \in {"password", "wait"}
  /\ page' = CASE link = "ended"    -> "ended"
               [] wrong >= MaxWrong -> "wait"
               [] OTHER             -> "canvas"
  /\ pass' = (page' = "canvas")
  /\ sawEnd' = (link = "ended")
  /\ conn' = "up"
  /\ UNCHANGED <<wrong, nameKept, link>>

\* share.open answers wrong (an alert) for tries 1-5 in a minute, and slow for any try after 5
\* wrong ones.
YouEnterAWrongPassword ==
  /\ page \in {"password", "wait"}
  /\ IF link = "ended"
       THEN /\ page' = "ended" /\ sawEnd' = TRUE /\ UNCHANGED wrong
       ELSE IF wrong >= MaxWrong
              THEN /\ page' = "wait" /\ UNCHANGED <<wrong, sawEnd>>
              ELSE /\ wrong' = wrong + 1 /\ page' = "password" /\ UNCHANGED sawEnd
  /\ UNCHANGED <<conn, nameKept, link, pass>>

AMinutePasses ==
  /\ wrong > 0
  /\ wrong' = 0
  /\ page' = IF page = "wait" THEN "password" ELSE page
  /\ UNCHANGED <<conn, nameKept, link, pass, sawEnd>>

\* A user sets a password on the link, or changes it. That ends every pass; the server pushes
\* the refusal { locked: true } to each tab on the link whose socket is up, in the same step,
\* and the tab goes back to the password page.
APasswordIsSet ==
  /\ link \in {"open", "password"}
  /\ link' = "password"
  /\ pass' = FALSE
  /\ IF page = "canvas" /\ conn = "up"
       THEN page' = "password"
       ELSE UNCHANGED page
  /\ UNCHANGED <<conn, wrong, nameKept, sawEnd>>

\* A user runs `easel unshare` (or deletes the canvas). The server pushes the refusal
\* { ended: true } to each tab on the link whose socket is up, in the same step.
TheLinkEnds ==
  /\ link \in {"open", "password"}
  /\ link' = "ended"
  /\ IF page = "canvas" /\ conn = "up"
       THEN page' = "ended" /\ sawEnd' = TRUE
       ELSE UNCHANGED <<page, sawEnd>>
  /\ UNCHANGED <<conn, wrong, nameKept, pass>>

TheSocketDrops ==
  /\ page = "canvas" /\ conn = "up"
  /\ conn' = "down"
  /\ UNCHANGED <<page, wrong, nameKept, link, pass, sawEnd>>

\* Back up, the tab reads the whole board again; on an ended link that read is refused
\* { ended: true }, and with a pass a new password ended it is refused { locked: true }.
TheSocketReconnects ==
  /\ page = "canvas" /\ conn = "down"
  /\ conn' = "up"
  /\ CASE link = "ended" -> page' = "ended" /\ sawEnd' = TRUE
       [] ~pass          -> page' = "password" /\ UNCHANGED sawEnd
       [] OTHER          -> UNCHANGED <<page, sawEnd>>
  /\ UNCHANGED <<wrong, nameKept, link, pass>>

YouReload ==
  /\ page # "opening"
  /\ page' = "opening"
  /\ conn' = "up"
  /\ UNCHANGED <<wrong, nameKept, link, pass, sawEnd>>

Next == YouOpenTheLink \/ YouGiveYourName \/ YouEnterTheRightPassword \/ YouEnterAWrongPassword
     \/ AMinutePasses \/ APasswordIsSet \/ TheLinkEnds \/ TheSocketDrops \/ TheSocketReconnects
     \/ YouReload

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ page \in Pages
  /\ conn \in {"up", "down"}
  /\ wrong \in 0..MaxWrong
  /\ nameKept \in BOOLEAN
  /\ link \in {"open", "password", "unknown", "ended"}
  /\ pass \in BOOLEAN
  /\ sawEnd \in BOOLEAN

\* A viewer never sees a control that changes a frame.
NoFrameControl == Controls(page) \cap FrameControls = {}

\* An ended or unknown link shows a page that says so, and no control.
EndedPageOnly == page = "ended" => Controls(page) = {}

\* While the page says to wait, even the right password does not open the canvas.
WaitMeansWait == page = "canvas" => wrong < MaxWrong

\* The page asks for the name only in a browser that has not given it.
NameOnce == page = "name" => ~nameKept

\* share.open takes the name: no tab gets past the gate without one.
NameBeforeOpen == page \in {"password", "wait", "canvas"} => nameKept

\* A tab with a live socket is told at once when its link ends.
EndPushedAtOnce == page = "canvas" /\ link = "ended" => conn = "down"

\* Once a tab is told its link ended, it never shows the canvas or a gate again.
EndedStaysEnded == sawEnd => page \in {"ended", "opening"}

\* A tab with a live socket goes back to the password page as soon as a password set or changed
\* ends its pass: the canvas shows, connected, only under a live pass.
LockPushedAtOnce == page = "canvas" /\ conn = "up" => pass

\* Opening the link with no password never answers slow: it shows the password page.
OpenWithoutPasswordIsNeverSlow ==
  [][(page \in {"opening", "name"} /\ page' \notin {"opening", "name"}) => page' # "wait"]_vars

====
