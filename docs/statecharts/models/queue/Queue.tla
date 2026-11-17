---- MODULE Queue ----
\* SPEC-queue.md: the one comment queue, SQS style: a lease, release, attempts, stuck.
\* Two comments (1 is posted before 2), two agents A and B.
\* Time is not a number here. A lease is "live", then "out": that is claimedUntil
\* against the server's time. Tabs and agents read the same time (the board carries
\* the server's clock offset), so a lease runs out for all of them in one step.
\* `by` is the live lease's claim handle. A handle is a fresh value per claim (SQS's receipt
\* handle): <<agent, n>>, where agent A's n flips on each claim it makes while it holds a handle,
\* and starts again at 0 once it holds none. Agent A may run next
\* again while it still keeps the handle of a claim whose lease ran out (two shells, or a
\* retry), so it can hold an old handle and a new one on the same comment; the server must
\* refuse the old one. Agent B lets go of each handle before its next claim, so its n stays 0
\* (the model's size only). Nothing stored says "claimed" or "stuck": a tab derives them
\* (Shown) from claimedUntil and attempts.
\* Extend keeps a live lease live; time is not a number, so it moves nothing else here.
\*
\* StuckAfter is 3 in the spec. Both configs use 2, so the chart stays under the
\* 500-state budget; the rules do not depend on the number. With 3, TLC reaches
\* 1,051 states and every rule holds.
\*
\* ATOMIC = TRUE  (Queue.cfg): comment.next picks and writes its claim in one
\*                 conditional write (SPEC-queue.md, judged rule 6).
\* ATOMIC = FALSE (QueueTwoStep.cfg): it picks, awaits, then writes without looking
\*                 again. That config is EXPECTED to break: it shows why the claim is
\*                 one write.
EXTENDS Naturals, FiniteSets

CONSTANTS ATOMIC, StuckAfter

Agents == {"A", "B"}
Comments == {1, 2}
None == <<"-", 0>>  \* no handle
NoComment == 0

VARIABLES
  status,   \* status[c], stored: "unposted" | "open" | "done"
  by,       \* by[c]: the claim handle of the latest claim, while its lease is live
  lease,    \* lease[c]: claimedUntil against the clock: "none" | "live" | "out"
  attempts, \* attempts[c], stored: claims not given back
  ranOut,   \* ranOut[c]: claims whose lease ran out (the model's count, not stored)
  agent,    \* agent[a]: "idle" | "waiting" | "picked" | "working"
  claim,    \* claim[a]: the comment agent a has picked or holds a claim handle for
  mine,     \* mine[a]: agent a's own lease, by the `until` it was told: "none" | "live" | "out"
  ahead,    \* ahead: the comment first in queue order (a released comment goes to the back)
  gen,      \* gen: agent A's n for its latest handle (B's is always 0)
  old       \* old: the comment of the older handle agent A still keeps after it claimed again

vars == <<status, by, lease, attempts, ranOut, agent, claim, mine, ahead, gen, old>>
Handles == Agents \X {0, 1}
N(a) == IF a = "A" THEN gen ELSE 0
Handle(a) == <<a, N(a)>>
OldHandle == <<"A", 1 - gen>>
board == <<status, by, lease, attempts, ahead>>

Older(d, c) == d # c /\ d = ahead
Live(c) == lease[c] = "live"

\* What a tab shows, from the board and the clock alone.
Shown(c) ==
  IF status[c] = "done" THEN "done"
  ELSE IF Live(c) THEN "claimed"
  ELSE IF attempts[c] >= StuckAfter THEN "stuck"
  ELSE "open"

Stuck(c) == status[c] = "open" /\ Shown(c) = "stuck"
Takeable(c) == status[c] = "open" /\ ~Live(c) /\ attempts[c] < StuckAfter
Oldest(c) == Takeable(c) /\ \A d \in Comments : Older(d, c) => ~Takeable(d)
\* A comment still in the queue: posted, not done, not stuck. Queue order matters only
\* between two such comments, so the model sets `ahead` back to 1 when one leaves.
InPlay(c) == status[c] = "open" /\ (Live(c) \/ attempts[c] < StuckAfter)
NothingTakeable == \A c \in Comments : ~Takeable(c)

TypeOK ==
  /\ status \in [Comments -> {"unposted", "open", "done"}]
  /\ by \in [Comments -> Handles \cup {None}]
  /\ lease \in [Comments -> {"none", "live", "out"}]
  /\ attempts \in [Comments -> 0..StuckAfter]
  /\ ranOut \in [Comments -> 0..StuckAfter]
  /\ agent \in [Agents -> {"idle", "waiting", "picked", "working"}]
  /\ claim \in [Agents -> Comments \cup {NoComment}]
  /\ mine \in [Agents -> {"none", "live", "out"}]
  /\ ahead \in Comments
  /\ gen \in {0, 1}
  /\ old \in Comments \cup {NoComment}

Init ==
  /\ status = [c \in Comments |-> "unposted"]
  /\ by = [c \in Comments |-> None]
  /\ lease = [c \in Comments |-> "none"]
  /\ attempts = [c \in Comments |-> 0]
  /\ ranOut = [c \in Comments |-> 0]
  /\ agent = [a \in Agents |-> "idle"]
  /\ claim = [a \in Agents |-> NoComment]
  /\ mine = [a \in Agents |-> "none"]
  /\ ahead = 1
  /\ gen = 0
  /\ old = NoComment

\* Each agent that waits wakes and asks again: a comment may be takeable now.
Wake == [a \in Agents |-> IF agent[a] = "waiting" THEN "idle" ELSE agent[a]]

\* A viewer posts comment c (1 before 2). It is open, with no claim.
ViewerPosts(c) ==
  /\ status[c] = "unposted"
  /\ \A d \in Comments : d < c => status[d] # "unposted"
  /\ status' = [status EXCEPT ![c] = "open"]
  /\ agent' = Wake
  /\ UNCHANGED <<by, lease, attempts, ranOut, claim, mine, ahead, gen, old>>

\* An agent that may run easel next: it is idle, or it is agent A, whose own lease ran out,
\* with no older handle kept yet. A keeps the handle it had.
MayAskAgain(a) == a = "A" /\ agent[a] = "working" /\ mine[a] = "out" /\ old = NoComment
MayAsk(a) == agent[a] = "idle" \/ MayAskAgain(a)

\* The claim is written: a fresh handle, a live lease, one more attempt.
WriteClaim(a, c) ==
  /\ gen' = IF a = "A" THEN 1 - gen ELSE gen
  /\ by' = [by EXCEPT ![c] = <<a, IF a = "A" THEN 1 - gen ELSE 0>>]
  /\ lease' = [lease EXCEPT ![c] = "live"]
  /\ attempts' = [attempts EXCEPT ![c] = @ + 1]
  /\ agent' = [agent EXCEPT ![a] = "working"]
  /\ claim' = [claim EXCEPT ![a] = c]
  /\ mine' = [mine EXCEPT ![a] = "live"]
  /\ old' = IF agent[a] = "working" THEN claim[a] ELSE old
  /\ UNCHANGED <<status, ranOut, ahead>>

\* easel next, one conditional write.
AgentTakes(a) ==
  /\ ATOMIC
  /\ MayAsk(a)
  /\ \E c \in Comments :
       /\ Oldest(c)
       \* the model's size: A asks again only to get comment 2 again, the one the chart follows
       /\ agent[a] = "working" => c = claim[a] /\ c = 2
       /\ WriteClaim(a, c)

\* What-if, step 1: it finds the oldest it can take ...
AgentPicks(a) ==
  /\ ~ATOMIC
  /\ agent[a] = "idle"
  /\ \E c \in Comments :
       /\ Oldest(c)
       /\ agent' = [agent EXCEPT ![a] = "picked"]
       /\ claim' = [claim EXCEPT ![a] = c]
  /\ UNCHANGED <<status, by, lease, attempts, ranOut, mine, ahead, gen, old>>

\* ... step 2: after the await, it writes its claim without looking again.
AgentWritesPick(a) ==
  /\ agent[a] = "picked"
  /\ WriteClaim(a, claim[a])

\* A call of easel next finds nothing to take: it waits (at most 50 s), holding no lock.
AgentWaits(a) ==
  /\ agent[a] = "idle"
  /\ NothingTakeable
  /\ agent' = [agent EXCEPT ![a] = "waiting"]
  /\ UNCHANGED <<status, by, lease, attempts, ranOut, claim, mine, ahead, gen, old>>

\* The wait ends with nothing to take: the call answers empty (the CLI may call again).
WaitEndsEmpty(a) ==
  /\ agent[a] = "waiting"
  /\ NothingTakeable
  /\ agent' = [agent EXCEPT ![a] = "idle"]
  /\ UNCHANGED <<status, by, lease, attempts, ranOut, claim, mine, ahead, gen, old>>

\* claimedUntil passes. Nothing is written (judged rule 7). Each agent told that `until`
\* sees its own lease run out. A waiting next wakes at that time, unless the comment is
\* now stuck (the wait's deadline is the earliest claimedUntil in its scope).
LeaseRunsOut(c) ==
  /\ status[c] = "open" /\ lease[c] = "live"
  /\ c # old  \* the model's size: A uses its kept handle before its new lease runs out
  /\ lease' = [lease EXCEPT ![c] = "out"]
  /\ by' = [by EXCEPT ![c] = None]
  /\ ranOut' = [ranOut EXCEPT ![c] = @ + 1]
  /\ mine' = [a \in Agents |-> IF claim[a] = c /\ mine[a] = "live" THEN "out" ELSE mine[a]]
  /\ agent' = IF attempts[c] < StuckAfter THEN Wake ELSE agent
  /\ ahead' = IF attempts[c] < StuckAfter THEN ahead ELSE 1
  /\ UNCHANGED <<status, attempts, claim, gen, old>>

\* The server's checks on a claim handle h for comment c, in order (judged rule 8): done, then
\* the live lease's handle, else lost.
Check(h, c) ==
  CASE status[c] = "done"       -> "done"
    [] by[c] = h /\ Live(c)     -> "ok"
    [] OTHER                    -> "lost"
LiveHandle(a, c) == Check(Handle(a), c) = "ok"

\* The agent lets go of its handle. Agent A first uses or drops the older handle it kept
\* (AgentUsesTheOldHandle), and its next claim starts again at n = 0.
LetsGo(a) ==
  /\ a = "A" => old = NoComment
  /\ gen' = IF a = "A" THEN 0 ELSE gen
  /\ agent' = [agent EXCEPT ![a] = "idle"]
  /\ claim' = [claim EXCEPT ![a] = NoComment]
  /\ mine' = [mine EXCEPT ![a] = "none"]

\* easel resolve <claim> --reply: the holder of the live lease marks it done.
AgentResolves(a) ==
  /\ agent[a] = "working"
  /\ LiveHandle(a, claim[a])
  /\ status' = [status EXCEPT ![claim[a]] = "done"]
  /\ by' = [by EXCEPT ![claim[a]] = None]
  /\ lease' = [lease EXCEPT ![claim[a]] = "none"]
  /\ ahead' = 1
  /\ LetsGo(a)
  /\ UNCHANGED <<attempts, ranOut, old>>

\* easel release <claim>: the holder gives it back; the claim does not count. It goes to the
\* back of the queue, behind every comment posted so far.
AgentReleases(a) ==
  /\ agent[a] = "working"
  /\ LiveHandle(a, claim[a])
  /\ by' = [by EXCEPT ![claim[a]] = None]
  /\ lease' = [lease EXCEPT ![claim[a]] = "none"]
  /\ attempts' = [attempts EXCEPT ![claim[a]] = @ - 1]
  /\ agent' = [b \in Agents |->
                 IF b = a THEN "idle" ELSE IF agent[b] = "waiting" THEN "idle" ELSE agent[b]]
  /\ claim' = [claim EXCEPT ![a] = NoComment]
  /\ mine' = [mine EXCEPT ![a] = "none"]
  /\ a = "A" => old = NoComment
  /\ gen' = IF a = "A" THEN 0 ELSE gen
  /\ ahead' = IF InPlay(3 - claim[a]) THEN 3 - claim[a] ELSE 1
  /\ UNCHANGED <<status, ranOut, old>>

\* easel extend <claim>: the holder's lease starts again. It stays live; time is not a number.
AgentExtends(a) ==
  /\ agent[a] = "working"
  /\ LiveHandle(a, claim[a])
  /\ UNCHANGED vars

\* Resolve, extend or release on a comment that is done answers done, and writes nothing.
\* Done is checked before the handle (SPEC-queue.md, judged rule 8).
HandleToldDone(a) ==
  /\ agent[a] = "working"
  /\ Check(Handle(a), claim[a]) = "done"
  /\ LetsGo(a)
  /\ UNCHANGED <<board, ranOut, old>>

\* Resolve, extend or release with a handle that is not the live one answers lost.
HandleToldLost(a) ==
  /\ agent[a] = "working"
  /\ Check(Handle(a), claim[a]) = "lost"
  /\ LetsGo(a)
  /\ UNCHANGED <<board, ranOut, old>>

\* Agent A resolves, extends or releases with the older handle it kept, after it claimed
\* again. The server checks that handle; the answer (done or lost) writes nothing, and A
\* drops it. (OldHandleIsRefused says the check never answers ok.)
AgentUsesTheOldHandle ==
  /\ old # NoComment /\ agent["A"] = "working"
  /\ old' = NoComment
  /\ UNCHANGED <<status, by, lease, attempts, ranOut, agent, claim, mine, ahead, gen>>

AgentStep(a) ==
  \/ AgentTakes(a) \/ AgentPicks(a) \/ AgentWritesPick(a)
  \/ AgentWaits(a) \/ WaitEndsEmpty(a)
  \/ AgentResolves(a) \/ HandleToldDone(a) \/ HandleToldLost(a)

Next ==
  \/ \E c \in Comments : ViewerPosts(c) \/ LeaseRunsOut(c)
  \/ \E a \in Agents : AgentStep(a) \/ AgentReleases(a) \/ AgentExtends(a)
  \/ AgentUsesTheOldHandle

\* Agents keep working the queue, and time passes. Viewers need not post; an agent need
\* not extend, release or resolve before its lease runs out.
Fairness ==
  /\ \A a \in Agents : WF_vars(AgentStep(a))
  /\ WF_vars(AgentUsesTheOldHandle)
  /\ \A c \in Comments : WF_vars(LeaseRunsOut(c))

Spec == Init /\ [][Next]_vars /\ Fairness

----
\* Rules, in the reader's words.

Holds(a, c) == agent[a] = "working" /\ claim[a] = c /\ mine[a] = "live"
Taking(a) == agent[a] # "working" /\ agent'[a] = "working"

\* Judged rule 6, journey 9: a comment is held by at most one agent at a time.
ACommentIsHeldByAtMostOneAgent ==
  \A c \in Comments : Cardinality({a \in Agents : Holds(a, c)}) <= 1

\* Judged rule 5: a comment no agent has claimed has no claim.
AnUnclaimedCommentHasNoClaim ==
  \A c \in Comments : (status[c] = "open" /\ attempts[c] = 0) => by[c] = None /\ lease[c] = "none"

\* Judged rule 7, the state table, SPEC-viewer.md "Follow the queue": a tab shows a
\* comment claimed exactly while its lease is live.
ATabShowsClaimedOnlyWhileTheLeaseIsLive ==
  \A c \in Comments : status[c] = "open" => (Shown(c) = "claimed" <=> Live(c))

\* Judged rule 9, journey 2: an agent that waits for work is woken as soon as a comment
\* can be taken.
AWaitingAgentIsWokenWhenACommentCanBeTaken ==
  \A a \in Agents : agent[a] = "waiting" => NothingTakeable

\* Judged rule 10: attempts counts each claim that ran out, plus the live one; a released
\* claim does not count.
AttemptsCountClaimsThatRanOut ==
  \A c \in Comments :
    status[c] = "open" => attempts[c] = ranOut[c] + (IF Live(c) THEN 1 ELSE 0)

\* Judged rule 10: a comment shows stuck once StuckAfter of its claims ran out, and only then.
ACommentIsStuckOnlyOnceItsClaimsRanOut ==
  \A c \in Comments :
    status[c] = "open" => (Stuck(c) <=> (ranOut[c] >= StuckAfter /\ ~Live(c)))

\* Judged rule 8: only the holder of the live lease can mark a comment done.
OnlyTheHolderCanFinishIt ==
  [][\A c \in Comments :
       (status[c] # "done" /\ status'[c] = "done") =>
         \E a \in Agents : Holds(a, c) /\ by[c] = Handle(a) /\ agent'[a] = "idle"]_vars

\* Journey 7, judged rule 8: an agent whose lease ran out can neither finish nor
\* release the comment.
AStaleClaimFinishesNothing ==
  [][\A a \in Agents :
       (agent[a] = "working" /\ mine[a] = "out") =>
         ~(AgentResolves(a) \/ AgentReleases(a))]_vars

\* Journey 4, judged rule 8: an agent that still holds a live lease is never told lost.
ALiveHolderIsNeverToldLost ==
  [][\A a \in Agents : HandleToldLost(a) => mine[a] = "out"]_vars

\* Journey 8, judged rule 8: a handle on a comment that is done is told done, never lost.
AHandleOnADoneCommentIsToldDone ==
  [][\A a \in Agents : HandleToldLost(a) => status[claim[a]] # "done"]_vars

\* Objective, journey 1, judged rule 11: an agent is given the first comment in queue
\* order that can be taken.
TheOldestCommentIsTakenFirst ==
  [][\A a \in Agents :
       Taking(a) => \A d \in Comments : Older(d, claim'[a]) => ~Takeable(d)]_vars

\* Judged rule 10: next never gives a stuck comment.
AStuckCommentIsNeverGiven ==
  [][\A a \in Agents : Taking(a) => ~Stuck(claim'[a])]_vars

\* Judged rule 1: a lost, done or empty answer writes nothing.
ARefusalWritesNothing ==
  [][\A a \in Agents :
       (HandleToldDone(a) \/ HandleToldLost(a) \/ WaitEndsEmpty(a)) => UNCHANGED board]_vars

\* Journey 7, judged rule 8: an old handle, kept after the same agent claimed again, is
\* refused: it is not the live lease's handle, even on the same comment by the same agent.
OldHandleIsRefused ==
  [][(old # NoComment /\ old' = NoComment) => Check(OldHandle, old) # "ok"]_vars

\* Journey 7, judged rule 8: a stale handle cannot extend; it is told lost.
AStaleHandleCannotExtend ==
  [][\A a \in Agents :
       (agent[a] = "working" /\ mine[a] = "out" /\ status[claim[a]] # "done") =>
         Check(Handle(a), claim[a]) = "lost"]_vars

\* Journey 8, judged rule 8: extend (as resolve and release) on a done comment answers done.
ExtendOnADoneCommentAnswersDone ==
  [][\A a \in Agents :
       (agent[a] = "working" /\ status[claim[a]] = "done") =>
         Check(Handle(a), claim[a]) = "done"]_vars

\* Journey 8: a done comment stays done.
ADoneCommentStaysDone ==
  [][\A c \in Comments : status[c] = "done" => status'[c] = "done"]_vars

\* Judged rules 7, 10 and 11, success criterion 2: a comment whose lease ran out is
\* taken again, or becomes stuck. (Without stuck, agents that keep letting comment 1 run
\* out starve comment 2; without "a release goes to the back", agents that keep
\* releasing comment 1 starve it too.)
ACommentWhoseLeaseRanOutIsTakenAgainOrBecomesStuck ==
  \A c \in Comments :
    (status[c] = "open" /\ lease[c] = "out") ~> (Live(c) \/ Stuck(c))

====
