---- MODULE Starts ----
\* SPEC-starts.md: only the person starts the work of an agent (E4.5 D11), the starts stay
\* inside the limits that the person sets (D12), and a request that waits shows why (D13).
\*
\* One request, the dispatcher of easel, a starter on a NATS channel (the Paseo adapter), and
\* the agent that the starter starts for the request. The request comes from the person (an
\* owner), or from a viewer with a share link.
\*
\* The limits are numbers in the spec (2 agents at the same time, 20 starts in a UTC day). Here
\* they are one flag, `full`: the starter is at a limit. Other agents start and end, a day ends,
\* and the person changes a limit; each of these can set or clear the flag.
\*
\* Agreement = TRUE is the new rule. With Agreement = FALSE, the dispatcher publishes each
\* waiting request and an agent claims it with no agreement, as before this spec, and the
\* second config shows what breaks.
EXTENDS Naturals

CONSTANT Agreement

VARIABLES
  st,      \* the request: "none" | "waiting" | "inWork" | "out"
  by,      \* who made the waiting period: "none" | "person" | "viewer"
  agreed,  \* the person agreed to the request as it is now
  pub,     \* the delivery of this waiting period: "no" | "sent" | "refused"
  agent,   \* the agent of the request: "none" | "running" | "ended"
  failed,  \* the last start of this waiting period failed
  hold,    \* the cause that easel shows: "none" | "agreement" | "limit" | "failed" | "refused"
  full,    \* the starter is at a limit
  stale    \* a message of an earlier waiting period is still in the stream

vars == <<st, by, agreed, pub, agent, failed, hold, full, stale>>

Agrees(who) == who = "person"

HoldOfAWrite(who) == IF Agrees(who) THEN "none" ELSE "agreement"

MayGo == agreed \/ ~Agreement

Init ==
  /\ st = "none"
  /\ by = "none"
  /\ agreed = FALSE
  /\ pub = "no"
  /\ agent = "none"
  /\ failed = FALSE
  /\ hold = "none"
  /\ full = FALSE
  /\ stale = FALSE

Post(who) ==
  /\ st = "none"
  /\ st' = "waiting"
  /\ by' = who
  /\ agreed' = Agrees(who)
  /\ hold' = HoldOfAWrite(who)
  /\ UNCHANGED <<pub, agent, failed, full, stale>>

\* An edit, an answer, a note or a reopen: a new waiting period. A write of a viewer ends the
\* agreement; a write of the person is an agreement.
Write(who) ==
  /\ st = "waiting"
  /\ by' = who
  /\ agreed' = Agrees(who)
  /\ pub' = "no"
  /\ failed' = FALSE
  /\ hold' = HoldOfAWrite(who)
  /\ stale' = (stale \/ (pub = "sent" /\ agent # "running"))
  /\ UNCHANGED <<st, agent, full>>

PersonAgrees ==
  /\ st = "waiting"
  /\ ~agreed
  /\ agreed' = TRUE
  /\ hold' = "none"
  /\ UNCHANGED <<st, by, pub, agent, failed, full, stale>>

Publish ==
  /\ st = "waiting"
  /\ pub = "no"
  /\ MayGo
  /\ pub' = "sent"
  /\ UNCHANGED <<st, by, agreed, agent, failed, hold, full, stale>>

\* NATS refuses the publish 3 times: the delivery is failed with its cause.
Refused ==
  /\ st = "waiting"
  /\ pub = "no"
  /\ MayGo
  /\ pub' = "refused"
  /\ hold' = "refused"
  /\ UNCHANGED <<st, by, agreed, agent, failed, full, stale>>

CanStart == st = "waiting" /\ pub = "sent" /\ agent # "running" /\ ~full

\* The starter fetches the message, starts the agent and reports the start to easel.
Start ==
  /\ CanStart
  /\ agent' = "running"
  /\ failed' = FALSE
  /\ hold' = "none"
  /\ \E f \in BOOLEAN : full' = f
  /\ UNCHANGED <<st, by, agreed, pub, stale>>

\* The starter fetches the message of an earlier waiting period, and starts an agent for it.
\* The agent claims the request as it is now, so only an agreement of now lets it work.
StartFromAnOldMessage ==
  /\ stale
  /\ agent # "running"
  /\ ~full
  /\ agent' = "running"
  /\ stale' = FALSE
  /\ hold' = IF hold = "limit" THEN "none" ELSE hold
  /\ \E f \in BOOLEAN : full' = f
  /\ UNCHANGED <<st, by, agreed, pub, failed>>

\* `paseo run` fails: the starter reports the cause, and fetches the message again later.
StartFails ==
  /\ CanStart
  /\ failed' = TRUE
  /\ hold' = "failed"
  /\ UNCHANGED <<st, by, agreed, pub, agent, full, stale>>

\* Other agents start, or the person lowers a limit, or the starts of the day reach it.
StarterFillsUp ==
  /\ ~full
  /\ full' = TRUE
  /\ UNCHANGED <<st, by, agreed, pub, agent, failed, hold, stale>>

