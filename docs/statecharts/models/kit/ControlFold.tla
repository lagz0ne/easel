---- MODULE ControlFold ----
\* SPEC-kit.md § The capsules, "The place of a control" (2026-11-24): a column of controls docked
\* at the left or right edge of an app frame lies over the frame beside it. So it is open only
\* while its frame is in use, as Figma shows the tools of a frame on selection: the pointer is on
\* the frame or on the column, the focus of the keyboard is in the column, the frame has the mark
\* of Find, or a press on the tab opened it. Out of use, it folds to a small tab at that edge.
\*
\* One column of one frame. The column's box touches the frame (its 8 px edge is part of it), so
\* a move of the pointer from the frame to the column never leaves the two. When the pointer
\* leaves both, the column stays open for a short delay (300 ms), so a move out and back does not
\* fold it. A press on the tab opens the column until the pointer and the focus leave. A touch
\* screen has no pointer that hovers: a tap on the tab opens the column, and a tap out of it folds
\* it. The focus counts only when the browser shows it (`:focus-visible`: the keyboard, or a text
\* field), so a click on a button does not keep the column open.
EXTENDS Naturals

CONSTANTS Devices

VARIABLES
  device,     \* "mouse" (a pointer that hovers) or "touch"
  pointer,    \* where the pointer is: "away", "frame" or "column" (the tab is in the column)
  focus,      \* where the shown focus is: "none", "tab", or "column" (on a control)
  marked,     \* TRUE while the frame has the mark of Find
  pressed,    \* TRUE after a press on the tab, until the pointer and the focus leave
  lingering   \* TRUE while the delay after the pointer left runs

vars == <<device, pointer, focus, marked, pressed, lingering>>

TypeOK ==
  /\ device \in {"mouse", "touch"}
  /\ pointer \in {"away", "frame", "column"}
  /\ focus \in {"none", "tab", "column"}
  /\ marked \in BOOLEAN /\ pressed \in BOOLEAN /\ lingering \in BOOLEAN

InUse == pointer # "away" \/ focus = "column" \/ marked \/ pressed

Open == InUse \/ lingering

Init ==
  /\ device \in Devices
  /\ pointer = "away" /\ focus = "none"
  /\ marked = FALSE /\ pressed = FALSE /\ lingering = FALSE

\* ---- The pointer (a mouse only) ----

\* The pointer comes onto the frame or the column, or moves from one to the other.
PointTo(p) ==
  /\ device = "mouse"
  /\ p # "away" /\ p # pointer
  /\ pointer' = p
  /\ lingering' = FALSE
  /\ UNCHANGED <<device, focus, marked, pressed>>

\* The pointer leaves the frame and the column: the delay starts.
PointAway ==
  /\ device = "mouse"
  /\ pointer # "away"
  /\ pointer' = "away"
  /\ lingering' = TRUE
  /\ UNCHANGED <<device, focus, marked, pressed>>

\* The delay ends with the pointer still away. A press holds only while the focus stays.
DelayEnds ==
  /\ lingering /\ pointer = "away"
  /\ lingering' = FALSE
  /\ pressed' = (pressed /\ focus # "none")
  /\ UNCHANGED <<device, pointer, focus, marked>>

\* ---- The tab and the controls ----

\* A press on the tab: a click, Enter or Space, or a tap. It opens a folded column, and a second
\* press ends it.
PressTab ==
  /\ pressed' = ~(Open /\ pressed)
  /\ UNCHANGED <<device, pointer, focus, marked, lingering>>

\* A press on a control of the open column runs it.
PressControl ==
  /\ Open
  /\ pointer = "column" \/ device = "touch" \/ focus = "column"
  /\ UNCHANGED vars

\* A press or a tap out of the frame and the column: a press there ends, and the focus goes.
PressOutside ==
  /\ pointer = "away"
  /\ pressed' = FALSE /\ focus' = "none"
  /\ UNCHANGED <<device, pointer, marked, lingering>>

\* ---- The keyboard ----

\* Tab moves the focus onto the tab, or onto a control while the column is open.
FocusOn(f) ==
  /\ f # "none" /\ f # focus
  /\ f = "column" => Open
  /\ focus' = f
  /\ UNCHANGED <<device, pointer, marked, pressed, lingering>>

\* The focus leaves the column. With the pointer away, a press ends.
FocusOff ==
  /\ focus # "none"
  /\ focus' = "none"
  /\ pressed' = (pressed /\ (pointer # "away" \/ lingering))
  /\ UNCHANGED <<device, pointer, marked, lingering>>

\* ---- Find ----

Mark ==
  /\ ~marked /\ marked' = TRUE
  /\ UNCHANGED <<device, pointer, focus, pressed, lingering>>

\* A pan, a zoom or a press on the canvas ends the mark.
Unmark ==
  /\ marked /\ marked' = FALSE
  /\ UNCHANGED <<device, pointer, focus, pressed, lingering>>

Next ==
  \/ \E p \in {"frame", "column"} : PointTo(p)
  \/ PointAway \/ DelayEnds
  \/ PressTab \/ PressControl \/ PressOutside
  \/ \E f \in {"tab", "column"} : FocusOn(f)
  \/ FocusOff
  \/ Mark \/ Unmark

Spec == Init /\ [][Next]_vars /\ WF_vars(DelayEnds)

\* ---- The rules ----

\* The column is open only while its frame is in use, or for the delay after the pointer left.
OpenOnlyInUse == Open => (InUse \/ (lingering /\ pointer = "away"))

\* Out of use, the column folds: it never stays open over the frame beside it.
OutOfUseItFolds == (~InUse) ~> (~Open \/ InUse)

\* From the tab, one press opens a folded column.
OnePressOnTheTabOpens == ~Open => ENABLED (PressTab /\ Open')

\* A control of the open column can always be pressed: with the pointer on it, after a tap, or
\* with the focus on it, the column stays open.
AControlCanBePressed ==
  (Open /\ (pointer = "column" \/ device = "touch" \/ focus = "column")) => ENABLED PressControl

\* A move of the pointer from the frame to the column does not fold it.
FromTheFrameToTheColumnItStaysOpen ==
  [][(pointer = "frame" /\ pointer' = "column") => Open']_vars
====
