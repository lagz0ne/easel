---- MODULE Request ----
\* SPEC-queue.md: the states of one request, and who can move it. queue-lease (Queue.tla)
\* checks the claim, the lease and the handles between agents; this model keeps one agent
\* and a lease that is live or not, and adds the viewers, the outcomes and the way back.
\*
\* Stored: status, tries, accepted. Derived: in work (a live lease) and "needs a person"
\* (status person, or open, not in work, tries at the cap). Viewers are any viewer of the link,
\* or a user through the CLI: each call is one conditional write (judged rule 9), so a call in
\* the wrong state answers wrongState and writes nothing.
\*
\* NeedsPersonAfter is 3 in the spec. The config uses 2; the rules do not depend on it.
EXTENDS Naturals

CONSTANT NeedsPersonAfter

VARIABLES
  status,   \* "unposted" | "open" | "asking" | "resolved" | "person" | "closed"
  live,     \* an agent holds a live lease
  tries,    \* claims since the request was posted or sent back
  accepted  \* a viewer accepted the result

vars == <<status, live, tries, accepted>>

NeedsPerson ==
  \/ status = "person"
  \/ status = "open" /\ ~live /\ tries >= NeedsPersonAfter
Waiting == status = "open" /\ ~live /\ tries < NeedsPersonAfter

TypeOK ==
  /\ status \in {"unposted", "open", "asking", "resolved", "person", "closed"}
  /\ live \in BOOLEAN
  /\ tries \in 0..NeedsPersonAfter
  /\ accepted \in BOOLEAN

Init ==
  /\ status = "unposted"
  /\ live = FALSE
  /\ tries = 0
  /\ accepted = FALSE

\* request.add
ViewerAdds ==
  /\ status = "unposted"
  /\ status' = "open"
  /\ UNCHANGED <<live, tries, accepted>>

\* request.next: the claim, one try more.
AgentClaims ==
  /\ Waiting
  /\ live' = TRUE
  /\ tries' = tries + 1
  /\ UNCHANGED <<status, accepted>>

\* claimedUntil passes, with no write.
LeaseRunsOut ==
  /\ live
  /\ live' = FALSE
  /\ UNCHANGED <<status, tries, accepted>>

\* request.release --reason: no outcome; the try counts.
AgentReleases ==
  /\ live
  /\ live' = FALSE
  /\ UNCHANGED <<status, tries, accepted>>

\* The three outcomes. Each ends the lease (judged rule 10).
Outcome(s) ==
  /\ live
  /\ status' = s
  /\ live' = FALSE
  /\ accepted' = FALSE
  /\ UNCHANGED tries

AgentResolves == Outcome("resolved")
AgentAsks == Outcome("asking")
AgentDeclines == Outcome("person")

\* Back to the queue: status open, tries at 0.
SendBack ==
  /\ status' = "open"
  /\ tries' = 0
  /\ accepted' = FALSE
  /\ UNCHANGED live

\* request.edit: before an agent starts, or to make clear a request that needs a person.
ViewerEdits ==
  /\ (status = "open" /\ ~live) \/ status = "person"
  /\ SendBack

\* request.answer
ViewerAnswers ==
  /\ status = "asking"
  /\ SendBack

\* request.accept
ViewerAccepts ==
  /\ status = "resolved" /\ ~accepted
  /\ accepted' = TRUE
  /\ UNCHANGED <<status, live, tries>>

\* request.reopen
ViewerReopens ==
  /\ status = "resolved"
  /\ SendBack

\* request.close
ViewerCloses ==
  /\ (status = "open" /\ ~live) \/ status = "asking" \/ status = "person"
  /\ status' = "closed"
  /\ UNCHANGED <<live, tries, accepted>>

\* A closed request stays as it is.
Closed ==
  /\ status = "closed"
  /\ UNCHANGED vars

AgentStep == AgentClaims \/ AgentReleases \/ AgentResolves \/ AgentAsks \/ AgentDeclines
ViewerStep == ViewerEdits \/ ViewerAnswers \/ ViewerAccepts \/ ViewerReopens \/ ViewerCloses

Next == ViewerAdds \/ AgentStep \/ LeaseRunsOut \/ ViewerStep \/ Closed

\* Agents keep working the queue, and time passes. Viewers need not act.
Spec == Init /\ [][Next]_vars /\ WF_vars(AgentClaims) /\ WF_vars(LeaseRunsOut)

----
\* Rules, in the reader's words.

\* The state table: only an open request is in work.
OnlyAnOpenRequestIsInWork == live => status = "open"

\* E4.2 M14, journey "A viewer answers and decides": a request with a question is not in
\* the queue, and never needs a person by the count of tries.
AQuestionWaitsForAViewer == status = "asking" => ~Waiting /\ ~live /\ ~NeedsPerson

\* Judged rule 9: a viewer never changes a request in work.
AViewerNeverChangesARequestInWork == [][live => ~ViewerStep]_vars

\* Judged rules 9 and 11: a request that comes back to the queue starts with no tries.
ARequestComesBackWithNoTries ==
  [][(status \notin {"unposted", "open"} /\ status' = "open") => tries' = 0]_vars

\* E4.2 M15, journey "A viewer answers and decides", step 3: a result stays resolved until
\* a viewer opens it again.
AResultStaysResolvedUntilReopened ==
  [][status = "resolved" => status' \in {"resolved", "open"}]_vars

\* E4.3 P4, journey "A request no agent finishes", step 3: only a viewer or a user takes a
\* request away from a person, by an edit or a close.
OnlyAPersonActsOnARequestThatNeedsAPerson ==
  [][(NeedsPerson /\ ~NeedsPerson') => (ViewerEdits \/ ViewerCloses)]_vars

\* A closed request stays closed.
AClosedRequestStaysClosed == [][status = "closed" => status' = "closed"]_vars

\* E4.3 P6: every try ends: a lease never stays live.
EveryTryEnds == live ~> ~live

\* E4.3 P1: once no viewer acts, a request comes to rest with an outcome or with a person.
\* It never goes round the queue with no end.
ARequestEndsWithAnOutcomeOrAPerson ==
  (<>[][~ViewerStep]_vars) => <>[](status # "open" \/ NeedsPerson)

====
