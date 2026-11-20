# queue: the dispatcher

The chart shows how a waiting request gets to an agent when two ways are on: an agent that asks
for work (pull), and a GitHub channel. The dispatcher delivers the request to GitHub one time for
each waiting period. GitHub starts a run, and the run asks for this request only. An agent that asks can take
the request first; then the run is told `empty`. A delivery only tells: the claim decides who
works, so the request has one outcome. A delivery that fails is tried again, then marked failed
with its cause, and the request still waits for an agent that asks. The issue closes when the
request leaves the queue.

The model is [models/queue/Dispatch.tla](models/queue/Dispatch.tla) with
[Dispatch.cfg](models/queue/Dispatch.cfg). The claim itself is the one conditional write of
[queue-lease](queue-lease.md); this model takes it as given. TLC checks every rule below on all 58
states of this model, and each one holds.

```mermaid
---
title: "queue: the dispatcher gets a request to an agent (pull and GitHub both on)"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: waiting
    lg1: inWork
    lg2: person
    lg3: out
  }
  class lg0 blue
  class lg1 yellow
  class lg2 orange
  class lg3 teal
  s0: Not posted
  s1: Waiting
  s2: Waiting, a delivery failed, tried again
  s3: Waiting, delivered, a GitHub run starts, issue open
  s4: In work by an agent that asked
  s5: In work by the GitHub run, issue open
  s6: Waiting again
  s7: Waiting, delivery failed
  s8: In work by an agent that asked, a GitHub run starts, issue open
  s9: Out of the queue
  s10: Waiting again, a delivery failed, tried again
  s11: Waiting again, delivered, a GitHub run starts, issue open
  s12: Waiting again, issue open
  s13: Waiting again, a GitHub run starts, issue open
  s14: In work by an agent that asked, issue open
  s15: Out of the queue, issue open
  s16: Out of the queue, a GitHub run starts, issue open
  s17: Needs a person
  s18: Waiting again, delivery failed
  s19: Waiting again, a delivery failed, tried again, issue open
  s20: Waiting again, a delivery failed, tried again, a GitHub run starts, issue open
  s21: Out of the queue, issue closed
  s22: Out of the queue, a GitHub run starts, issue closed
  s23: Needs a person, issue open
  s24: Needs a person, a GitHub run starts, issue open
  s25: Waiting again, delivery failed, issue open
  s26: Waiting again, delivery failed, a GitHub run starts, issue open
  [*] --> s0
  s0 --> s1: a viewer posts it
  s1 --> s2: the delivery fails#59; the cause is kept
  s1 --> s3: the dispatcher delivers it to GitHub
  s1 --> s4: an agent that asks takes it
  s2 --> s4: an agent that asks takes it
  s2 --> s7: the delivery fails#59; the cause is kept
  s2 --> s3: the dispatcher delivers it to GitHub
  s3 --> s5: the GitHub run takes it
  s3 --> s8: an agent that asks takes it
  s4 --> s6: a release, or the lease runs out
  s4 --> s9: the holder resolves, asks or declines
  s5 --> s12: a release, or the lease runs out
  s5 --> s15: the holder resolves, asks or declines
  s6 --> s10: the delivery fails#59; the cause is kept
  s6 --> s11: the dispatcher delivers it to GitHub
  s6 --> s4: an agent that asks takes it
  s7 --> s4: an agent that asks takes it
  s8 --> s13: a release, or the lease runs out
  s8 --> s14: the GitHub run is told empty
  s8 --> s16: the holder resolves, asks or declines
  s10 --> s4: an agent that asks takes it
  s10 --> s18: the delivery fails#59; the cause is kept
  s10 --> s11: the dispatcher delivers it to GitHub
  s11 --> s5: the GitHub run takes it
  s11 --> s8: an agent that asks takes it
  s12 --> s19: the delivery fails#59; the cause is kept
  s12 --> s11: the dispatcher delivers it to GitHub
  s12 --> s14: an agent that asks takes it
  s13 --> s5: the GitHub run takes it
  s13 --> s20: the delivery fails#59; the cause is kept
  s13 --> s11: the dispatcher delivers it to GitHub
  s13 --> s8: an agent that asks takes it
  s4 --> s17: a release, or the lease runs out
  s14 --> s12: a release, or the lease runs out
  s14 --> s15: the holder resolves, asks or declines
  s15 --> s21: the issue closes
  s16 --> s15: the GitHub run is told empty
  s16 --> s22: the issue closes
  s5 --> s23: a release, or the lease runs out
  s18 --> s4: an agent that asks takes it
  s19 --> s14: an agent that asks takes it
  s19 --> s25: the delivery fails#59; the cause is kept
  s19 --> s11: the dispatcher delivers it to GitHub
  s20 --> s5: the GitHub run takes it
  s20 --> s8: an agent that asks takes it
  s20 --> s26: the delivery fails#59; the cause is kept
  s20 --> s11: the dispatcher delivers it to GitHub
  s8 --> s24: a release, or the lease runs out
  s14 --> s23: a release, or the lease runs out
  s22 --> s21: the GitHub run is told empty
  s24 --> s23: the GitHub run is told empty
  s25 --> s14: an agent that asks takes it
  s26 --> s5: the GitHub run takes it
  s26 --> s8: an agent that asks takes it
  class s0 blue
  class s1 blue
  class s2 blue
  class s3 blue
  class s4 yellow
  class s5 yellow
  class s6 blue
  class s7 blue
  class s8 yellow
  class s9 teal
  class s10 blue
  class s11 blue
  class s12 blue
  class s13 blue
  class s14 yellow
  class s15 teal
  class s16 teal
  class s17 orange
  class s18 blue
  class s19 blue
  class s20 blue
  class s21 teal
  class s22 teal
  class s23 orange
  class s24 orange
  class s25 blue
  class s26 blue
```

