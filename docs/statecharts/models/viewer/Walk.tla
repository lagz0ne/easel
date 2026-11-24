---- MODULE Walk ----
\* SPEC-flows.md rules 16 to 24 (E12 J1 to J4): the person walks a flow in walk mode. The flow
\* starts at screen "a". Its links: "send" of a leads to b, "next" of b leads to c, and "back" of b
\* leads to a. Screen c has the action "done" with no link. Screen "x" is on the page, and no link
\* leads to it.
\*
\* The person starts the flow, presses an action, goes Back, Restart and
\* Leave. Comment turns on the request mode: a press on the screen opens a request there, and Send
\* or Escape closes it. A press on an action with no link says that no screen comes after it, and
\* "Ask for it" opens a request on that screen. While a request is open, the screen and the bar
\* take no step. Escape closes the request first, then the request mode, then leaves.
\*
\* TrustFramePost is decision 5: with FALSE, the viewer takes only an action name from the frame
\* and finds the next screen in the links. With TRUE (chart viewer-walk-any-post), it goes to the
\* screen that the frame names.
EXTENDS Naturals, Sequences

CONSTANT TrustFramePost

Screens == {"a", "b", "c", "x"}
Start == "a"
Links == {<<"a", "send", "b">>, <<"b", "next", "c">>, <<"b", "back", "a">>}
Actions == [s \in Screens |-> CASE s = "a" -> {"send"}
                                [] s = "b" -> {"next", "back"}
                                [] s = "c" -> {"done"}
                                [] OTHER -> {}]
MaxSteps == 3

VARIABLES
  mode,   \* "canvas" or "walk"
  path,   \* the screens of the steps; the last one shows
  told,   \* what the bar says: "none", or "noScreen" after a press on an action with no link
  ask     \* the request mode in the walk: "off", "on", or "open" (a request on the shown screen)

vars == <<mode, path, told, ask>>

Shown == path[Len(path)]
LinkOf(s, act) == {l \in Links : l[1] = s /\ l[2] = act}
Linked(s, t) == \E l \in Links : l[1] = s /\ l[3] = t

Init == mode = "canvas" /\ path = <<>> /\ told = "none" /\ ask = "off"

Walking == mode = "walk"
Free == Walking /\ ask = "off"

\* A press on the mark of the flow, or on the flow in the Flows menu.
StartFlow ==
  /\ mode = "canvas"
  /\ mode' = "walk" /\ path' = <<Start>> /\ told' = "none" /\ ask' = "off"

\* A press on an action that has a link: the next screen shows.
PressLinked(act) ==
  /\ Free /\ Len(path) < MaxSteps
  /\ act \in Actions[Shown] /\ LinkOf(Shown, act) # {}
  /\ \E l \in LinkOf(Shown, act) : path' = Append(path, l[3])
  /\ told' = "none"
  /\ UNCHANGED <<mode, ask>>

\* A press on an action with no link: the screen stays, and the bar says so.
PressUnlinked(act) ==
  /\ Free
  /\ act \in Actions[Shown] /\ LinkOf(Shown, act) = {}
  /\ told' = "noScreen"
  /\ UNCHANGED <<mode, path, ask>>

\* Only with TrustFramePost: the frame posts a screen, and the viewer goes there.
FramePostsScreen(s) ==
  /\ TrustFramePost /\ Free /\ Len(path) < MaxSteps
  /\ path' = Append(path, s) /\ told' = "none"
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

\* "Ask for it" after a press on an action with no link.
AskForIt ==
  /\ Walking /\ told = "noScreen" /\ ask # "open"
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
  \/ StartFlow
  \/ \E t \in Screens : \E act \in Actions[t] : PressLinked(act) \/ PressUnlinked(act)
  \/ \E s \in Screens : FramePostsScreen(s)
  \/ Back \/ Restart \/ Leave \/ Comment \/ PressToAsk \/ AskForIt \/ Send \/ Escape

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ mode \in {"canvas", "walk"}
  /\ path \in Seq(Screens) /\ Len(path) <= MaxSteps
  /\ told \in {"none", "noScreen"}
  /\ ask \in {"off", "on", "open"}
  /\ (mode = "canvas") <=> (path = <<>>)

\* "The walk shows only a screen that a link reaches": each step comes from a link of the screen
\* before it.
EachStepIsALink ==
  Walking => (path[1] = Start /\ \A i \in 1..(Len(path) - 1) : Linked(path[i], path[i + 1]))

\* "Back shows the screen of the step before."
BackShowsTheScreenBefore == [][Back => Shown' = path[Len(path) - 1]]_vars

\* "A press on an action with no link keeps the screen."
NoLinkKeepsTheScreen == [][told' = "noScreen" => path' = path]_vars

\* "A request made in the walk is on the screen that shows": while it is open, no step changes
\* the screen.
ARequestStaysOnItsScreen == [][(ask = "open" /\ Walking') => Shown' = Shown]_vars

\* "Escape with a request open never leaves the walk."
NoLeaveWithARequestOpen == [][(ask = "open" /\ Walking) => Walking']_vars
====