\* An agent ends, a new UTC day starts, or the person raises a limit.
StarterFrees ==
  /\ full
  /\ full' = FALSE
  /\ UNCHANGED <<st, by, agreed, pub, agent, failed, hold, stale>>

LimitHold == IF full THEN "limit" ELSE "none"

\* Each round, easel shows the report of the starter on a request that it holds for a limit.
EaselShowsTheLimit ==
  /\ st = "waiting"
  /\ pub = "sent"
  /\ agent # "running"
  /\ hold \in {"none", "limit"}
  /\ hold # LimitHold
  /\ hold' = LimitHold
  /\ UNCHANGED <<st, by, agreed, pub, agent, failed, full, stale>>

Claim ==
  /\ agent = "running"
  /\ st = "waiting"
  /\ MayGo
  /\ st' = "inWork"
  /\ UNCHANGED <<by, agreed, pub, agent, failed, hold, full, stale>>

\* `easel next --n` answers `empty`: the request is not waiting, or not agreed.
ToldEmpty ==
  /\ agent = "running"
  /\ \/ st = "out"
     \/ st = "waiting" /\ ~MayGo
  /\ agent' = "ended"
  /\ UNCHANGED <<st, by, agreed, pub, failed, hold, full, stale>>

Outcome ==
  /\ st = "inWork"
  /\ st' = "out"
  /\ agent' = "ended"
  /\ UNCHANGED <<by, agreed, pub, failed, hold, full, stale>>

\* A release, or a lease that runs out: a new waiting period, with the same agreement.
Release ==
  /\ st = "inWork"
  /\ st' = "waiting"
  /\ agent' = "ended"
  /\ pub' = "no"
  /\ hold' = "none"
  /\ UNCHANGED <<by, agreed, failed, full, stale>>

Next ==
  \/ \E who \in {"person", "viewer"} : Post(who) \/ Write(who)
  \/ PersonAgrees \/ Publish \/ Refused
  \/ Start \/ StartFromAnOldMessage \/ StartFails \/ StarterFillsUp \/ StarterFrees \/ EaselShowsTheLimit
  \/ Claim \/ ToldEmpty \/ Outcome \/ Release

Fairness ==
  /\ WF_vars(Publish \/ Refused)
  /\ SF_vars(Start \/ StartFails)
  /\ SF_vars(StartFromAnOldMessage)
  /\ SF_vars(EaselShowsTheLimit)
  /\ WF_vars(Claim)
  /\ WF_vars(ToldEmpty)

Spec == Init /\ [][Next]_vars /\ Fairness

----
\* Rules, in the reader's words.

TypeOK ==
  /\ st \in {"none", "waiting", "inWork", "out"}
  /\ by \in {"none", "person", "viewer"}
  /\ agreed \in BOOLEAN
  /\ pub \in {"no", "sent", "refused"}
  /\ agent \in {"none", "running", "ended"}
  /\ failed \in BOOLEAN
  /\ hold \in {"none", "agreement", "limit", "failed", "refused"}
  /\ full \in BOOLEAN
  /\ stale \in BOOLEAN

\* D11: an agent works on a request only when the person agreed to it as it is now.
AnAgentWorksOnlyOnAnAgreedRequest == st = "inWork" => agreed

\* D11: a request of the person needs no other step.
ARequestOfThePersonIsAgreed == by = "person" => agreed

\* D11, D13: a request that waits for the person shows it.
ARequestThatWaitsForThePersonSaysSo == (st = "waiting" /\ ~agreed) => hold = "agreement"

\* D13: a cause that easel shows is true.
AShownFailureIsTrue == hold = "failed" => failed
AShownRefusalIsTrue == hold = "refused" => pub = "refused"

\* D11: the dispatcher publishes only a request that the person agreed to.
OnlyAnAgreedRequestIsPublished ==
  [][(pub = "no" /\ pub' = "sent") => agreed]_vars

\* D12: no agent starts while the starter is at a limit.
NoStartOverALimit ==
  [][(agent # "running" /\ agent' = "running") => ~full]_vars

\* D12: easel shows the limit only when the starter is at it, or was at its last report.
AShownLimitIsTrue == [](hold = "limit" => (full \/ ENABLED EaselShowsTheLimit))

\* D11: an agreed request goes to the starter with no other step.
AnAgreedRequestIsPublished ==
  [](st = "waiting" /\ agreed /\ pub = "no" => <>(pub # "no" \/ st # "waiting" \/ ~agreed))

\* D13: a request that waits with no agent gets an agent, or shows the cause.
AWaitingRequestStartsOrShowsWhy ==
  [](st = "waiting" /\ agent # "running" =>
       <>(st # "waiting" \/ agent = "running" \/ hold # "none"))

\* An agent that cannot claim its request ends.
AnAgentThatCannotWorkEnds ==
  [](agent = "running" /\ st = "out" => <>(agent # "running"))
====
