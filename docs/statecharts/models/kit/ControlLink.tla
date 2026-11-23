---- MODULE ControlLink ----
\* SPEC-kit.md § The capsules, "A control in its own scope": one app frame and one control of it
\* (a React component at one place), each in its own iframe and its own scope. The frame shares a
\* part of its capsule: its cells as `remoteData` and its operations as `rpc`. After each start of a
\* scope, the frame makes a new link (a `MessageChannel`): it serves one end in that scope and
\* posts the other end to the page. The page keeps the newest end until the control is there, and
\* then gives it to the control; the page reads nothing on it. The control makes a new scope on each
\* link: its cells are a mirror of the frame's cells, and its only way to change the frame is a
\* call that the frame runs.
\*
\* A new look draws the frame in a new scope; the scope before it closes, and so does its link: a
\* message on it is lost (the control sees a `link` fault). A control with no link asks for one,
\* and the frame posts a link of its current scope. One cell with two values is enough; `MaxScope`
\* scopes and `budget` changes keep the model finite.
EXTENDS Naturals, Sequences

CONSTANTS MaxScope

None == 0
Scopes == 1..MaxScope
Values == {0, 1}
NoValue == 2
Max == 2

VARIABLES
  scope,    \* the frame's scope on screen (None: no scope started yet)
  value,    \* value[s]: the value of the cell in scope s
  held,     \* the scope of the link end that the page holds for the control (None: none)
  link,     \* the scope that the control's link reaches (None: no link yet)
  mirror,   \* the value that the control shows (NoValue: its scope waits for the first value)
  came,     \* the scope whose push gave the control the value that it shows (None: no value)
  toCtl,    \* the frame's pushes on the links, in order: the scope and the value
  toFrame,  \* the control's calls on the links, in order: the scope and the value to set
  budget    \* the changes that are left (calls, and the frame's own changes)

vars == <<scope, value, held, link, mirror, came, toCtl, toFrame, budget>>

Init ==
  /\ scope = None /\ value = [s \in Scopes |-> 0]
  /\ held = None /\ link = None /\ mirror = NoValue /\ came = None
  /\ toCtl = <<>> /\ toFrame = <<>> /\ budget = 2

\* The frame starts a scope (its first draw, or a new look): the scope before it closes with its
\* link, and the frame posts a link of the new scope to the page. An end that the page held and
\* did not give closes.
Draw ==
  /\ scope < MaxScope
  /\ scope' = scope + 1 /\ held' = scope + 1
  /\ UNCHANGED <<value, link, mirror, came, toCtl, toFrame, budget>>

\* The control has no link of the scope on screen and asks: the frame posts a link of it.
Ask ==
  /\ scope # None /\ link # scope /\ held = None
  /\ held' = scope
  /\ UNCHANGED <<scope, value, link, mirror, came, toCtl, toFrame, budget>>

\* The page gives the end that it holds to the control: the control makes a new scope on it, and
\* its watch asks the frame for the value. A link of a closed scope answers nothing.
Give ==
  /\ held # None
  /\ link' = held /\ held' = None /\ mirror' = NoValue /\ came' = None
  /\ toCtl' = IF held = scope THEN Append(toCtl, [s |-> held, v |-> value[held]]) ELSE toCtl
  /\ UNCHANGED <<scope, value, toFrame, budget>>

\* A push reaches the control: it counts only on the control's link.
Arrive ==
  /\ toCtl # <<>>
  /\ toCtl' = Tail(toCtl)
  /\ IF Head(toCtl).s = link
       THEN mirror' = Head(toCtl).v /\ came' = link
       ELSE UNCHANGED <<mirror, came>>
  /\ UNCHANGED <<scope, value, held, link, toFrame, budget>>

\* The person uses the control: it calls the frame on its link. It writes no cell of its own.
Call(v) ==
  /\ link # None /\ mirror # NoValue /\ budget > 0 /\ Len(toFrame) < Max
  /\ toFrame' = Append(toFrame, [s |-> link, v |-> v])
  /\ budget' = budget - 1
  /\ UNCHANGED <<scope, value, held, link, mirror, came, toCtl>>

\* The frame runs a call in the scope of its link, and pushes the new value on that link. A call
\* on the link of a closed scope runs nothing.
Serve ==
  /\ toFrame # <<>>
  /\ LET m == Head(toFrame)
     IN IF m.s = scope
          THEN /\ value' = [value EXCEPT ![scope] = m.v]
               /\ toCtl' = Append(toCtl, [s |-> scope, v |-> m.v])
          ELSE UNCHANGED <<value, toCtl>>
  /\ toFrame' = Tail(toFrame)
  /\ UNCHANGED <<scope, held, link, mirror, came, budget>>

\* The frame changes the value by itself (its own button): it pushes it on its link.
Own ==
  /\ scope # None /\ budget > 0 /\ Len(toCtl) < Max
  /\ value' = [value EXCEPT ![scope] = 1 - value[scope]]
  /\ toCtl' = IF link = scope THEN Append(toCtl, [s |-> scope, v |-> 1 - value[scope]]) ELSE toCtl
  /\ budget' = budget - 1
  /\ UNCHANGED <<scope, held, link, mirror, came, toFrame>>

\* Each change is done, the last scope runs, and the control shows its value: the model stops.
Done ==
  /\ scope = MaxScope /\ budget = 0 /\ held = None /\ link = scope
  /\ toCtl = <<>> /\ toFrame = <<>>
  /\ UNCHANGED vars

Next == Done \/ Draw \/ Ask \/ Give \/ Arrive \/ (\E v \in Values : Call(v)) \/ Serve \/ Own

Spec == Init /\ [][Next]_vars /\ WF_vars(Ask) /\ WF_vars(Give) /\ WF_vars(Arrive) /\ WF_vars(Serve)

\* ---------- rules, in the reader's words ----------

\* The cell of a closed scope never changes: a call on an old link runs nothing.
AClosedScopeKeepsItsValue == [][\A s \in Scopes : s # scope' => value'[s] = value[s]]_vars

\* The control shows only values of the scope that its link reaches.
TheMirrorIsOfTheLinkedScope == mirror # NoValue => came = link

\* With nothing on the way, a control linked to the scope on screen shows the frame's value.
WhenQuietTheControlShowsTheValue ==
  (link = scope /\ link # None /\ toCtl = <<>> /\ toFrame = <<>>) => mirror = value[scope]

\* After the frame starts a scope, the control comes to be linked to it.
TheControlComesToTheScopeOnScreen == (scope # None) ~> (link = scope)

\* A control that shows another value than the frame comes to show it.
TheControlComesToShowTheValue ==
  (link = scope /\ link # None /\ mirror # value[scope]) ~> (scope = None \/ link # scope \/ mirror = value[scope])

TypeOK ==
  /\ scope \in {None} \cup Scopes /\ value \in [Scopes -> Values]
  /\ held \in {None} \cup Scopes /\ link \in {None} \cup Scopes
  /\ mirror \in Values \cup {NoValue} /\ came \in {None} \cup Scopes /\ budget \in 0..2
====
