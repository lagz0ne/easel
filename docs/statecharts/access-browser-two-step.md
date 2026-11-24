# access: a sign-in link in two steps (expected to break)

Expected to break: this is why one write checks the sign-in link, uses it and makes the session.
This is a what-if, kept as a warning. It is the [access-browser](access-browser.md) model with
`OneWrite = FALSE`: `POST /auth/open` finds the link live, then makes the session in a second write
with no new look. Two browsers that open the link at the same time both find it live, and both sign
in. A browser that found the link live before a revoke, or before the link ran out, signs in after
it, and reads a canvas of a revoked user. The model is
[models/access/Browser.tla](models/access/Browser.tla) with
[BrowserTwoStep.cfg](models/access/BrowserTwoStep.cfg). TLC reaches 739 states, more than the chart
budget of 500, so the chart draws only the bug paths. `scripts/statecharts.sh` expects this chart to
break, and fails if it ever holds. The answer is one `UPDATE ... WHERE used = 0 RETURNING` that
checks the link, its time and its user, and makes the session in the same transaction.

```mermaid
---
title: "A browser signs in: a code that an owner approves, a one-time link, a session that ends"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: in
    lg1: out
    lg2: Breaks ALinkSignsInAtMostOneBrowser
    lg3: Breaks ALinkSignsInAtMostOneBrowser or ARevokedUserHasNoLiveSession or ASessionNeedsAnApprovedCodeOrALiveLink or NoReadAfterARevoke in some cases
    lg4: Path to the ALinkSignsInAtMostOneBrowser or ARevokedUserHasNoLiveSession or ASessionNeedsAnApprovedCodeOrALiveLink or NoReadAfterARevoke bug
  }
  class lg0 teal
  class lg1 tan
  class lg2 breaks
  class lg3 mayBreak
  class lg4 bugPath
  state "At the same time" as all {
    state "easel" as r0 {
      s0: U is a user, no link
      s1: U is a user, a live link
      s2: U is revoked, its link ran out or ended
      s3: U is a user, its link ran out or ended
      s4: U is a user, its link is used
      s5: U is revoked, its link is used
      [*] --> s0
      s0 --> s1: U runs easel open
      s1 --> s2: an owner revokes U [when The laptop of U (easel open) is Found the link live, not yet used and A copy of the link is Not signed in]
      s1 --> s3: the link runs out (5 minutes) [when The laptop of U (easel open) is Found the link live, not yet used and A copy of the link is Not signed in]
      s2 --> s5: the laptop uses the link it found
      s1 --> s4: the laptop uses the link it found [when The laptop of U (easel open) is Found the link live, not yet used and A copy of the link is Found the link live, not yet used]
      s3 --> s4: the laptop uses the link it found
    }
    --
    state "The phone of U (a code)" as r1 {
      s6: Shows the sign-in page
      [*] --> s6
    }
    --
    state "The laptop of U (easel open)" as r2 {
      s7: Not signed in
      s8: Found the link live, not yet used
      s9: Signed in, the home page
      [*] --> s7
      s7 --> s8: the laptop finds the link live [when easel is U is a user, a live link]
      s8 --> s9: the laptop uses the link it found [when easel is one of U is a user, its link ran out or ended, U is revoked, its link ran out or ended or A copy of the link is Found the link live, not yet used]
    }
    --
    state "A copy of the link" as r3 {
      s10: Not signed in
      s11: Found the link live, not yet used
      s12: Signed in, the home page
      [*] --> s10
      s10 --> s11: the copy finds the link live [when easel is U is a user, a live link and The laptop of U (easel open) is Found the link live, not yet used]
      s11 --> s12: the copy uses the link it found [when easel is U is a user, its link is used and The laptop of U (easel open) is Signed in, the home page]
    }
  }
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 tan
  class s0 bugPath
  class s1 tan
  class s1 bugPath
  class s2 tan
  class s2 bugPath
  class s3 tan
  class s3 bugPath
  class s4 teal
  class s4 mayBreak
  class s4 bugPath
  class s5 teal
  class s5 mayBreak
  class s5 bugPath
  class s6 mayBreak
  class s6 bugPath
  class s7 tan
  class s7 bugPath
  class s8 tan
  class s8 bugPath
  class s9 teal
  class s9 mayBreak
  class s9 bugPath
  class s10 mayBreak
  class s10 bugPath
  class s11 bugPath
  class s12 teal
  class s12 breaks
  class s12 bugPath
```

## Make it again

```sh
scripts/statecharts.sh access-browser-two-step
scripts/statecharts.sh --check access-browser-two-step
```
