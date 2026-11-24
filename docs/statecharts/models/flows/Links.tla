---- MODULE Links ----
\* SPEC-flows.md rules 1 to 11 (E12 J6, J8): the links of a flow, and the changes of an agent that
\* break them. Screen a has the action "send", which leads to screen b. Screen b has the action
\* "next", which leads to screen c. The three screens are on page 1.
\*
\* The agent puts a version of a with no "send", and a version with it again; moves c to page 2
\* and back; and deletes c. After each change, easel finds the state of each link of the screen
\* and to it again, and the answer tells each link that the change broke (rules 9 and 10).
\*
\* CheckActions is rule 9 for a put: with FALSE (chart flows-links-unchecked), a put of a new
\* version does not look at the actions of the screen.
EXTENDS Naturals

CONSTANT CheckActions

Links == {"send", "next"}
From == [l \in Links |-> IF l = "send" THEN "a" ELSE "b"]
To == [l \in Links |-> IF l = "send" THEN "b" ELSE "c"]
Causes == {"none", "screen", "page", "action"}

VARIABLES
  hasSend,  \* the current version of a has the action "send"
  cPage,    \* the page of c: 1 or 2
  cThere,   \* c is on the canvas
  broken,   \* the state of each link that easel keeps: "none" or its cause
  told      \* the links that the answer of the last change named as broken

vars == <<hasSend, cPage, cThere, broken, told>>

PageOf(s) == IF s = "c" THEN cPage ELSE 1
There(s) == s # "c" \/ cThere
HasAction(l) == IF l = "send" THEN hasSend ELSE TRUE

\* The true cause of a link, in the order of rule 2 of the facts.
Cause(l) ==
  IF ~There(To[l]) THEN "screen"
  ELSE IF PageOf(From[l]) # PageOf(To[l]) THEN "page"
  ELSE IF ~HasAction(l) THEN "action"
  ELSE "none"

\* The new state of each link after a change, as easel finds it again.
Found == [l \in Links |-> Cause(l)]
NewlyBroken(after) == {l \in Links : broken[l] = "none" /\ after[l] # "none"}

Init ==
  /\ hasSend = TRUE /\ cPage = 1 /\ cThere = TRUE
  /\ broken = [l \in Links |-> "none"] /\ told = {}

Answer(after) == broken' = after /\ told' = NewlyBroken(after)

\* frame.put of a new version of a, with or without the action "send".
PutA(withSend) ==
  /\ hasSend # withSend
  /\ hasSend' = withSend
  /\ LET after == [l \in Links |-> IF ~There(To[l]) THEN "screen"
                                   ELSE IF PageOf(From[l]) # PageOf(To[l]) THEN "page"
                                   ELSE IF l = "send" /\ ~withSend THEN "action"
                                   ELSE "none"]
     IN IF CheckActions THEN Answer(after) ELSE UNCHANGED <<broken, told>>
  /\ UNCHANGED <<cPage, cThere>>

\* frame.move of c to the other page.
MoveC ==
  /\ cThere
  /\ cPage' = 3 - cPage
  /\ LET after == [l \in Links |-> IF l = "next" /\ cPage' # 1 THEN "page"
                                   ELSE IF l = "send" /\ ~hasSend THEN "action"
                                   ELSE "none"]
     IN Answer(after)
  /\ UNCHANGED <<hasSend, cThere>>

\* frame.delete of c.
DeleteC ==
  /\ cThere
  /\ cThere' = FALSE
  /\ LET after == [l \in Links |-> IF l = "next" THEN "screen"
                                   ELSE IF ~hasSend THEN "action"
                                   ELSE "none"]
     IN Answer(after)
  /\ UNCHANGED <<hasSend, cPage>>

Next == PutA(TRUE) \/ PutA(FALSE) \/ MoveC \/ DeleteC

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ hasSend \in BOOLEAN /\ cPage \in {1, 2} /\ cThere \in BOOLEAN
  /\ broken \in [Links -> Causes] /\ told \subseteq Links

\* "Each link is whole or marked broken with its true cause."
EachLinkShowsItsCause == \A l \in Links : broken[l] = Cause(l)

\* "The answer of a change tells each link that the change broke."
EachBreakIsTold ==
  [][\A l \in Links : (broken[l] = "none" /\ broken'[l] # "none") => l \in told']_vars

\* "A link holds when its screens move on one page or change and keep the action": a link that
\* breaks has a cause.
NoBreakWithNoCause == [][\A l \in Links : broken'[l] # "none" => Cause(l)' # "none"]_vars
====
