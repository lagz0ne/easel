---- MODULE BoardSwitch ----
\* easel pieces: a switch for one frame or for the board (SPEC-pieces.md § Switches, rules
\* 10-13). The switch is theme, with the values light and dark; light is its default. Frames "x"
\* and "y" take the switch; frame "z" does not. Each frame is live in one tab.
\*
\* The person picks a board value in the dock, picks a value for one frame in its controls, gives
\* a frame the board value again (Use the board), or reloads. A pick writes the address of the
\* page, then each live frame whose value changes draws again in a new scope, a little later. A
\* reload opens the address again: the values come from it, and each frame draws again.
\*
\* FrameInAddress is rule 13: the address holds the frame values too
\* (?theme=dark&f.<frame>.theme=light). With FrameInAddress = FALSE it holds the board value only,
\* and the second config shows what breaks.
EXTENDS Naturals

CONSTANT FrameInAddress

Values == {"light", "dark"}
Default == "light"
Takes == {"x", "y"}
Frames == {"x", "y", "z"}
NoValue == "none"

VARIABLES
  board,    \* the board value of the tab
  own,      \* the value of each frame in Takes, or "none" when it uses the board value
  address,  \* the values in the address of the page: [board, own]
  drawn,    \* the value that each frame in Takes draws
  pending   \* the frames that draw again in a new scope, and did not draw yet

vars == <<board, own, address, drawn, pending>>

Shows(f) == IF own[f] # NoValue THEN own[f] ELSE board
NoOwn == [f \in Takes |-> NoValue]

TypeOK ==
  /\ board \in Values
  /\ own \in [Takes -> Values \union {NoValue}]
  /\ address \in [board : Values, own : [Takes -> Values \union {NoValue}]]
  /\ drawn \in [Takes -> Values]
  /\ pending \subseteq Frames

Init ==
  /\ board = Default /\ own = NoOwn
  /\ address = [board |-> Default, own |-> NoOwn]
  /\ drawn = [f \in Takes |-> Default] /\ pending = {}

\* The address after a pick: the board value, and the frame values if the address holds them.
Written(b, o) == [board |-> b, own |-> IF FrameInAddress THEN o ELSE NoOwn]

\* After a pick, each frame in Takes that shows another value draws again. "z" does not take the
\* switch, so no pick makes it draw.
Changed(o, b) == {f \in Takes : (IF o[f] # NoValue THEN o[f] ELSE b) # Shows(f)}

\* A pick of a board value in the dock.
ABoardPick(v) ==
  /\ v # board
  /\ board' = v
  /\ address' = Written(v, own)
  /\ pending' = pending \union Changed(own, v)
  /\ UNCHANGED <<own, drawn>>

\* A pick in the controls of a frame: a value for that frame only.
AFramePick(f, v) ==
  /\ own[f] # v
  /\ own' = [own EXCEPT ![f] = v]
  /\ address' = Written(board, own')
  /\ pending' = pending \union Changed(own', board)
  /\ UNCHANGED <<board, drawn>>

\* Use the board: the frame takes the board value again.
UseTheBoard(f) ==
  /\ own[f] # NoValue
  /\ own' = [own EXCEPT ![f] = NoValue]
  /\ address' = Written(board, own')
  /\ pending' = pending \union Changed(own', board)
  /\ UNCHANGED <<board, drawn>>

\* A frame draws again in a new scope, with the value that it shows now.
AFrameDraws(f) ==
  /\ f \in pending
  /\ pending' = pending \ {f}
  /\ drawn' = IF f \in Takes THEN [drawn EXCEPT ![f] = Shows(f)] ELSE drawn
  /\ UNCHANGED <<board, own, address>>

\* A reload: the values come from the address, and each frame draws again.
AReload ==
  /\ board' = address.board /\ own' = address.own
  /\ pending' = Frames
  /\ UNCHANGED <<address, drawn>>

Next ==
  \/ \E v \in Values : ABoardPick(v)
  \/ \E f \in Takes, v \in Values : AFramePick(f, v) \/ UseTheBoard(f)
  \/ \E f \in Frames : AFrameDraws(f)
  \/ AReload

Spec == Init /\ [][Next]_vars /\ \A f \in Frames : WF_vars(AFrameDraws(f))

\* ---- Rules, in the reader's words ----

\* "Each frame that takes a switch shows its own value if it has one, else the board value":
\* when it drew after the last pick.
EachFrameShowsItsValue ==
  \A f \in Takes : f \notin pending =>
    drawn[f] = IF own[f] # NoValue THEN own[f] ELSE board

\* "A frame that does not take the switch never draws again for a pick": only a reload makes
\* "z" draw again.
AFrameOffTheSwitchNeverDraws == [][("z" \in pending' /\ "z" \notin pending) => AReload]_vars

\* "A reload shows each frame as before the reload."
AReloadShowsEachFrameAsBefore == [][AReload => \A f \in Takes : Shows(f)' = Shows(f)]_vars

\* Each frame that waits draws in the end.
EachFrameDrawsInTheEnd == \A f \in Frames : (f \in pending) ~> (f \notin pending)
====
