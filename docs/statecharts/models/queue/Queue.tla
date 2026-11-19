---- MODULE Queue ----
\* SPEC-queue.md: the one request queue, SQS style: a lease, a release, the outcome of a try,
\* the count of tries, and "needs a person". Two requests (1 is posted before 2), two agents A
\* and B.
\* An outcome (a result, a question, a decline) takes a request out of the queue. This model
\* calls that "out". request-life (Request.tla) splits "out" into its states, and checks how
\* a viewer or a user sends a request back (an edit, an answer, a reopen).
\* Time is not a number here. A lease is "live", then "out": that is claimedUntil
\* against the server's time. Tabs and agents read the same time (the board carries the
\* server's clock offset), so a lease runs out for all of them in one step.
\* `by` is the live lease's claim handle. A handle is a fresh value per claim (SQS's receipt
\* handle): <<agent, n>>, where agent A's n flips on each claim it makes while it holds a handle,
\* and starts again at 0 once it holds none. Agent A may run next
\* again while it still keeps the handle of a claim whose lease ran out (two shells, or a
\* retry), so it can hold an old handle and a new one on the same request; the server must
\* refuse the old one. Agent B lets go of each handle before its next claim, so its n stays 0
\* (the model's size only). Nothing stored says "in work" or "needs a person": a tab derives
\* them (Shown) from claimedUntil and tries.
\* Extend keeps a live lease live; time is not a number, so it moves nothing else here.
\*
\* NeedsPersonAfter is 3 in the spec. Both configs use 2, so the chart stays small; the rules
\* do not depend on the number.
\*
\* ATOMIC = TRUE  (Queue.cfg): request.next finds and writes its claim in one
\*                 conditional write (SPEC-queue.md, judged rule 6).
\* ATOMIC = FALSE (QueueTwoStep.cfg): it finds, awaits, then writes without looking
\*                 again. That config is EXPECTED to break: it shows why the claim is
\*                 one write.
EXTENDS Naturals, FiniteSets

CONSTANTS ATOMIC, NeedsPersonAfter

Agents == {"A", "B"}
Requests == {1, 2}
None == <<"-", 0>>  \* no handle
NoRequest == 0

VARIABLES
  status,    \* status[r], stored: "unposted" | "open" | "out"
  by,        \* by[r]: the claim handle of the latest claim, while its lease is live
  lease,     \* lease[r]: claimedUntil against the clock: "none" | "live" | "out"
  tries,     \* tries[r], stored: claims since the request was posted or sent back
  noOutcome, \* noOutcome[r]: tries that ended with no outcome (the model's count, not stored)
  agent,     \* agent[a]: "idle" | "waiting" | "picked" | "working"
  claim,     \* claim[a]: the request agent a has picked or holds a claim handle for
  mine,      \* mine[a]: agent a's own lease, by the `until` it was told: "none" | "live" | "out"
  ahead,     \* ahead: the request first in queue order (a return to the queue goes to the back)
  gen,       \* gen: agent A's n for its latest handle (B's is always 0)
  old        \* old: the request of the older handle agent A still keeps after it claimed again

vars == <<status, by, lease, tries, noOutcome, agent, claim, mine, ahead, gen, old>>
Handles == Agents \X {0, 1}
N(a) == IF a = "A" THEN gen ELSE 0
Handle(a) == <<a, N(a)>>
OldHandle == <<"A", 1 - gen>>
board == <<status, by, lease, tries, ahead>>

Older(d, r) == d # r /\ d = ahead
Live(r) == lease[r] = "live"

\* What a tab shows, from the board and the clock alone.
Shown(r) ==
  IF status[r] = "out" THEN "out"
  ELSE IF Live(r) THEN "inWork"
  ELSE IF tries[r] >= NeedsPersonAfter THEN "person"
  ELSE "waiting"

NeedsPerson(r) == status[r] = "open" /\ Shown(r) = "person"
Takeable(r) == status[r] = "open" /\ ~Live(r) /\ tries[r] < NeedsPersonAfter
Oldest(r) == Takeable(r) /\ \A d \in Requests : Older(d, r) => ~Takeable(d)
\* A request still in the queue: open and in work or waiting. Queue order matters only
\* between two such requests, so the model sets `ahead` back to 1 when one leaves.
InPlay(r) == status[r] = "open" /\ (Live(r) \/ tries[r] < NeedsPersonAfter)
NothingTakeable == \A r \in Requests : ~Takeable(r)

TypeOK ==
  /\ status \in [Requests -> {"unposted", "open", "out"}]
  /\ by \in [Requests -> Handles \cup {None}]
  /\ lease \in [Requests -> {"none", "live", "out"}]
  /\ tries \in [Requests -> 0..NeedsPersonAfter]
  /\ noOutcome \in [Requests -> 0..NeedsPersonAfter]
  /\ agent \in [Agents -> {"idle", "waiting", "picked", "working"}]
  /\ claim \in [Agents -> Requests \cup {NoRequest}]
  /\ mine \in [Agents -> {"none", "live", "out"}]
  /\ ahead \in Requests
  /\ gen \in {0, 1}
  /\ old \in Requests \cup {NoRequest}

Init ==
  /\ status = [r \in Requests |-> "unposted"]
  /\ by = [r \in Requests |-> None]
  /\ lease = [r \in Requests |-> "none"]
  /\ tries = [r \in Requests |-> 0]
  /\ noOutcome = [r \in Requests |-> 0]
  /\ agent = [a \in Agents |-> "idle"]
  /\ claim = [a \in Agents |-> NoRequest]
  /\ mine = [a \in Agents |-> "none"]
  /\ ahead = 1
  /\ gen = 0
  /\ old = NoRequest

\* Each agent that waits wakes and asks again: a request may be takeable now.
Wake == [a \in Agents |-> IF agent[a] = "waiting" THEN "idle" ELSE agent[a]]

\* A viewer posts request r (1 before 2). It is open, with no claim.
ViewerPosts(r) ==
  /\ status[r] = "unposted"
  /\ \A d \in Requests : d < r => status[d] # "unposted"
  /\ status' = [status EXCEPT ![r] = "open"]
  /\ agent' = Wake
  /\ UNCHANGED <<by, lease, tries, noOutcome, claim, mine, ahead, gen, old>>

\* An agent that may run easel next: it is idle, or it is agent A, whose own lease ran out,
\* with no older handle kept yet. A keeps the handle it had.
MayAskAgain(a) == a = "A" /\ agent[a] = "working" /\ mine[a] = "out" /\ old = NoRequest
MayAsk(a) == agent[a] = "idle" \/ MayAskAgain(a)

\* The claim is written: a fresh handle, a live lease, one more try.
WriteClaim(a, r) ==
  /\ gen' = IF a = "A" THEN 1 - gen ELSE gen
  /\ by' = [by EXCEPT ![r] = <<a, IF a = "A" THEN 1 - gen ELSE 0>>]
  /\ lease' = [lease EXCEPT ![r] = "live"]
  /\ tries' = [tries EXCEPT ![r] = @ + 1]
  /\ agent' = [agent EXCEPT ![a] = "working"]
  /\ claim' = [claim EXCEPT ![a] = r]
  /\ mine' = [mine EXCEPT ![a] = "live"]
  /\ old' = IF agent[a] = "working" THEN claim[a] ELSE old
  /\ UNCHANGED <<status, noOutcome, ahead>>

\* easel next, one conditional write.
AgentTakes(a) ==
  /\ ATOMIC
  /\ MayAsk(a)
  /\ \E r \in Requests :
       /\ Oldest(r)
       \* the model's size: A asks again only to get request 2 again, the one the chart follows
       /\ agent[a] = "working" => r = claim[a] /\ r = 2
       /\ WriteClaim(a, r)

\* What-if, step 1: it finds the oldest it can take ...
AgentPicks(a) ==
  /\ ~ATOMIC
  /\ agent[a] = "idle"
  /\ \E r \in Requests :
       /\ Oldest(r)
       /\ agent' = [agent EXCEPT ![a] = "picked"]
       /\ claim' = [claim EXCEPT ![a] = r]
  /\ UNCHANGED <<status, by, lease, tries, noOutcome, mine, ahead, gen, old>>

\* ... step 2: after the await, it writes its claim without looking again.
AgentWritesPick(a) ==
  /\ agent[a] = "picked"
  /\ WriteClaim(a, claim[a])

\* A call of easel next finds nothing to take: it waits (at most 50 s), holding no lock.
AgentWaits(a) ==
  /\ agent[a] = "idle"
  /\ NothingTakeable
  /\ agent' = [agent EXCEPT ![a] = "waiting"]
  /\ UNCHANGED <<status, by, lease, tries, noOutcome, claim, mine, ahead, gen, old>>

\* The wait ends with nothing to take: the call answers empty (the CLI may call again).
WaitEndsEmpty(a) ==
  /\ agent[a] = "waiting"
  /\ NothingTakeable
  /\ agent' = [agent EXCEPT ![a] = "idle"]
  /\ UNCHANGED <<status, by, lease, tries, noOutcome, claim, mine, ahead, gen, old>>

\* claimedUntil passes. Nothing is written (judged rule 7). Each agent told that `until`
\* sees its own lease run out. A waiting next wakes at that time, unless the request now
\* needs a person (the wait's deadline is the earliest claimedUntil in its scope).
LeaseRunsOut(r) ==
  /\ status[r] = "open" /\ lease[r] = "live"
  /\ r # old  \* the model's size: A uses its kept handle before its new lease runs out
  /\ lease' = [lease EXCEPT ![r] = "out"]
  /\ by' = [by EXCEPT ![r] = None]
  /\ noOutcome' = [noOutcome EXCEPT ![r] = @ + 1]
  /\ mine' = [a \in Agents |-> IF claim[a] = r /\ mine[a] = "live" THEN "out" ELSE mine[a]]
  /\ agent' = IF tries[r] < NeedsPersonAfter THEN Wake ELSE agent
  /\ ahead' = IF tries[r] < NeedsPersonAfter THEN ahead ELSE 1
  /\ UNCHANGED <<status, tries, claim, gen, old>>

\* The server's checks on a claim handle h for request r, in order (judged rule 8): not open
\* (wrongState), then the live lease's handle, else lost.
Check(h, r) ==
  CASE status[r] # "open"       -> "wrongState"
    [] by[r] = h /\ Live(r)     -> "ok"
    [] OTHER                    -> "lost"
LiveHandle(a, r) == Check(Handle(a), r) = "ok"

\* The agent lets go of its handle. Agent A first uses or drops the older handle it kept
\* (AgentUsesTheOldHandle), and its next claim starts again at n = 0.
LetsGo(a) ==
  /\ a = "A" => old = NoRequest
  /\ gen' = IF a = "A" THEN 0 ELSE gen
  /\ agent' = [agent EXCEPT ![a] = "idle"]
  /\ claim' = [claim EXCEPT ![a] = NoRequest]
  /\ mine' = [mine EXCEPT ![a] = "none"]

\* easel resolve, ask or decline: the holder of the live lease ends the try with an outcome.
\* The request leaves the queue (judged rule 10).
AgentEndsTheTry(a) ==
  /\ agent[a] = "working"
  /\ LiveHandle(a, claim[a])
  /\ status' = [status EXCEPT ![claim[a]] = "out"]
  /\ by' = [by EXCEPT ![claim[a]] = None]
  /\ lease' = [lease EXCEPT ![claim[a]] = "none"]
  /\ ahead' = 1
  /\ LetsGo(a)
  /\ UNCHANGED <<tries, noOutcome, old>>

\* easel release <claim> --reason: the holder gives it back, with no outcome. The try counts.
\* It goes to the back of the queue, behind every request posted so far.
AgentReleases(a) ==
  /\ agent[a] = "working"
  \* the model's size: a release is the first try with no outcome; a lease that runs out
  \* makes the second
  /\ noOutcome[claim[a]] = 0
  /\ LiveHandle(a, claim[a])
  /\ by' = [by EXCEPT ![claim[a]] = None]
  /\ lease' = [lease EXCEPT ![claim[a]] = "none"]
  /\ noOutcome' = [noOutcome EXCEPT ![claim[a]] = @ + 1]
  /\ agent' = [b \in Agents |->
                 IF b = a THEN "idle" ELSE IF agent[b] = "waiting" THEN "idle" ELSE agent[b]]
  /\ claim' = [claim EXCEPT ![a] = NoRequest]
  /\ mine' = [mine EXCEPT ![a] = "none"]
  /\ a = "A" => old = NoRequest
  /\ gen' = IF a = "A" THEN 0 ELSE gen
  /\ ahead' = IF InPlay(3 - claim[a]) THEN 3 - claim[a] ELSE 1
  /\ UNCHANGED <<status, tries, old>>

\* easel extend <claim>: the holder's lease starts again. It stays live; time is not a number.
AgentExtends(a) ==
  /\ agent[a] = "working"
  /\ LiveHandle(a, claim[a])
  /\ UNCHANGED vars

\* A call with a handle on a request that left the queue answers wrongState, and writes
\* nothing. The status is checked before the handle (SPEC-queue.md, judged rule 8).
HandleToldWrongState(a) ==
  /\ agent[a] = "working"
  /\ Check(Handle(a), claim[a]) = "wrongState"
  /\ LetsGo(a)
  /\ UNCHANGED <<board, noOutcome, old>>

\* A call with a handle that is not the live one answers lost.
HandleToldLost(a) ==
  /\ agent[a] = "working"
  /\ Check(Handle(a), claim[a]) = "lost"
  /\ LetsGo(a)
  /\ UNCHANGED <<board, noOutcome, old>>

\* Agent A calls with the older handle it kept, after it claimed again. The server checks
\* that handle; the answer (wrongState or lost) writes nothing, and A drops it.
\* (OldHandleIsRefused says the check never answers ok.)
AgentUsesTheOldHandle ==
  /\ old # NoRequest /\ agent["A"] = "working"
  /\ old' = NoRequest
  /\ UNCHANGED <<status, by, lease, tries, noOutcome, agent, claim, mine, ahead, gen>>

AgentStep(a) ==
  \/ AgentTakes(a) \/ AgentPicks(a) \/ AgentWritesPick(a)
  \/ AgentWaits(a) \/ WaitEndsEmpty(a)
  \/ AgentEndsTheTry(a) \/ HandleToldWrongState(a) \/ HandleToldLost(a)

Next ==
  \/ \E r \in Requests : ViewerPosts(r) \/ LeaseRunsOut(r)
  \/ \E a \in Agents : AgentStep(a) \/ AgentReleases(a) \/ AgentExtends(a)
  \/ AgentUsesTheOldHandle

\* Agents keep working the queue, and time passes. Viewers need not post; an
\* agent need not extend, release or end its try before its lease runs out.
Fairness ==
  /\ \A a \in Agents : WF_vars(AgentStep(a))
  /\ WF_vars(AgentUsesTheOldHandle)
  /\ \A r \in Requests : WF_vars(LeaseRunsOut(r))

Spec == Init /\ [][Next]_vars /\ Fairness

----
\* Rules, in the reader's words.

Holds(a, r) == agent[a] = "working" /\ claim[a] = r /\ mine[a] = "live"
Taking(a) == agent[a] # "working" /\ agent'[a] = "working"

\* Judged rule 6, journey 9: a request is held by at most one agent at a time.
ARequestIsHeldByAtMostOneAgent ==
  \A r \in Requests : Cardinality({a \in Agents : Holds(a, r)}) <= 1

\* Judged rule 5: a request no agent has claimed has no claim.
AnUnclaimedRequestHasNoClaim ==
  \A r \in Requests : (status[r] = "open" /\ tries[r] = 0) => by[r] = None /\ lease[r] = "none"

\* Judged rule 7, the state table: a tab shows a request in work exactly while its lease is
\* live.
ATabShowsInWorkOnlyWhileTheLeaseIsLive ==
  \A r \in Requests : status[r] = "open" => (Shown(r) = "inWork" <=> Live(r))

\* Judged rule 12, journey 2: an agent that waits for work is woken as soon as a request
\* can be taken.
AWaitingAgentIsWokenWhenARequestCanBeTaken ==
  \A a \in Agents : agent[a] = "waiting" => NothingTakeable

\* Judged rule 11: tries counts each try that ended with no outcome (a release or a lease
\* that ran out), plus the live one.
TriesCountTriesWithNoOutcome ==
  \A r \in Requests :
    status[r] = "open" => tries[r] = noOutcome[r] + (IF Live(r) THEN 1 ELSE 0)

\* Judged rule 11: a request needs a person once enough tries ended with no outcome, and
\* only then.
ARequestNeedsAPersonOnlyAfterTriesWithNoOutcome ==
  \A r \in Requests :
    status[r] = "open" => (NeedsPerson(r) <=> (noOutcome[r] >= NeedsPersonAfter /\ ~Live(r)))

\* Judged rules 8 and 10: only the holder of the live lease ends a try with an outcome.
OnlyTheHolderEndsATry ==
  [][\A r \in Requests :
       (status[r] = "open" /\ status'[r] = "out") =>
         \E a \in Agents : Holds(a, r) /\ by[r] = Handle(a) /\ agent'[a] = "idle"]_vars

\* Journey 7, judged rule 8: an agent whose lease ran out can neither end the try nor
\* release the request.
AStaleClaimEndsNothing ==
  [][\A a \in Agents :
       (agent[a] = "working" /\ mine[a] = "out") =>
         ~(AgentEndsTheTry(a) \/ AgentReleases(a))]_vars

\* Journey 4, judged rule 8: an agent that still holds a live lease is never told lost.
ALiveHolderIsNeverToldLost ==
  [][\A a \in Agents : HandleToldLost(a) => mine[a] = "out"]_vars

\* Journey 8, judged rule 8: a handle on a request that left the queue is told wrongState,
\* never lost.
AHandleOnARequestOutOfTheQueueIsToldWrongState ==
  [][\A a \in Agents : HandleToldLost(a) => status[claim[a]] = "open"]_vars

\* Objective, journey 1: an agent is given the first request in queue order that can be
\* taken.
TheOldestRequestIsTakenFirst ==
  [][\A a \in Agents :
       Taking(a) => \A d \in Requests : Older(d, claim'[a]) => ~Takeable(d)]_vars

\* Judged rule 11: next never gives a request that needs a person.
ARequestThatNeedsAPersonIsNeverGiven ==
  [][\A a \in Agents : Taking(a) => ~NeedsPerson(claim'[a])]_vars

\* Judged rule 1: a lost, wrongState or empty answer writes nothing.
ARefusalWritesNothing ==
  [][\A a \in Agents :
       (HandleToldWrongState(a) \/ HandleToldLost(a) \/ WaitEndsEmpty(a)) => UNCHANGED board]_vars

\* Journey 7, judged rule 8: an old handle, kept after the same agent claimed again, is
\* refused: it is not the live lease's handle, even on the same request by the same agent.
OldHandleIsRefused ==
  [][(old # NoRequest /\ old' = NoRequest) => Check(OldHandle, old) # "ok"]_vars

\* Journey 7, judged rule 8: a stale handle cannot extend; it is told lost, or wrongState
\* when the request left the queue.
AStaleHandleCannotExtend ==
  [][\A a \in Agents :
       (agent[a] = "working" /\ mine[a] = "out") => Check(Handle(a), claim[a]) # "ok"]_vars

\* Judged rules 7 and 11, success criterion 2, E4.3 P1: a request whose lease ran out is
\* taken again, or needs a person. It is never left behind while agents keep working, and it
\* never goes round the queue with no end.
ARequestWhoseLeaseRanOutIsTakenAgainOrNeedsAPerson ==
  \A r \in Requests :
    (status[r] = "open" /\ lease[r] = "out") ~> (Live(r) \/ NeedsPerson(r))

====
