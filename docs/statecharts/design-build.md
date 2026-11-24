# design build: an accepted design starts the change of the app

The chart follows one design request on `product` after a design agent resolved it with a new
version of its frame ([SPEC-live-screens](../../SPEC-live-screens.md), decisions 9 and 10; E11 V4
and V7). A viewer accepts the result, and easel adds one build request on the frame. A design agent
claims it, changes the code, and ships it. The push makes a build, and a deploy puts it live. The
agent resolves the build request with that build, and easel refuses a build that is not live. The
agent can also release the build request (it waits again) or decline it (it needs a person, who
sees why). The model is [models/live/DesignBuild.tla](models/live/DesignBuild.tla); TLC checks
each rule below on all its states, and each one holds.

```mermaid
---
title: "design build: an accepted design starts the change of the app"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: none
    lg1: waiting
    lg2: inWork
    lg3: resolved
    lg4: person
    lg5: accepted
  }
  class lg0 tan
  class lg1 yellow
  class lg2 blue
  class lg3 teal
  class lg4 orange
  class lg5 teal
  s0: No build request, the design waits for an accept, live build 1, no push yet
  s1: The build request waits, the design is accepted, live build 1, no push yet
  s2: A design agent has the build request, the design is accepted, live build 1, no push yet
  s3: The build request needs a person, the design is accepted, live build 1, no push yet
  s4: A design agent has the build request, the design is accepted, live build 1, the change is in build 2
  s5: The build request needs a person, the design is accepted, live build 1, the change is in build 2
  s6: The build request waits, the design is accepted, live build 1, the change is in build 2
  s7: A design agent has the build request, the design is accepted, live build 2, the change is in build 2
  s8: The build request needs a person, the design is accepted, live build 2, the change is in build 2
  s9: The build request waits, the design is accepted, live build 2, the change is in build 2
  s10: The build request is resolved, the design is accepted, live build 2, the change is in build 2, the reply names build 2
  s11: The build is accepted, the design is accepted, live build 2, the change is in build 2, the reply names build 2
  [*] --> s0
  s0 --> s1: a viewer accepts the design: easel adds one build request
  s1 --> s2: a design agent claims the build request
  s2 --> s1: the agent releases the build request with a reason: it waits again
  s2 --> s3: the agent declines the build request with a reason: it needs a person
  s2 --> s4: the agent ships the change of the code: a push makes the next build
  s3 --> s1: the person makes the build request clear: it waits again
  s4 --> s5: the agent declines the build request with a reason: it needs a person
  s4 --> s6: the agent releases the build request with a reason: it waits again
  s4 --> s7: a deploy: the site serves the build with the change
  s5 --> s6: the person makes the build request clear: it waits again
  s5 --> s8: a deploy: the site serves the build with the change
  s6 --> s4: a design agent claims the build request
  s6 --> s9: a deploy: the site serves the build with the change
  s7 --> s8: the agent declines the build request with a reason: it needs a person
  s7 --> s9: the agent releases the build request with a reason: it waits again
  s7 --> s10: the agent resolves the build request with its build
  s8 --> s9: the person makes the build request clear: it waits again
  s9 --> s7: a design agent claims the build request
  s10 --> s11: a viewer accepts the build: easel adds no other request
  class s0 tan
  class s1 yellow
  class s2 blue
  class s3 orange
  class s4 blue
  class s5 orange
  class s6 yellow
  class s7 blue
  class s8 orange
  class s9 yellow
  class s10 teal
  class s11 teal
```

The rules:

- `OneBuildRequestForEachAccept`: an accept adds one build request; an accept of a build request
  adds none.
- `ABuildRequestNeedsAnAccept`: easel adds a build request only after an accept.
- `TheReplyNamesALiveBuild`: a resolved build request names a build, and that build is live (V7).
- `TheDesignStaysAccepted`: a failure of the build does not change the accept of the design.

The twin [design-build-no-check](design-build-no-check.md) takes a resolve before the build is
live, and breaks.
