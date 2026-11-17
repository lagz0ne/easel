# fixer: a claim with neither guard (expected to break)

Expected to break: this is why the fixer needs one of its two guards. This is a what-if, kept as a
warning. It is the [fixer-claim-fix](fixer-claim-fix.md) model with both guards off: the wrapper
stops only its fixer, not the fixer's process group (`PGID = FALSE`), and `ship.sh --fixer` pushes
after its gate without checking again (`ReCheck = FALSE`). Fixer 1 starts its `ship.sh`, and the
wrapper stops fixer 1 while the gate runs. Its `ship.sh` runs on, the lease runs out, and the
orphaned `ship.sh` pushes a fix that no live claim covers. If fixer 2 claimed the group meanwhile,
the group gets two fixes. The model is [models/fixer/Claim.tla](models/fixer/Claim.tla) with
[ClaimUnsafe.cfg](models/fixer/ClaimUnsafe.cfg). TLC reaches 35 states; the chart draws 34.
`scripts/statecharts.sh` expects this chart to break, and fails if it ever holds. With either guard
on, every rule holds: [fixer-claim-fix](fixer-claim-fix.md#what-the-model-leaves-out) gives the
counts. The answer is SPEC-fixer.md § A fixer holds a claim, step 2 (the process group), with judged
rule 4, and fixer rule 3 (the check again before the push).

```mermaid
---
title: "easel fixer, with no group stop and no re-check (expected to break)"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: resolved
    lg1: nobody
    lg2: one
    lg3: Breaks FixShipsOnlyUnderClaim or OneFixPerGroup
    lg4: Path to the FixShipsOnlyUnderClaim or OneFixPerGroup bug
  }
  class lg0 teal
  class lg1 tan
  class lg2 blue
  class lg3 breaks
  class lg4 bugPath
  s0: Fixer 1 not started, fixer 2 not started (issue noted)
  s1: Fixer 1 fixing, fixer 2 not started (issue noted)
  s2: Fixer 1 shipping, gate runs, fixer 2 not started (issue noted)
  s3: Fixer 1 stopped, claim still live, fixer 2 not started (issue noted)
  s4: Fixer 1 stopped, its ship.sh runs on, fixer 2 not started (issue noted)
  s5: Fixer 1 fix pushed, fixer 2 not started (fix on main, not noted)
  s6: Fixer 1 stopped, fixer 2 not started (issue noted)
  s7: Fixer 1 stopped, claim still live, fixer 2 not started (fix on main, not noted)
  s8: Fixer 1 stopped, fixer 2 fixing (issue noted)
  s9: Fixer 1 fix noted, resolving, fixer 2 not started (fix noted)
  s10: Fixer 1 stopped, its ship.sh runs on, fixer 2 fixing (issue noted)
  s11: Fixer 1 stopped, fixer 2 shipping, gate runs (issue noted)
  s12: Fixer 1 stopped, fixer 2 not started (fix on main, not noted)
  s13: Fixer 1 stopped, fixer 2 not started (fix on main, not noted): a fix shipped without the claim
  s14: Fixer 1 resolved it, fixer 2 not started (fix noted)
  s15: Fixer 1 stopped, claim still live, fixer 2 not started (fix noted)
  s16: Fixer 1 stopped, its ship.sh runs on, fixer 2 shipping, gate runs (issue noted)
  s17: Fixer 1 stopped, fixer 2 fix pushed (fix on main, not noted)
  s18: Fixer 1 stopped, fixer 2 fix pushed (fix on main, not noted): a fix shipped without the claim
  s19: Fixer 1 stopped, fixer 2 fixing (fix on main, not noted): a fix shipped without the claim
  s20: Fixer 1 stopped, fixer 2 not started (fix noted)
  s21: Fixer 1 stopped, its ship.sh runs on, fixer 2 fix pushed (fix on main, not noted)
  s22: Fixer 1 stopped, fixer 2 shipping, gate runs (fix on main, not noted): a fix shipped without the claim
  s23: Fixer 1 stopped, fixer 2 stopped, claim still live (fix on main, not noted): a fix shipped without the claim
  s24: Fixer 1 stopped, fixer 2 fix noted, resolving (fix noted)
  s25: Fixer 1 stopped, fixer 2 fix noted, resolving (fix noted): a fix shipped without the claim
  s26: Fixer 1 stopped, fixer 2 fix pushed (fix on main, not noted): 2 fixes shipped, a fix shipped without the claim
  s27: Fixer 1 stopped, fixer 2 stopped (fix on main, not noted): a fix shipped without the claim
  s28: Fixer 1 stopped, its ship.sh runs on, fixer 2 fix noted, resolving (fix noted)
  s29: Fixer 1 stopped, fixer 2 resolved it (fix noted)
  s30: Fixer 1 stopped, fixer 2 resolved it (fix noted): a fix shipped without the claim
  s31: Fixer 1 stopped, its ship.sh runs on, fixer 2 resolved it (fix noted)
  s32: Fixer 1 stopped, fixer 2 fix noted, resolving (fix noted): 2 fixes shipped, a fix shipped without the claim
  s33: Fixer 1 stopped, fixer 2 resolved it (fix noted): 2 fixes shipped, a fix shipped without the claim
  [*] --> s0
  s0 --> s1: fixer 1 claims the group [it has an issue]
  s1 --> s2: fixer 1 runs ship.sh --fixer: extend and trailer check pass, the gate runs
  s1 --> s3: fixer 1 crashes, or its wrapper stops it
  s2 --> s4: fixer 1 crashes, or its wrapper stops it
  s2 --> s5: fixer 1's ship.sh pushes the fix, without checking again
  s3 --> s6: the lease runs out
  s4 --> s4: the lease runs out
  s4 --> s7: fixer 1's ship.sh pushes the fix, without checking again
  s5 --> s7: fixer 1 crashes, or its wrapper stops it
  s5 --> s9: fixer 1's note-fix answers noted
  s6 --> s8: fixer 2 claims the group [it has an issue]
  s4 --> s10: fixer 2 claims the group [it has an issue]
  s4 --> s13: fixer 1's ship.sh pushes the fix, without checking again
  s7 --> s12: the lease runs out
  s8 --> s11: fixer 2 runs ship.sh --fixer: extend and trailer check pass, the gate runs
  s9 --> s14: fixer 1's resolve answers resolved
  s9 --> s15: fixer 1 crashes, or its wrapper stops it
  s10 --> s16: fixer 2 runs ship.sh --fixer: extend and trailer check pass, the gate runs
  s10 --> s19: fixer 1's ship.sh pushes the fix, without checking again
  s11 --> s17: fixer 2's ship.sh pushes the fix, without checking again
  s12 --> s17: fixer 2 claims the group [its fix is on main, not noted]
  s13 --> s18: fixer 2 claims the group [its fix is on main, not noted]
  s15 --> s20: the lease runs out
  s16 --> s21: fixer 2's ship.sh pushes the fix, without checking again
  s16 --> s22: fixer 1's ship.sh pushes the fix, without checking again
  s17 --> s24: fixer 2's note-fix answers noted
  s18 --> s25: fixer 2's note-fix answers noted
  s19 --> s23: ship.sh --fixer refuses fixer 2's fix
  s20 --> s24: fixer 2 claims the group [its fix is noted]
  s21 --> s26: fixer 1's ship.sh pushes the fix, without checking again
  s21 --> s28: fixer 2's note-fix answers noted
  s22 --> s26: fixer 2's ship.sh pushes the fix, without checking again
  s23 --> s27: the lease runs out
  s24 --> s29: fixer 2's resolve answers resolved
  s25 --> s30: fixer 2's resolve answers resolved
  s26 --> s32: fixer 2's note-fix answers noted
  s28 --> s31: fixer 2's resolve answers resolved
  s28 --> s32: fixer 1's ship.sh pushes the fix, without checking again
  s31 --> s33: fixer 1's ship.sh pushes the fix, without checking again
  s32 --> s33: fixer 2's resolve answers resolved
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 tan
  class s0 bugPath
  class s1 blue
  class s1 bugPath
  class s2 blue
  class s2 bugPath
  class s3 tan
  class s4 tan
  class s4 bugPath
  class s5 blue
  class s6 tan
  class s7 tan
  class s8 blue
  class s9 blue
  class s10 blue
  class s10 bugPath
  class s11 blue
  class s12 tan
  class s13 tan
  class s13 breaks
  class s13 bugPath
  class s14 teal
  class s15 tan
  class s16 blue
  class s16 bugPath
  class s17 blue
  class s18 blue
  class s18 breaks
  class s19 blue
  class s19 breaks
  class s20 tan
  class s21 blue
  class s21 bugPath
  class s22 blue
  class s22 breaks
  class s23 tan
  class s23 breaks
  class s24 blue
  class s25 blue
  class s25 breaks
  class s26 blue
  class s26 breaks
  class s26 bugPath
  class s27 tan
  class s27 breaks
  class s28 blue
  class s29 teal
  class s30 teal
  class s30 breaks
  class s31 teal
  class s32 blue
  class s32 breaks
  class s33 teal
  class s33 breaks
```

| Rule                          | In plain words                                                                                                                                          | Spec line                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `FixShipsOnlyUnderClaim`      | **Breaks** in 5 steps. Fixer 1 claims, its `ship.sh` checks, the wrapper stops fixer 1 but not its `ship.sh`, the lease runs out, the `ship.sh` pushes. | SPEC-fixer.md § A fixer holds a claim, step 5; fact rule 3; fixer rules 1 and 3                |
| `OneFixPerGroup`              | **Breaks** in 8 steps. As above, but fixer 2 claims the group after the lease runs out and pushes its own fix first; then fixer 1's `ship.sh` pushes.   | SPEC-fixer.md § A fixer fixes an error, step 1; fixer rules 2, 7 and 8                         |
| `NoClaimOverALiveLease`       | Holds.                                                                                                                                                  | SPEC-fixer.md § A fixer holds a claim, step 1; fact rule 5                                     |
| `OneFixerAtATime`             | Holds.                                                                                                                                                  | SPEC-fixer.md § The tick finds work, step 2; § A fixer holds a claim, steps 2-3; judged rule 2 |
| `ResolvedOnlyWithItsFixNoted` | Holds.                                                                                                                                                  | SPEC-fixer.md § A fixer fixes an error, step 5; fact rule 6; fixer rule 8                      |
| `NoDeadlock`                  | Holds.                                                                                                                                                  | (model)                                                                                        |

## What the model leaves out

The same as [fixer-claim-fix](fixer-claim-fix.md#what-the-model-leaves-out), but for the two guards,
which are both off here.

## Steps the chart hides

- No steps stay in one chart state.
- The view hides 5 steps: the model's `Done` step, which repeats the end once a fixer resolved the
  group.
- The full counterexamples are in the generator's output: `tlc-<rule>.out`.

## Make it again

```sh
scripts/statecharts.sh fixer-claim-unsafe          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check fixer-claim-unsafe  # change nothing; compare the block and the verdict in charts.tsv
```