## Rules

| Rule                                   | In plain words                                                                                  | Spec line                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `TypeOK`                               | Each value is one that the tables can hold.                                                     | SPEC-queue.md § Contract                                   |
| `ARequestIsHeldByAtMostOneAgent`       | With two ways on, one agent holds the request. The GitHub run works only while it holds it.     | SPEC-queue.md, judged rules 19, 21; E4.5 D8                |
| `ARequestHasAtMostOneOutcome`          | The request is done one time only.                                                              | SPEC-queue.md, judged rule 19; E4.5 D8                     |
| `AtMostOneDeliveryForEachPeriod`       | The dispatcher delivers at most one time for each waiting period.                               | SPEC-queue.md § The dispatcher, step 2; judged rule 20     |
| `FailedDeliveriesStopAtTheCap`         | A delivery that fails is tried again only up to the cap, then it is failed.                     | SPEC-queue.md § The dispatcher, step 5; judged rule 20     |
| `NoDeadlock`                           | There is always a next step.                                                                    | (model)                                                    |
| `ADeliveryChangesNoRequest`            | A delivery, sent or failed, changes nothing on the request. Only a claim does.                  | SPEC-queue.md, judged rule 19                              |
| `OnlyAWaitingRequestIsDelivered`       | A request in work, out of the queue, or that needs a person gets no delivery.                   | SPEC-queue.md § The dispatcher, step 1; judged rule 20     |
| `ARunThatFindsNoRequestChangesNothing` | A GitHub run that finds the request taken or gone is told `empty`, and changes nothing.         | SPEC-queue.md § The dispatcher, step 4; judged rule 21     |
| `AWaitingRequestIsDeliveredOrTaken`    | A waiting request is delivered, taken, or its delivery is marked failed. It never waits unseen. | SPEC-queue.md § The dispatcher, steps 2, 5, 7; E4.5 D6, D9 |
| `TheIssueClosesWhenTheRequestIsOut`    | When the request leaves the queue, its issue closes.                                            | SPEC-queue.md § The dispatcher, step 6; E4.5 D10           |
| `AStartedRunIsNotLeftHanging`          | Each GitHub run takes the request or ends.                                                      | SPEC-queue.md § The dispatcher, step 4                     |

## What the model leaves out

- The claim, the handle and the lease as numbers. They are in [queue-lease](queue-lease.md). Here a
  try ends with an outcome, or with no outcome (a release or a lease that runs out).
- Edit, answer and reopen. Each one starts a new waiting period, as a release does. The states after an
  outcome are in [request-life](request-life.md).
- More than one GitHub run at one time. Two runs that ask for the same request act as one: the
  claim lets one take it, and the other is told `empty`.
- Time as numbers: the 5 s of the dispatcher, the 10 s and 30 s before an attempt again, and the 10 s limit on a
  call to GitHub.
- The check of the repository at each attempt. A public repository is one cause of a failed
  attempt.
- A second issue after a crash (judged rule 24). It is one more delivery, and the claim still
  gives one outcome.
- The cap of tries and of attempts: the spec says 3 and 3. The model uses 2 and 2, so the chart
  stays small. The rules do not depend on the numbers.
