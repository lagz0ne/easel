---- MODULE FrameControls ----
\* SPEC-kit.md § The capsules, "The controls in the viewer": the controls of one app frame, in
\* one tab. The frame's file declares its controls: each runs an operation of the frame, and can
\* show the value of a cell. When a document gets its port, it posts its controls with their
\* values; after each change of a value, it posts the values. The page draws the controls in a
\* panel. A change in the panel goes on the port and runs the operation in the live scope: the
\* frame is not composed again.
\*
\* A frame has documents one after the other: a new version, another pick of the axes, or a return
\* into view gives a new document, in a new scope, whose values start again. The page takes posts
\* only from the current document, and the port of an old document closes, so a message on it is
\* lost. Two documents and one value control (0 or 1) are enough to show each order of the posts:
\* a new document takes the name of the one before the last, once no post of that one is on the
\* way (in the page, each document is its own iframe). An action (a button) changes the value too.
\* `budget` bounds the changes, so the model is finite.
EXTENDS Naturals, Sequences

Docs == {1, 2}
Values == {0, 1}
None == 0
Max == 2

VARIABLES
  doc,     \* the frame's current document (None: the frame is not live)
  made,    \* the last document that the page made (0: none yet)
  alive,   \* alive[d]: the scope of document d runs
  value,   \* value[d]: the value of the control in the scope of document d
  posted,  \* the document whose controls the panel shows (None: the panel waits)
  shown,   \* the value that the panel shows
  toApp,   \* the page's messages on the port, in order: a value to set, or an action
  toPage,  \* the document's posts on the port, in order: its controls, or its values
  budget   \* the changes that are left (picks, actions, and the app's own changes)

vars == <<doc, made, alive, value, posted, shown, toApp, toPage, budget>>

Init ==
  /\ doc = None /\ made = 0
  /\ alive = [d \in Docs |-> FALSE] /\ value = [d \in Docs |-> 0]
  /\ posted = None /\ shown = 0
  /\ toApp = <<>> /\ toPage = <<>>
  /\ budget = 2

\* The next document: the other name, once no post of its last use is on the way.
Next1 == IF made = 1 THEN 2 ELSE 1
CanMake == \A i \in 1..Len(toPage) : toPage[i].doc # Next1

\* A new document starts with the start value, and posts its controls when it gets its port.
Start(d) ==
  /\ alive' = [e \in Docs |-> IF e = d THEN TRUE ELSE IF e = doc THEN FALSE ELSE alive[e]]
  /\ value' = [value EXCEPT ![d] = 0]
  /\ toPage' = Append(toPage, [doc |-> d, kind |-> "controls", v |-> 0])
  /\ doc' = d /\ made' = d

\* The frame comes into view at rest: the page composes a document.
GoLive ==
  /\ doc = None /\ CanMake
  /\ Start(Next1)
  /\ UNCHANGED <<posted, shown, toApp, budget>>

\* A new version, or another pick of the axes: a new document; the old one closes with its port.
Replace ==
  /\ doc # None /\ CanMake
  /\ Start(Next1)
  /\ posted' = None
  /\ toApp' = SelectSeq(toApp, LAMBDA m : m.doc # doc)
  /\ UNCHANGED <<shown, budget>>

\* The frame leaves the live set: its document closes with its port.
Leave ==
  /\ doc # None
  /\ alive' = [alive EXCEPT ![doc] = FALSE]
  /\ doc' = None /\ posted' = None
  /\ toApp' = SelectSeq(toApp, LAMBDA m : m.doc # doc)
  /\ UNCHANGED <<made, value, shown, toPage, budget>>

\* A post reaches the page: it counts only from the current document.
Arrive ==
  /\ toPage # <<>>
  /\ toPage' = Tail(toPage)
  /\ LET m == Head(toPage) IN
       IF m.doc = doc
         THEN /\ posted' = doc /\ shown' = m.v
         ELSE UNCHANGED <<posted, shown>>
  /\ UNCHANGED <<doc, made, alive, value, toApp, budget>>

\* The person sets the value in the panel: it shows at once, and goes on the port.
Pick(v) ==
  /\ posted # None /\ v # shown /\ budget > 0 /\ Len(toApp) < Max
  /\ toApp' = Append(toApp, [doc |-> posted, act |-> "set", v |-> v])
  /\ shown' = v /\ budget' = budget - 1
  /\ UNCHANGED <<doc, made, alive, value, posted, toPage>>

\* The person presses an action in the panel: it goes on the port.
Act ==
  /\ posted # None /\ budget > 0 /\ Len(toApp) < Max
  /\ toApp' = Append(toApp, [doc |-> posted, act |-> "flip", v |-> 0])
  /\ budget' = budget - 1
  /\ UNCHANGED <<doc, made, alive, value, posted, shown, toPage>>

\* The document runs the operation of a message in its scope, then posts its values.
Deliver ==
  /\ toApp # <<>>
  /\ LET m == Head(toApp)
         new == IF m.act = "set" THEN m.v ELSE 1 - value[m.doc]
     IN /\ alive[m.doc]
        /\ value' = [value EXCEPT ![m.doc] = new]
        /\ toPage' = Append(toPage, [doc |-> m.doc, kind |-> "values", v |-> new])
  /\ toApp' = Tail(toApp)
  /\ UNCHANGED <<doc, made, alive, posted, shown, budget>>

\* The app changes the value by itself (the View's own button), then posts its values.
AppChange ==
  /\ doc # None /\ budget > 0 /\ Len(toPage) < Max
  /\ value' = [value EXCEPT ![doc] = 1 - value[doc]]
  /\ toPage' = Append(toPage, [doc |-> doc, kind |-> "values", v |-> 1 - value[doc]])
  /\ budget' = budget - 1
  /\ UNCHANGED <<doc, made, alive, posted, shown, toApp>>

Next ==
  \/ GoLive
  \/ Replace
  \/ Leave
  \/ Arrive
  \/ \E v \in {0, 1} : Pick(v)
  \/ Act
  \/ Deliver
  \/ AppChange

\* The port carries each message: the page reads each post, and the document runs each message.
Spec == Init /\ [][Next]_vars /\ WF_vars(Arrive) /\ WF_vars(Deliver)

\* ---------- rules, in the reader's words ----------

\* The panel shows only the controls of the frame's current document.
TheControlsAreOfTheCurrentDocument == posted # None => posted = doc

\* A message from the page goes only to the current document, whose controls the panel shows.
AControlGoesOnlyToTheCurrentDocument ==
  \A i \in 1..Len(toApp) : toApp[i].doc = doc /\ posted = doc

\* With no message on the way, the panel shows the value that the app has.
WhenQuietThePanelShowsTheValue ==
  (posted # None /\ toApp = <<>> /\ \A i \in 1..Len(toPage) : toPage[i].doc # doc)
    => shown = value[doc]

\* A panel that shows another value than the app comes to show it, unless the document goes.
ThePanelComesToShowTheValue ==
  (posted # None /\ shown # value[posted]) ~> (posted = None \/ shown = value[posted])

TypeOK ==
  /\ doc \in {None} \cup Docs /\ made \in 0..2 /\ posted \in {None} \cup Docs
  /\ alive \in [Docs -> BOOLEAN] /\ value \in [Docs -> Values]
  /\ shown \in Values /\ budget \in 0..2
====
