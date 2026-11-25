---- MODULE ViewerOverlays ----
\* SPEC-viewer.md § The page, item 5 (user report, 2026-11-24): what lies over the canvas in one
\* tab, on a phone (a narrow screen) and on a wide screen. The dock holds Request, Requests, Find,
\* Pages, States and Zoom. The card Requests shows the list or one request. Five menus open from a
\* button: Pages, States and Zoom (in the dock), the list menu (Open or Done, in the head of the
\* list) and More (in the head of a request). Find opens its list over the dock. The locale is a
\* group of States, not a button of its own (product#27, 2026-11-25).
\*
\* The rules: one menu at most is open. A press out of a menu, or Escape, closes it. No overlay
\* covers the dock. One press closes the top overlay, and so does Escape. On a phone, Find and the
\* card never show together.
\*
\* The request mode covers nothing, so it is not here: Escape ends it after each overlay, as the
\* chart viewer-card shows. Screens is the set of screens to check: the second config checks a
\* phone only.
\*
\* Design is how the page behaves:
\*   "fixed"  the menus of Base UI (one at a time; an outside press and Escape close them), a
\*            Close button in the head of the list, and a card that stops above the dock on a
\*            phone. States is a menu too, and holds the locale (product#27, 2026-11-25).
\*            Zoom is a menu too (product#1, 2026-11-24), in the place of Zoom out, Zoom in and Fit.
\*   "today"  the page before 2026-11-24: each menu opens and closes only by its own button or a
\*            pick, the list has no Close, and on a phone the card covers the dock. Locale is a
\*            select of the browser, and Zoom is three buttons, not menus, so they are not here. The second config shows what
\*            breaks.
EXTENDS Naturals, FiniteSets

CONSTANTS Design, Screens

Fixed == Design = "fixed"

Menus == IF Fixed THEN {"pages", "states", "zoom", "list", "more"} ELSE {"pages", "list", "more"}

VARIABLES
  screen,  \* "narrow" (a phone) or "wide"
  menu,    \* the open menus
  panel,   \* the card Requests: "closed", "list" or "card" (one request)
  find     \* TRUE while the list of Find is open

vars == <<screen, menu, panel, find>>

TypeOK ==
  /\ screen \in {"narrow", "wide"}
  /\ menu \subseteq Menus
  /\ panel \in {"closed", "list", "card"}
  /\ find \in BOOLEAN

Init ==
  /\ screen \in Screens
  /\ menu = {} /\ panel = "closed" /\ find = FALSE

\* Today, on a phone, the card covers the dock.
DockFree == Fixed \/ screen = "wide" \/ panel = "closed"

\* A press out of a menu closes each open menu, with the fixed design.
Others(m) == IF Fixed THEN {} ELSE menu \ {m}

Toggle(m) == IF m \in menu THEN menu' = Others(m) ELSE menu' = Others(m) \cup {m}

\* ---- The dock ----

PressRequests ==
  /\ DockFree
  /\ IF panel = "closed"
       THEN /\ panel' = "list"
            /\ menu' = IF Fixed THEN {} ELSE menu
       ELSE /\ panel' = "closed"
            /\ menu' = IF Fixed THEN {} ELSE menu \ {"list", "more"}
  /\ find' = FALSE
  /\ UNCHANGED screen

PressPages ==
  /\ DockFree
  /\ Toggle("pages")
  /\ find' = FALSE
  /\ UNCHANGED <<screen, panel>>

PressStates ==
  /\ Fixed /\ DockFree
  /\ Toggle("states")
  /\ find' = FALSE
  /\ UNCHANGED <<screen, panel>>

PressZoom ==
  /\ Fixed /\ DockFree
  /\ Toggle("zoom")
  /\ find' = FALSE
  /\ UNCHANGED <<screen, panel>>

\* With the fixed design, Find on a phone closes the card, so the two never show together.
PressFind ==
  /\ DockFree
  /\ find' = ~find
  /\ IF ~find /\ Fixed
       THEN /\ menu' = {}
            /\ panel' = IF screen = "narrow" THEN "closed" ELSE panel
       ELSE UNCHANGED <<menu, panel>>
  /\ UNCHANGED screen

\* ---- The card ----

PressList ==
  /\ panel = "list"
  /\ Toggle("list")
  /\ find' = FALSE
  /\ UNCHANGED <<screen, panel>>

PressMore ==
  /\ panel = "card"
  /\ Toggle("more")
  /\ find' = FALSE
  /\ UNCHANGED <<screen, panel>>

PressRow ==
  /\ panel = "list"
  /\ panel' = "card"
  /\ menu' = Others("list")
  /\ find' = FALSE
  /\ UNCHANGED screen

PressBack ==
  /\ panel = "card"
  /\ panel' = "list"
  /\ menu' = Others("more")
  /\ find' = FALSE
  /\ UNCHANGED screen

\* A request has Close in its head. Today the list has none.
PressClose ==
  /\ panel = "card" \/ (Fixed /\ panel = "list")
  /\ panel' = "closed"
  /\ menu' = IF Fixed THEN {} ELSE menu \ {"list", "more"}
  /\ find' = FALSE
  /\ UNCHANGED screen

\* ---- A menu ----

Pick(m) ==
  /\ m \in menu
  /\ menu' = menu \ {m}
  /\ UNCHANGED <<screen, panel, find>>

\* A press on the canvas, out of each overlay. Find closes when its box loses the focus.
PressOutside ==
  /\ (Fixed /\ menu # {}) \/ find
  /\ menu' = IF Fixed THEN {} ELSE menu
  /\ find' = FALSE
  /\ UNCHANGED <<screen, panel>>

\* Escape closes the top: a menu, Find, a request (back to the list), then the list.
Escape ==
  /\ menu # {} \/ find \/ panel # "closed"
  /\ IF Fixed /\ menu # {}
       THEN menu' = {} /\ UNCHANGED <<panel, find>>
     ELSE IF find
       THEN find' = FALSE /\ UNCHANGED <<menu, panel>>
     ELSE IF panel = "card"
       THEN panel' = "list" /\ menu' = menu \ {"more"} /\ UNCHANGED find
       ELSE panel' = "closed" /\ UNCHANGED <<menu, find>>
  /\ UNCHANGED screen

Press ==
  \/ PressRequests \/ PressPages \/ PressStates \/ PressZoom \/ PressFind
  \/ PressList \/ PressMore \/ PressRow \/ PressBack \/ PressClose
  \/ \E m \in Menus : Pick(m)
  \/ PressOutside

Next == Press \/ Escape

Spec == Init /\ [][Next]_vars

\* ---- The rules ----

TopOf(m, f, p) ==
  IF m # {} THEN "menu"
  ELSE IF f THEN "find"
  ELSE IF p # "closed" THEN p
  ELSE "none"

Rank(t) ==
  CASE t = "none" -> 0 [] t = "list" -> 1 [] t = "card" -> 2 [] t = "find" -> 3 [] t = "menu" -> 4

Top == TopOf(menu, find, panel)

Lower == Rank(TopOf(menu', find', panel')) < Rank(Top)

\* From each state, one press closes the top overlay: no dead end.
OnePressClosesTheTop == Top # "none" => ENABLED (Press /\ Lower)

\* Escape closes the top overlay.
EscapeClosesTheTop == Top # "none" => ENABLED (Escape /\ Lower)

\* No overlay covers the dock, so each of its buttons can be pressed.
TheDockIsFree == DockFree

OneMenuAtMost == Cardinality(menu) <= 1

\* A press out of a menu closes it.
AnOutsidePressClosesAMenu == menu # {} => ENABLED (PressOutside /\ menu' = {})

FindAndTheCardDoNotStackOnAPhone == screen = "narrow" => ~(find /\ panel # "closed")

\* A pick in a menu closes that menu.
APickClosesItsMenu == [][\A m \in Menus : Pick(m) => m \notin menu']_vars
====
