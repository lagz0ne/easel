---- MODULE NewVersion ----
\* SPEC-viewer.md § The page 4 (request #12, 2026-11-23): a tab knows when easel has a new version
\* of the page, and the viewer can update it, as Linear and Slack do. The board's cell `client`
\* names the client of the server's build. The tab keeps the first name that it reads. After a
\* deploy the socket connects again, and a new name says that a new version is ready: a bar shows
\* with `Reload`. The tab never reloads by itself, and `Reload` shows only while no text is typed,
\* so a reload loses no text.
EXTENDS Naturals

VARIABLES
  server,  \* the build of the page that the server gives: 1, then 2 after a deploy
  mine,    \* the build of the page in this tab
  read,    \* the build that the tab last read from the board, or 0 before the first read
  typed,   \* TRUE while the viewer has text typed and not sent
  bar      \* "none", "reload", or "sendFirst"

vars == <<server, mine, read, typed, bar>>

TypeOK ==
  /\ server \in 1..2 /\ mine \in 1..2 /\ read \in 0..2
  /\ typed \in BOOLEAN
  /\ bar \in {"none", "reload", "sendFirst"}

Init == server = 1 /\ mine = 1 /\ read = 0 /\ typed = FALSE /\ bar = "none"

\* A deploy: the server gives a new build of the page.
Deploy ==
  /\ server = 1
  /\ server' = 2
  /\ UNCHANGED <<mine, read, typed, bar>>

\* The tab reads the board: at the first read, and again each time the socket connects.
Read ==
  /\ read' = server
  /\ bar' = IF read' # mine THEN (IF typed THEN "sendFirst" ELSE "reload") ELSE "none"
  /\ UNCHANGED <<server, mine, typed>>

\* The viewer types a text, or sends it or clears it.
Type ==
  /\ typed' = ~typed
  /\ bar' = IF read # 0 /\ read # mine THEN (IF typed' THEN "sendFirst" ELSE "reload") ELSE "none"
  /\ UNCHANGED <<server, mine, read>>

\* Reload: the tab loads the page of the server's build, and reads again.
Reload ==
  /\ bar = "reload"
  /\ mine' = server /\ read' = 0 /\ bar' = "none"
  /\ UNCHANGED <<server, typed>>

Next == Deploy \/ Read \/ Type \/ Reload

Spec == Init /\ [][Next]_vars

\* The bar shows only when the board names a page that is not the one in the tab.
TheBarMeansNewer == bar # "none" => (read # 0 /\ read # mine)

\* A reload happens only with no typed text: no text is lost.
NoTextLost == [][(mine' # mine) => ~typed]_vars

\* The tab never reloads by itself: only the button Reload loads a new page.
OnlyTheViewerReloads == [][(mine' # mine) => bar = "reload"]_vars
====
