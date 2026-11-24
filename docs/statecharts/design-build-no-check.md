# design build: a resolve before the build is live (breaks)

This twin of [design-build](design-build.md) takes a resolve that names a build that is not live
yet. Then the reply names a build that the person cannot see, and `TheReplyNamesALiveBuild`
breaks. TLC finds the break, and the chart shows the states up to it. The model is
[models/live/DesignBuild.tla](models/live/DesignBuild.tla) with `CheckLive = FALSE`.

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
    lg6: Breaks TheReplyNamesALiveBuild
    lg7: Path to the TheReplyNamesALiveBuild bug
  }
  class lg0 tan
  class lg1 yellow
  class lg2 blue
  class lg3 teal
  class lg4 orange
  class lg5 teal
  class lg6 breaks
  class lg7 bugPath
  s0: No build request, the design waits for an accept, live build 1, no push yet
  s1: The build request waits, the design is accepted, live build 1, no push yet
  s2: A design agent has the build request, the design is accepted, live build 1, no push yet
  s3: The build request needs a person, the design is accepted, live build 1, no push yet
  s4: A design agent has the build request, the design is accepted, live build 1, the change is in build 2
  s5: The build request needs a person, the design is accepted, live build 1, the change is in build 2
  s6: The build request waits, the design is accepted, live build 1, the change is in build 2
  s7: The build request is resolved, the design is accepted, live build 1, the change is in build 2, the reply names build 2
  s8: A design agent has the build request, the design is accepted, live build 2, the change is in build 2
  s9: The build is accepted, the design is accepted, live build 1, the change is in build 2, the reply names build 2
  s10: The build request needs a person, the design is accepted, live build 2, the change is in build 2
  s11: The build request waits, the design is accepted, live build 2, the change is in build 2
  s12: The build request is resolved, the design is accepted, live build 2, the change is in build 2, the reply names build 2
  s13: The build is accepted, the design is accepted, live build 2, the change is in build 2, the reply names build 2
  [*] --> s0
  s0 --> s1: a viewer accepts the design: easel adds one build request
  s1 --> s2: a design agent claims the build request
  s2 --> s1: the agent releases the build request with a reason: it waits again
  s2 --> s3: the agent declines the build request with a reason: it needs a person
  s2 --> s4: the agent ships the change of the code: a push makes the next build
  s3 --> s1: the person makes the build request clear: it waits again
  s4 --> s5: the agent declines the build request with a reason: it needs a person
  s4 --> s6: the agent releases the build request with a reason: it waits again
  s4 --> s7: the agent resolves the build request with its build
  s4 --> s8: a deploy: the site serves the build with the change
  s5 --> s6: the person makes the build request clear: it waits again
  s5 --> s10: a deploy: the site serves the build with the change
  s6 --> s4: a design agent claims the build request
  s6 --> s11: a deploy: the site serves the build with the change
  s7 --> s9: a viewer accepts the build: easel adds no other request
  s7 --> s12: a deploy: the site serves the build with the change
  s8 --> s10: the agent declines the build request with a reason: it needs a person
  s8 --> s11: the agent releases the build request with a reason: it waits again
  s8 --> s12: the agent resolves the build request with its build
  s9 --> s13: a deploy: the site serves the build with the change
  s10 --> s11: the person makes the build request clear: it waits again
  s11 --> s8: a design agent claims the build request
  s12 --> s13: a viewer accepts the build: easel adds no other request
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 tan
  class s0 bugPath
  class s1 yellow
  class s1 bugPath
  class s2 blue
  class s2 bugPath
  class s3 orange
  class s4 blue
  class s4 bugPath
  class s5 orange
  class s6 yellow
  class s7 teal
  class s7 breaks
  class s7 bugPath
  class s8 blue
  class s9 teal
  class s9 breaks
  class s10 orange
  class s11 yellow
  class s12 teal
  class s13 teal
```
