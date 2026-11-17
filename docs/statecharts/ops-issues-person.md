# ops: an error group that a person resolves or takes

The same error group as [ops-issues](ops-issues.md), with an owner who acts on it by hand:
`easel errors resolve <fingerprint> --build <n>` (`ops.resolveError`) and
`easel errors hand-off <fingerprint> --reason <text>` (`ops.handOff`), with no claim. ops never
touches a GitHub issue, so an issue the fixer opened stays open until the tick closes it. Once a
person has resolved or taken the group, a regression goes back to a person: the fixer's stop check
gives up at once, and ships no further fix. The stop check reads two signs that a person had
the group (SPEC-fixer.md § A fixer fixes an error, step 1):

- its `reason` is set: an owner handed it off;
- its `fixedIn` is none of the fixes the fixer noted: an owner resolved it.

The model is
[models/ops/Lifecycle.tla](models/ops/Lifecycle.tla) with
[LifecyclePerson.cfg](models/ops/LifecyclePerson.cfg): `People = TRUE`, builds 1 to 2, and one fix
(`Cap = 1`), so it stays under the chart budget. TLC checks every rule below on all 106 of its
states, and each one holds.

```mermaid
---
title: "easel ops: one error group, from its first error to resolved or a person"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: person
    lg1: browser
    lg2: resolved
    lg3: quiet
    lg4: waiting
    lg5: fixer
  }
  class lg0 pink
  class lg1 purple
  class lg2 teal
  class lg3 tan
  class lg4 orange
  class lg5 blue
  s0: Browser page: no error yet
  s1: Server: no error yet
  s2: Browser-only group: open, unconfirmed
  s3: Open: waiting for the tick
  s4: Open: a fixer has it, issue open
  s5: A person has it, no issue open
  s6: A person has it: issue labelled needs-human
  s7: Fix shipped, its build not live yet
  s8: A person has it, its issue open
  s9: Resolved by an owner
  s10: Fix live, waiting to resolve
  s11: Came back after a person had it: waiting for the tick
  s12: Fix live, but the error came back on it
  s13: Resolved by fix 1, issue closed
  s14: Resolved by an owner, its issue still open
  s15: Came back after a person had it: a fixer has it, issue open
  s16: Fix 1 did not hold (failing or regressed): a fixer has it, issue open
  s17: Fix 1 did not hold (failing or regressed): waiting for the tick
  s18: Resolved by fix 1, dropped at the cap, fingerprint kept
  [*] --> s0
  [*] --> s1
  s0 --> s2: the error happens
  s1 --> s3: the error happens
  s3 --> s4: the tick finds it#59; a fixer claims it and opens or reopens its issue
  s3 --> s5: an owner hands it off
  s4 --> s6: ship.sh --fixer refuses the fix, or its gate is red
  s4 --> s3: the line is stopped#59; the fixer lets go
  s4 --> s7: ship.sh --fixer ships and notes a fix
  s6 --> s8: an owner hands it off
  s3 --> s8: an owner hands it off
  s3 --> s9: an owner resolves it [its build is live, and not seen on it]
  s7 --> s10: a newer build goes live
  s5 --> s9: an owner resolves it [its build is live, and not seen on it]
  s9 --> s5: an owner hands it off
  s9 --> s11: the error happens on the fix's build or later
  s10 --> s12: the error happens again
  s10 --> s13: resolve answers resolved#59; the issue closes [fix 1]
  s6 --> s14: an owner resolves it [its build is live, and not seen on it]
  s3 --> s14: an owner resolves it [its build is live, and not seen on it]
  s11 --> s15: the tick finds it#59; a fixer claims it and opens or reopens its issue
  s11 --> s5: an owner hands it off
  s12 --> s16: resolve answers failing [fix 1]
  s13 --> s5: an owner hands it off
  s13 --> s9: an owner resolves it [its build is live, and not seen on it]
  s13 --> s17: the error happens on the fix's build or later
  s13 --> s18: ops drops the group at the 1000 cap
  s8 --> s14: an owner resolves it [its build is live, and not seen on it]
  s14 --> s8: an owner hands it off
  s14 --> s9: the tick closes its issue
  s14 --> s11: the error happens on the fix's build or later
  s15 --> s8: the fixer gives up [a person had it before]
  s16 --> s6: the fixer gives up [its last fix shipped]
  s17 --> s16: the tick finds it#59; a fixer claims it and opens or reopens its issue
  s17 --> s5: an owner hands it off
  s18 --> s17: the error happens on the fix's build or later
  s11 --> s8: an owner hands it off
  class s0 purple
  class s1 tan
  class s3 orange
  class s4 blue
  class s5 pink
  class s6 pink
  class s7 blue
  class s8 pink
  class s9 teal
  class s10 blue
  class s11 orange
  class s12 blue
  class s13 teal
  class s14 teal
  class s15 blue
  class s16 blue
  class s17 orange
  class s18 teal
```

