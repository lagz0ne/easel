# access: one person on a server, with the steps of approve (expected to break)

Expected to break: this is why `EASEL_AUTH=single` removes the name field and the approve of a new
name. This is a what-if, kept as a warning. It is the [access-single](access-single.md) model with
`Single = FALSE`: the sign-in page asks for a name, as on an approve server, and a stranger types
`bob`. The person approves the code, as the person did on 2026-11-24 for `lagz0ne`. The approve
makes `bob` a member, and the phone signs in as `bob`. So a step adds a person, and a session
belongs to a name that is not the person and not an agent. The model is
[models/access/Single.tla](models/access/Single.tla) with
[SingleApprove.cfg](models/access/SingleApprove.cfg). `scripts/statecharts.sh` expects this chart to
break, and fails if it ever holds. The answer is a code with no name: in single, `browser.start`
takes no name, each code is for the person, and an approve never makes a user.

```mermaid
---
title: "One person on a server: a code with no name, a link of easel open, an agent, a rename"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: waiting
    lg1: in
    lg2: out
    lg3: Breaks ASessionIsThePersonsOrAnAgents or NoStepAddsAPerson
    lg4: Breaks ASessionIsThePersonsOrAnAgents or NoStepAddsAPerson in some cases
    lg5: Path to the ASessionIsThePersonsOrAnAgents or NoStepAddsAPerson bug
  }
  class lg0 yellow
  class lg1 teal
  class lg2 tan
  class lg3 breaks
  class lg4 mayBreak
  class lg5 bugPath
  state "At the same time" as all {
    state "Users" as r0 {
      s0: rocky is the person, the agent is a member
      s1: rocky is the person, the agent is a member, bob is a member
      [*] --> s0
      s0 --> s1: the person approves the code [when The phone (a code) is Shows a code for bob, it waits]
    }
    --
    state "The link of easel open" as r1 {
      s2: No link
      [*] --> s2
    }
    --
    state "The phone (a code)" as r2 {
      s3: Shows the sign-in page
      s4: Shows a code for bob, it waits
      s5: Its code for bob is approved
      s6: Signed in as bob
      [*] --> s3
      s3 --> s4: the sign-in page shows a code
      s4 --> s5: the person approves the code
      s5 --> s6: the page uses the approved code
    }
    --
    state "The laptop (the link)" as r3 {
      s7: Not signed in
      [*] --> s7
    }
    --
    state "A copy of the link" as r4 {
      s8: Not signed in
      [*] --> s8
    }
  }
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 bugPath
  class s1 mayBreak
  class s1 bugPath
  class s2 bugPath
  class s3 tan
  class s3 bugPath
  class s4 yellow
  class s4 bugPath
  class s5 yellow
  class s5 breaks
  class s5 bugPath
  class s6 teal
  class s6 breaks
  class s6 bugPath
  class s7 bugPath
  class s8 bugPath
```

## Make it again

```sh
scripts/statecharts.sh access-single-approve          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check access-single-approve  # change nothing; compare the block and the verdict in charts.tsv
```
