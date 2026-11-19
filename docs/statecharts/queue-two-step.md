# queue: a claim in two steps (expected to break)

Expected to break: this is why the claim is one write. This is a what-if, kept as a warning. It is
the [queue-lease](queue-lease.md) model with `ATOMIC = FALSE`: `request.next` finds the oldest
request it can take, awaits, then writes its claim without looking again. Two agents that call at
the same time both find request 1, and both write. The model is
[models/queue/Queue.tla](models/queue/Queue.tla) with
[QueueTwoStep.cfg](models/queue/QueueTwoStep.cfg). TLC reaches 4,199 states, more than the chart
budget of 500, so the chart draws only the paths to the rules that break. It follows request 1.
`scripts/statecharts.sh` expects this chart to break, and fails if it ever holds. SPEC-queue.md,
judged rule 6, and the forced race in its success criteria are the answer.

```mermaid
---
title: "queue, if next picked then wrote in two steps (expected to break): the life of request 1"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: waiting
    lg1: inWork
    lg2: person
    lg3: Breaks ARequestIsHeldByAtMostOneAgent or ARequestNeedsAPersonOnlyAfterTriesWithNoOutcome or TriesCountTriesWithNoOutcome or TypeOK
    lg4: Path to the ALiveHolderIsNeverToldLost or ARequestIsHeldByAtMostOneAgent or ARequestNeedsAPersonOnlyAfterTriesWithNoOutcome or ARequestThatNeedsAPersonIsNeverGiven or TheOldestRequestIsTakenFirst or TriesCountTriesWithNoOutcome or TypeOK bug
  }
  class lg0 blue
  class lg1 yellow
  class lg2 orange
  class lg3 breaks
  class lg4 bugPath
  s0: Not posted
  s1: Waiting
  s2: Waiting, an agent picked it, claim not written
  s3: In work
  s4: Waiting, both agents picked it, claims not written
  s5: In work, an agent picked it, claim not written
  s6: Two agents both hold it
  s7: In work, an agent picked request 2
  s8: Lease ran out, shows waiting, an earlier holder still works on it, an agent picked request 2
  s9: Needs a person, though one try is live, an earlier holder still works on it
  s10: Lease ran out, shows waiting, an earlier holder still works on it, request 2 in work
  s11: Two agents hold it, past the cap
  s12: Needs a person, an agent picked it, claim not written, an earlier holder still works on it
  s13: In work past the cap, an earlier holder still works on it
  [*] --> s0
  s0 --> s1: a viewer posts it
  s1 --> s1: a viewer posts request 2
  s1 --> s2: an agent finds it oldest
  s2 --> s3: that agent writes its claim
  s2 --> s4: an agent finds it oldest
  s3 --> s1: the holder releases it
  s4 --> s5: that agent writes its claim
  s3 --> s7: an agent finds request 2 oldest
  s5 --> s6: that agent writes its claim
  s6 --> s3: an agent is told lost
  s6 --> s9: the lease runs out
  s7 --> s8: the lease runs out
  s8 --> s10: that agent writes its claim on request 2
  s5 --> s11: that agent writes its claim
  s5 --> s12: the lease runs out
  s12 --> s13: that agent writes its claim
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 blue
  class s0 bugPath
  class s1 blue
  class s1 bugPath
  class s2 blue
  class s2 bugPath
  class s3 yellow
  class s3 bugPath
  class s4 blue
  class s4 bugPath
  class s5 yellow
  class s5 bugPath
  class s6 yellow
  class s6 breaks
  class s6 bugPath
  class s7 yellow
  class s7 bugPath
  class s8 blue
  class s8 bugPath
  class s9 orange
  class s9 breaks
  class s9 bugPath
  class s10 blue
  class s10 bugPath
  class s11 yellow
  class s11 breaks
  class s11 bugPath
  class s12 orange
  class s12 bugPath
  class s13 yellow
  class s13 bugPath
```

| Rule                                              | In plain words                                                                                                                    | Spec line                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `ARequestIsHeldByAtMostOneAgent`                  | **Breaks.** Both agents find request 1, then both write their claim: two agents hold it.                                          | SPEC-queue.md § An agent works the queue, step 9; judged rule 6 |
| `TriesCountTriesWithNoOutcome`                    | **Breaks.** The two writes count two tries for one live lease.                                                                    | SPEC-queue.md, judged rule 11                                   |
| `ARequestNeedsAPersonOnlyAfterTriesWithNoOutcome` | **Breaks.** Two tries and one lease that ran out: the request needs a person after one try with no outcome.                       | SPEC-queue.md, judged rule 11                                   |
| `TypeOK`                                          | **Breaks.** An agent that found the request before it reached the cap writes its claim after: `tries` goes past the cap.          | SPEC-queue.md § Contract; judged rule 11                        |
| `ALiveHolderIsNeverToldLost`                      | **Breaks.** Of two agents that both hold it, the one whose handle was written over is told `lost` while its own lease is live.    | SPEC-queue.md, judged rule 8                                    |
| `TheOldestRequestIsTakenFirst`                    | **Breaks.** An agent finds request 2 while 1 is in work. The lease on 1 runs out before the write, and the agent claims 2 over 1. | SPEC-queue.md § Contract (the order); judged rule 6             |
| `ARequestThatNeedsAPersonIsNeverGiven`            | **Breaks.** An agent finds request 1. It reaches the cap before the write, and the agent claims it all the same.                  | SPEC-queue.md, judged rule 11                                   |
| The other rules of [queue-lease](queue-lease.md)  | Hold.                                                                                                                             |                                                                 |

## What the model leaves out

The same as [queue-lease](queue-lease.md#what-the-model-leaves-out). The await between the find
and the write is one step of any length: anything can happen while it lasts.

## Steps the chart hides

- Every state that is not on the shortest path to a rule that breaks: TLC reaches 4,199 states,
  and the chart draws 14.
- The full counterexamples are in the output of the generator: `tlc-<rule>.out`.

## Make it again

```sh
scripts/statecharts.sh queue-two-step          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check queue-two-step  # change nothing; compare the block and the verdict in charts.tsv
```