| Rule                         | In plain words                                                                                                                                      | Spec line                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `BrowserGroupGetsNoFix`      | A browser-only group never starts a fix, also after an owner resolved it and it came back.                                                          | SPEC-ops.md § An error is recorded, step 5                                   |
| `BrowserGroupOpensNoIssue`   | A browser-only group opens no issue.                                                                                                                | SPEC-ops.md § An error is recorded, step 5                                   |
| `ResolvedOnlyWhenFixIsLive`  | An owner resolves a group only once the live build is the given build or later: `notLive` otherwise.                                                | SPEC-ops.md § An error group moves through its states, step 2; judged rule 7 |
| `ResolvedNotAlreadyFailing`  | An owner never resolves a group already seen on the given build or later: `failing`.                                                                | SPEC-ops.md § An error group moves through its states, step 2; judged rule 7 |
| `RegressedOnlyAfterFix`      | A group an owner resolved is marked regressed only when seen on a build at or after its `fixedIn`.                                                  | SPEC-ops.md § An error group moves through its states, step 3; judged rule 6 |
| `OpenMeansNeverResolved`     | A group an owner resolved never comes back as new, also after it was dropped at the cap: it is regressed.                                           | SPEC-ops.md § An error group moves through its states, step 3; judged rule 4 |
| `ResolvedClosesIssue`        | Once a fixer resolves a group, its issue is closed. An owner's resolve leaves an issue as it was.                                                   | SPEC-fixer.md § A fixer fixes an error, step 6                               |
| `ResolvedIssueGetsClosed`    | A resolved group whose issue is still open gets it closed by the tick (only the tick is fair).                                                      | SPEC-fixer.md § The tick finds work, step 1.2                                |
| `PersonSeesAnOpenIssue`      | A group a fixer hands to a person has an open issue that says so. An owner who hands it off is the person, so ops opens none.                       | SPEC-ops.md § An error group moves through its states, step 4                |
| `NoFixAfterSecondRegression` | No fix ships once the cap of regressions is reached. A regression after a person had it never reaches a ship: the fixer gives up first.             | SPEC-fixer.md § A fixer fixes an error, steps 1 and 8                        |
| `AtMostTwoFixTries`          | `ship.sh --fixer` gates at most the cap of fixes for one group, also when a person resolved it between them. Without the stop check, TLC breaks it. | SPEC-fixer.md § A fixer fixes an error, steps 1 and 8                        |
| `HumanStaysHuman`            | A group handed to a person stays with the person: an error seen again and the fixers leave it `human`. Only an owner's resolve moves it on.         | SPEC-ops.md § An error group moves through its states, step 4                |
| `NoDeadlock`                 | There is always a next step.                                                                                                                        | (model)                                                                      |

## What the model leaves out

- `held`: while a fixer holds a lease, an owner's `resolve` and `hand-off` answer `held` and change
  nothing, so they are no step. The owner's actions need the fixer idle.
- `notLive`, `failing` and `gone` for an owner's resolve: they change nothing, so they are no
  step. The resolve's guard is the build check (`live >= n`, never seen on `n` or later).
- An owner acting on a dropped group answers `gone`: a group dropped at the cap is in no list, so
  an owner cannot see it. Its resolve and hand-off change nothing, so they are no step: the model's
  `OwnerResolves` and `OwnerHandsOff` need `~dropped`. Once it is seen again on a build at or
  after its fix, it is back as `regressed`, and an owner can act on it.
- A browser group that has regressed or gone `human` can be dropped at the cap too, and it comes
  back as a new `open` group: only a dropped `resolved` group keeps its fingerprint and `fixedIn`
  (SPEC-ops.md, judged rules 3 and 4). The model drops only `resolved` groups.
- A second fix. With builds 1 to 2 and `Cap = 1`, one fix ships; [ops-issues](ops-issues.md)
  checks two fixes with no owner's actions. Both run the same model.
- How the fixer knows a person had the group: in ops, its `reason` is set (a hand-off), or its
  `fixedIn` is none of its noted fixes (an owner's resolve). Here it is one flag, `person`.
- The retired list's size and the `dropped` counter, as in [ops-issues](ops-issues.md).

## Steps the chart hides

- A group dropped at the cap after a person had it shows as the same state: it comes back the same
  way, as [ops-issues](ops-issues.md) shows.
- The model's `Done` step, which repeats the end once no build is left to ship or deploy.

## Make it again

```sh
scripts/statecharts.sh ops-issues-person          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check ops-issues-person  # change nothing; compare the block and the verdict in charts.tsv
```
