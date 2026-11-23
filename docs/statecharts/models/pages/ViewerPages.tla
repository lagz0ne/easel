---- MODULE ViewerPages ----
\* easel pages: the page that a tab of the viewer shows (SPEC-pages.md § The viewer, rules 7-10).
\* A canvas has two pages. Frame "s" stays on page 1. Frame "m" starts on page 2, and an agent
\* moves it from page to page (frame.move) at any time. One tab shows one page: the address names
\* it (?page=), and a link with no page opens the first page. The tab loads the frames of its page
\* only. A move reaches the tab as an event on the socket, a little later.
\*
\* A person in the tab picks a page in the list of pages, picks the request on "m" in the Requests
\* panel, picks a frame that Find found (on each page), or reloads. The request was made when "m"
\* was on page 2 (RequestPage).
\*
\* RequestPick is how the pick of a request finds its page:
\*   "byFrame"   the tab asks for the frame; the answer gives the page where the frame is now,
\*               and the frames of that page, in one read (as Find does).
\*   "byOldPage" the tab opens the page that the request names, the page of the frame when the
\*               request was made. The second config shows what breaks.
EXTENDS Naturals, FiniteSets

CONSTANT RequestPick

Pages == {"p1", "p2"}
Frames == {"s", "m"}
FirstPage == "p1"
RequestPage == "p2"
Other(p) == IF p = "p1" THEN "p2" ELSE "p1"

VARIABLES
  pageOf,   \* the page of each frame, on the server
  tabPage,  \* the page that the tab shows, or loads after a pick of a page
  address,  \* the page that the address of the tab names
  load,     \* "none" | "page" (the frames of tabPage) | "frame" (a frame, then its page)
  shown,    \* the frames that the tab draws
  picked,   \* the frame of the last pick of a request or of Find, or "none"
  marked,   \* the tab shows the picked frame, marked
  behind    \* a move is on the socket, and the tab did not get it yet

vars == <<pageOf, tabPage, address, load, shown, picked, marked, behind>>

On(p) == {f \in Frames : pageOf[f] = p}

TypeOK ==
  /\ pageOf \in [Frames -> Pages] /\ pageOf["s"] = "p1"
  /\ tabPage \in Pages /\ address \in Pages
  /\ load \in {"none", "page", "frame"}
  /\ shown \subseteq Frames
  /\ picked \in Frames \union {"none"}
  /\ marked \in BOOLEAN /\ behind \in BOOLEAN

\* A link with no page opens the first page.
Init ==
  /\ pageOf = [f \in Frames |-> IF f = "s" THEN "p1" ELSE "p2"]
  /\ tabPage = FirstPage /\ address = FirstPage
  /\ load = "page" /\ shown = {}
  /\ picked = "none" /\ marked = FALSE /\ behind = FALSE

\* ---- The server ----

\* An agent moves "m" to the other page (frame.move with a page).
AnAgentMovesTheFrame ==
  /\ pageOf' = [pageOf EXCEPT !["m"] = Other(@)]
  /\ behind' = TRUE
  /\ UNCHANGED <<tabPage, address, load, shown, picked, marked>>

\* The answer of a load: the frames of the page, as the server has them now. A load of a frame
\* answers with the page where the frame is now. The address follows the page.
TheLoadEnds ==
  /\ load # "none"
  /\ LET p == IF load = "frame" THEN pageOf[picked] ELSE tabPage
     IN /\ tabPage' = p /\ address' = p
        /\ shown' = On(p)
        /\ marked' = (picked \in On(p))
  /\ load' = "none" /\ behind' = FALSE
  /\ UNCHANGED <<pageOf, picked>>

\* The event of a move reaches the tab: the frame comes onto its page or leaves it. A picked
\* frame that leaves the page is not picked any more; the tab stays on its page.
TheTabGetsTheMove ==
  /\ behind /\ load = "none"
  /\ shown' = IF pageOf["m"] = tabPage THEN shown \union {"m"} ELSE shown \ {"m"}
  /\ IF picked = "m" /\ pageOf["m"] # tabPage
       THEN picked' = "none" /\ marked' = FALSE
       ELSE UNCHANGED <<picked, marked>>
  /\ behind' = FALSE
  /\ UNCHANGED <<pageOf, tabPage, address, load>>

\* ---- The person in the tab ----

\* A pick in the list of pages: the tab shows that page at Fit.
APickOfAPage(p) ==
  /\ tabPage' = p /\ address' = p
  /\ load' = "page" /\ shown' = {}
  /\ picked' = "none" /\ marked' = FALSE
  /\ UNCHANGED <<pageOf, behind>>

\* A pick of a frame that Find found, on any page: the tab asks for the frame, and keeps its
\* page until the answer.
APickOfAFoundFrame(f) ==
  /\ load' = "frame" /\ picked' = f /\ marked' = FALSE
  /\ UNCHANGED <<pageOf, tabPage, address, shown, behind>>

\* A pick of the request on "m" in the Requests panel.
APickOfTheRequest ==
  /\ picked' = "m" /\ marked' = FALSE
  /\ IF RequestPick = "byFrame"
       THEN /\ load' = "frame"
            /\ UNCHANGED <<pageOf, tabPage, address, shown, behind>>
       ELSE /\ tabPage' = RequestPage /\ address' = RequestPage
            /\ load' = "page" /\ shown' = {}
            /\ UNCHANGED <<pageOf, behind>>

\* A reload opens the page of the address. The pick and the mark are not in the address.
AReload ==
  /\ tabPage' = address
  /\ load' = "page" /\ shown' = {}
  /\ picked' = "none" /\ marked' = FALSE /\ behind' = FALSE
  /\ UNCHANGED <<pageOf, address>>

Next ==
  \/ AnAgentMovesTheFrame \/ TheLoadEnds \/ TheTabGetsTheMove
  \/ \E p \in Pages : APickOfAPage(p)
  \/ \E f \in Frames : APickOfAFoundFrame(f)
  \/ APickOfTheRequest
  \/ AReload

Spec == Init /\ [][Next]_vars /\ WF_vars(TheLoadEnds) /\ WF_vars(TheTabGetsTheMove)

\* ---- Rules, in the reader's words ----

\* "A tab shows the frames of one page, and each of them": when the tab has its answer and each
\* move, it draws exactly the frames of its page.
ATabShowsOnePageAndEachOfItsFrames ==
  (load = "none" /\ ~behind) => shown = On(tabPage)

\* "A pick of a request or of a found frame shows its page and the frame, also after a move."
APickShowsThePageOfTheFrame ==
  (picked # "none" /\ load = "none" /\ ~behind) =>
    /\ tabPage = pageOf[picked]
    /\ picked \in shown
    /\ marked

\* "A reload shows the same page": the page that the tab showed before it.
AReloadShowsTheSamePage == [][AReload => tabPage' = tabPage]_vars

\* The tab is never behind for ever: each load ends, and each move reaches it.
TheTabCatchesUp == (load # "none" \/ behind) ~> (load = "none" /\ ~behind)
====
