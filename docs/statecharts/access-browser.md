# access: a browser signs in

The chart shows how a browser of a user U signs in, and how its session ends
([SPEC-home](../../SPEC-home.md)). The phone of U shows a one-time code, and an owner approves it.
The laptop of U opens the one-time link that `easel open` printed. A copy of that link is in a third
browser: a link preview, or a message that someone sent on. A session ends when the browser signs
out, when an owner ends it, after 30 days with no use, or when an owner revokes U. The model is
[models/access/Browser.tla](models/access/Browser.tla); TLC checks every rule below on all 167 of
its states, and each one holds.

```mermaid
---
title: "A browser signs in: a code that an owner approves, a one-time link, a session that ends"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: in
  }
  class lg0 teal
  state "At the same time" as all {
    state "easel" as r0 {
      s0: U is a user, no link
      s1: U is a user, a live link
      s2: U is revoked, no link
      s3: U is a user, its link ran out or ended
      s4: U is revoked, its link ran out or ended
      s5: U is a user, its link is used
      s6: U is revoked, its link is used
      [*] --> s0
      s0 --> s1: U runs easel open
      s0 --> s2: an owner revokes U
      s1 --> s3: the link runs out (5 minutes)
      s1 --> s4: an owner revokes U
      s1 --> s5: the copy opens the link [when A copy of the link is Not signed in]
      s1 --> s5: the laptop opens the link [when The laptop of U (easel open) is Not signed in]
      s3 --> s1: U runs easel open
      s3 --> s4: an owner revokes U
      s5 --> s1: U runs easel open
      s5 --> s6: an owner revokes U
    }
    --
    state "The phone of U (a code)" as r1 {
      s7: Shows the sign-in page
      s8: Shows a code, it waits
      s9: Its code is approved
      s10: Signed in, the home page
      s11: Its session ended, it still shows the page
      [*] --> s7
      s7 --> s8: the sign-in page asks for a code
      s8 --> s7: an owner denies the code or the code runs out (10 minutes)
      s8 --> s7: an owner revokes U [when easel is none of U is revoked, its link is used, U is revoked, its link ran out or ended, U is revoked, no link]
      s8 --> s9: an owner approves the code [when easel is none of U is revoked, its link is used, U is revoked, its link ran out or ended, U is revoked, no link]
      s9 --> s7: the code runs out (10 minutes) or an owner revokes U
      s9 --> s10: the page uses the approved code
      s10 --> s7: the phone signs out
      s10 --> s11: an owner ends the session, or 30 days with no use or an owner revokes U
      s11 --> s7: its next read is refused
    }
    --
    state "The laptop of U (easel open)" as r2 {
      s12: Not signed in
      s13: Signed in, the home page
      s14: Its session ended, it still shows the page
      [*] --> s12
      s12 --> s13: the laptop opens the link [when easel is U is a user, a live link]
      s13 --> s14: an owner ends the session, or 30 days with no use or an owner revokes U
      s13 --> s12: the laptop signs out
      s14 --> s12: its next read is refused
    }
    --
    state "A copy of the link" as r3 {
      s15: Not signed in
      s16: Signed in, the home page
      s17: Its session ended, it still shows the page
      [*] --> s15
      s15 --> s16: the copy opens the link [when easel is U is a user, a live link]
      s16 --> s17: an owner ends the session, or 30 days with no use or an owner revokes U
      s17 --> s15: its next read is refused
    }
  }
  class s10 teal
  class s13 teal
  class s16 teal
```

| Rule                                     | In plain words                                                                                                                    | Spec anchor                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `TypeOK`                                 | Each part of the state has one of its values.                                                                                     | (model)                        |
| `ASessionNeedsAnApprovedCodeOrALiveLink` | A browser has a session only after an owner approved its code, or after it used a live sign-in link.                              | SPEC-home.md § Model, rule 1   |
| `ALinkSignsInAtMostOneBrowser`           | A sign-in link signs in at most one browser. The laptop or the copy gets the session; the second browser is refused.              | SPEC-home.md § Model, rule 2   |
| `NoReadAfterARevoke`                     | After a revoke, no browser of U reads a canvas. The revoke ends each session of U in its write, and each read checks the session. | SPEC-home.md § Model, rule 3   |
| `ARevokedUserHasNoLiveSession`           | After a revoke, no browser of U holds a live session. A browser that still shows a page is refused on its next read.              | SPEC-home.md, criterion 5      |
| `AnApprovedCodeSignsThePhoneIn`          | An approved code signs the phone in, unless the code runs out or U is revoked first.                                              | SPEC-home.md § New behavior, 1 |
| `NoDeadlock`                             | There is always a next step.                                                                                                      | (model)                        |

## What the model leaves out

- The cookie itself. A browser is "in" while it holds the cookie of a live session. That the cookie
  is `HttpOnly`, `Secure` and `SameSite=Lax`, and that the server keeps only its digest, are judged
  in code and tested.
- A new user with the name U after a revoke. The name is free again, and an approved code makes a
  new user. The model ends U for good.
- A code for a new name. An approve of a code for a name with no user makes a member (or an owner,
  with `--owner`). The model has one user, so each code is for U.
- More codes and more links at one time. Each one acts as the one in the model.
- A lost answer of the sign-in. The server made the session, but the browser did not get the
  cookie. The code is used, so the page asks for a new code. The session with no browser ends after
  30 days, or when an owner ends it.
- Time. "The code runs out" (10 minutes), "the link runs out" (5 minutes) and "30 days with no use"
  are steps.
- The rate limits of `browser.start` and `browser.wait`: they are the limits of `login.start` and
  `login.wait` (SPEC-access, judged rules 10 and 11).
- That the code page asks again: the spec assumes weak fairness on "the page uses the approved
  code". `AnApprovedCodeSignsThePhoneIn` rests on it.

## Make it again

```sh
scripts/statecharts.sh access-browser          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check access-browser  # change nothing; compare the block and the verdict in charts.tsv
```
