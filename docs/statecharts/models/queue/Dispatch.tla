---- MODULE Dispatch ----
\* SPEC-queue.md § The dispatcher: how a waiting request gets to the agents of a team.
\* One request. Two ways to get it to an agent, both on, as in E4.5 D8:
\*   - pull: an agent that asks for work (`easel next`). It needs no delivery.
\*   - GitHub: the dispatcher delivers the request to an issue in the repository of the team.
\*     A GitHub run starts from the issue, and asks for this request only (`easel next --n`).
\* The claim is the one conditional write of Queue.tla. This model takes it as given, and checks
\* what the dispatcher adds: a delivery only tells; the claim decides who works.
\*
\* A waiting period is one time that the request is waiting: from the post, or from the end of a try
\* with no outcome, to the next claim. Its number is `tries` (no edit, answer or reopen here).
\* The dispatcher delivers at most once for each waiting period. A failed delivery is tried again, up to
\* Attempts times in that period. The cap of tries ends the periods, so it ends the deliveries too.
\*
\* NeedsPersonAfter is 3 in the spec, Attempts is 3. The config uses 2 and 2, so the chart stays
\* small; the rules do not depend on the numbers.
EXTENDS Naturals

CONSTANTS NeedsPersonAfter, Attempts

Waits == 0..(NeedsPersonAfter - 1)

VARIABLES
  req,      \* "unposted" | "waiting" | "inWork" | "out" | "person"
  tries,    \* claims so far
  holder,   \* who holds the live claim: "none" | "pull" | "github"
  sent,     \* sent[w]: deliveries that GitHub took, in waiting period w
  failed,   \* deliveries that failed in this waiting period
  run,      \* the GitHub run: "none" | "started" | "working" | "ended"
  issue,    \* the GitHub issue of the request: "none" | "open" | "closed"
  outcomes  \* outcomes so far (a result, a question or a decline)

vars == <<req, tries, holder, sent, failed, run, issue, outcomes>>

Init ==
  /\ req = "unposted"
  /\ tries = 0
  /\ holder = "none"
  /\ sent = [w \in Waits |-> 0]
  /\ failed = 0
  /\ run = "none"
  /\ issue = "none"
  /\ outcomes = 0

Due == req = "waiting" /\ sent[tries] = 0 /\ failed < Attempts

ViewerPosts ==
  /\ req = "unposted"
  /\ req' = "waiting"
  /\ UNCHANGED <<tries, holder, sent, failed, run, issue, outcomes>>

\* The dispatcher delivers: it opens the issue, or writes on it again. GitHub starts a run.
\* Two runs that ask for the same request act as one here: the claim lets only one take it.
Deliver ==
  /\ Due
  /\ sent' = [sent EXCEPT ![tries] = @ + 1]
  /\ issue' = "open"
  /\ run' = "started"
  /\ UNCHANGED <<req, tries, holder, failed, outcomes>>

\* GitHub refuses or does not answer. The dispatcher keeps the cause, and tries again later.
DeliveryFails ==
  /\ Due
  /\ failed' = failed + 1
  /\ UNCHANGED <<req, tries, holder, sent, run, issue, outcomes>>

Take(who) ==
  /\ req = "waiting"
  /\ req' = "inWork"
  /\ holder' = who
  /\ tries' = tries + 1
  /\ failed' = 0

PullAgentTakes ==
  /\ Take("pull")
  /\ UNCHANGED <<sent, run, issue, outcomes>>

GitHubRunTakes ==
  /\ run = "started"
  /\ Take("github")
  /\ run' = "working"
  /\ UNCHANGED <<sent, issue, outcomes>>

\* The run asks for its request, but another agent has it, or it left the queue: `empty`.
GitHubRunToldEmpty ==
  /\ run = "started"
  /\ req # "waiting"
  /\ run' = "ended"
  /\ UNCHANGED <<req, tries, holder, sent, failed, issue, outcomes>>

RunEndsWith(who) == IF who = "github" THEN "ended" ELSE run

