---- MODULE Walk ----
\* SPEC-prototype.md ship 4 (rules 8 and 9), with the walk of SPEC-flows.md rules 19 to 24
\* (E12 J1 to J4): the person walks a map of the code. The map starts at the state "name". Its
\* moves: name to code, code to in, code to denied, and denied to name. The state "x" is a state
\* that the code can reach and the map does not have (an answer with no designed screen).
\*
\* The screen runs the real code. A press on the screen, or the pick of an answer, can change the
\* cell to any state: the code decides, not the map. The frame then posts the new state. The person
\* starts the walk, goes Back, Restart and Leave. Comment turns on the request mode: a press on
\* the screen opens a request there, and Send or Escape closes it. A state that no move of the map
\* reaches from the shown state is off the map: the screen stays, the bar says so, and "Ask for
\* it" opens a request on that screen. While a request is open, the screen and the bar take no
\* step. Escape closes the request first, then the request mode, then leaves.
\*
\* TrustFramePost is rule 9: with FALSE, the viewer shows a posted state only when a move of the
\* map from the shown state reaches it. With TRUE (chart viewer-walk-any-post), it shows each
\* state that the frame posts.
EXTENDS Naturals, Sequences

CONSTANT TrustFramePost

States == {"name", "code", "in", "denied", "x"}
Start == "name"
Moves == {<<"name", "code">>, <<"code", "in">>, <<"code", "denied">>, <<"denied", "name">>}
MaxSteps == 3

VARIABLES
  mode,   \* "canvas" or "walk"
  path,   \* the states of the steps; the last one shows
  told,   \* what the bar says: "none", or "offMap" after the code reached a state off the map
  ask     \* the request mode in the walk: "off", "on", or "open" (a request on the shown screen)

vars == <<mode, path, told, ask>>

Shown == path[Len(path)]
Moved(s, t) == <<s, t>> \in Moves

Init == mode = "canvas" /\ path = <<>> /\ told = "none" /\ ask = "off"

Walking == mode = "walk"
Free == Walking /\ ask = "off"

\* A press on the mark of the walk frame, or on the map in the list Maps.
StartWalk ==
  /\ mode = "canvas"
  /\ mode' = "walk" /\ path' = <<Start>> /\ told' = "none" /\ ask' = "off"

\* The real code changed the cell to the state s, and the frame posts s.
CellChanges(s) ==
  /\ Free /\ Len(path) < MaxSteps /\ s # Shown
  /\ IF TrustFramePost \/ Moved(Shown, s)
       THEN path' = Append(path, s) /\ told' = "none"
       ELSE told' = "offMap" /\ UNCHANGED path
  /\ UNCHANGED <<mode, ask>>

Back ==
  /\ Free /\ Len(path) > 1
  /\ path' = SubSeq(path, 1, Len(path) - 1) /\ told' = "none"
  /\ UNCHANGED <<mode, ask>>

Restart ==
  /\ Free /\ Len(path) > 1
  /\ path' = <<Start>> /\ told' = "none"
  /\ UNCHANGED <<mode, ask>>

Leave ==
  /\ Walking /\ ask # "open"
  /\ mode' = "canvas" /\ path' = <<>> /\ told' = "none" /\ ask' = "off"

Comment ==
  /\ Walking /\ ask # "open"
  /\ ask' = IF ask = "off" THEN "on" ELSE "off"
  /\ UNCHANGED <<mode, path, told>>

\* In the request mode, a press on the screen opens a request at that place.
PressToAsk ==
  /\ Walking /\ ask = "on"
  /\ ask' = "open"
  /\ UNCHANGED <<mode, path, told>>

\* "Ask for it" after the code reached a state off the map.
AskForIt ==
  /\ Walking /\ told = "offMap" /\ ask # "open"
  /\ ask' = "open" /\ told' = "none"
  /\ UNCHANGED <<mode, path>>

\* Send: the request is on the screen that shows; the walk stays.
Send ==
  /\ Walking /\ ask = "open"
  /\ ask' = "off"
  /\ UNCHANGED <<mode, path, told>>

\* Escape closes the request first, then the request mode, then the walk.
Escape ==
  /\ Walking
  /\ IF ask = "open" THEN ask' = "off" /\ UNCHANGED <<mode, path, told>>
     ELSE IF ask = "on" THEN ask' = "off" /\ UNCHANGED <<mode, path, told>>
     ELSE mode' = "canvas" /\ path' = <<>> /\ told' = "none" /\ UNCHANGED ask

Next ==
  \/ StartWalk
  \/ \E s \in States : CellChanges(s)
  \/ Back \/ Restart \/ Leave \/ Comment \/ PressToAsk \/ AskForIt \/ Send \/ Escape

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ mode \in {"canvas", "walk"}
  /\ path \in Seq(States) /\ Len(path) <= MaxSteps
  /\ told \in {"none", "offMap"}
  /\ ask \in {"off", "on", "open"}
  /\ (mode = "canvas") <=> (path = <<>>)

\* "The walk shows only a state that a move of the map from the shown state reaches": each step
\* comes from a move of the map from the state of the step before it.
EachStepIsAMove ==
  Walking => (path[1] = Start /\ \A i \in 1..(Len(path) - 1) : Moved(path[i], path[i + 1]))

\* "Back shows the state of the step before."
BackShowsTheStateBefore == [][Back => Shown' = path[Len(path) - 1]]_vars

\* "A state off the map keeps the shown state."
OffMapKeepsTheState == [][told' = "offMap" => path' = path]_vars

\* "A request made in the walk is on the screen that shows": while it is open, no step changes
\* the screen.
ARequestStaysOnItsScreen == [][(ask = "open" /\ Walking') => Shown' = Shown]_vars

\* "Escape with a request open never leaves the walk."
NoLeaveWithARequestOpen == [][(ask = "open" /\ Walking) => Walking']_vars
====