HolderEndsTheTry ==
  /\ req = "inWork"
  /\ req' = "out"
  /\ outcomes' = outcomes + 1
  /\ holder' = "none"
  /\ run' = RunEndsWith(holder)
  /\ UNCHANGED <<tries, sent, failed, issue>>

\* A release, or a lease that runs out.
TryEndsWithNoOutcome ==
  /\ req = "inWork"
  /\ req' = IF tries < NeedsPersonAfter THEN "waiting" ELSE "person"
  /\ holder' = "none"
  /\ run' = RunEndsWith(holder)
  /\ UNCHANGED <<tries, sent, failed, issue, outcomes>>

\* The dispatcher makes the issue follow its request: closed when the request is out.
IssueFollows ==
  /\ issue = "open"
  /\ req = "out"
  /\ issue' = "closed"
  /\ UNCHANGED <<req, tries, holder, sent, failed, run, outcomes>>

\* Nothing is left to do: the request is out or needs a person.
Rest ==
  /\ req \in {"out", "person"}
  /\ UNCHANGED vars

Next ==
  \/ ViewerPosts \/ Deliver \/ DeliveryFails
  \/ PullAgentTakes \/ GitHubRunTakes \/ GitHubRunToldEmpty
  \/ HolderEndsTheTry \/ TryEndsWithNoOutcome \/ IssueFollows \/ Rest

\* The dispatcher, GitHub and the run keep going. No agent is made to take or end a try.
Fairness ==
  /\ WF_vars(Deliver)
  /\ WF_vars(GitHubRunTakes)
  /\ WF_vars(GitHubRunToldEmpty)
  /\ WF_vars(IssueFollows)

Spec == Init /\ [][Next]_vars /\ Fairness

----
\* Rules, in the reader's words.

TypeOK ==
  /\ req \in {"unposted", "waiting", "inWork", "out", "person"}
  /\ tries \in 0..NeedsPersonAfter
  /\ holder \in {"none", "pull", "github"}
  /\ sent \in [Waits -> 0..2]
  /\ failed \in 0..Attempts
  /\ run \in {"none", "started", "working", "ended"}
  /\ issue \in {"none", "open", "closed"}
  /\ outcomes \in 0..2

\* E4.5 D8: with two ways on, one agent holds the request, and the GitHub run works only when
\* it holds it.
ARequestIsHeldByAtMostOneAgent ==
  /\ (req = "inWork") <=> (holder # "none")
  /\ (run = "working") <=> (holder = "github")

\* E4.5 D8: each request is done one time only.
ARequestHasAtMostOneOutcome == outcomes <= 1

\* Judged rule 20: at most one delivery for each waiting period.
AtMostOneDeliveryForEachPeriod == \A w \in Waits : sent[w] <= 1

\* Judged rule 20: a failed delivery is tried again only up to Attempts times in one waiting period.
FailedDeliveriesStopAtTheCap == failed <= Attempts

\* Judged rule 19: a delivery changes no request. Only a claim does.
ADeliveryChangesNoRequest ==
  [][(Deliver \/ DeliveryFails) => UNCHANGED <<req, tries, holder, outcomes>>]_vars

\* Judged rule 20: only a waiting request is delivered. A request in work, out of the queue, or
\* that needs a person is not.
OnlyAWaitingRequestIsDelivered ==
  [][(sent' # sent \/ failed' > failed) => req = "waiting"]_vars

\* Judged rule 21: a GitHub run that finds its request taken or gone ends, and changes nothing.
ARunThatFindsNoRequestChangesNothing ==
  [][(run = "started" /\ run' = "ended") => UNCHANGED <<req, tries, holder, outcomes>>]_vars

\* E4.5 D6: a waiting request gets a delivery, or an agent, or a recorded failure.
AWaitingRequestIsDeliveredOrTaken ==
  [](req = "waiting" =>
       <>(req # "waiting" \/ sent[tries] = 1 \/ failed = Attempts))

\* E4.5 D10: when the request ends, its issue shows it.
TheIssueClosesWhenTheRequestIsOut == [](req = "out" => <>(issue # "open"))

\* Each GitHub run ends, or works on the request.
AStartedRunIsNotLeftHanging == [](run = "started" => <>(run # "started"))
====
