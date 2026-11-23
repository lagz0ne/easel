# copy: a text key that can be removed

This chart has the model of [copy-status](copy-status.md) with
[StatusRemove.cfg](models/copy/StatusRemove.cfg): a change of the texts can remove a text key.
TLC finds that `AReadyFrameIsSettled` and `AReadyFrameUsesOnlyTeamTexts` break in 3 steps:

1. A user adds a text (`texts.set`).
2. An agent puts the frame with ready. It uses that text key.
3. A user removes the text key. The frame is still ready, but it uses a text key that the team does
   not have.

So no call removes a text key (SPEC-copy.md § The texts of the team, rule 3). A remove needs a
rule for the ready frames that use it, and it is deferred.

```mermaid
---
title: "The status of an app frame: exploring until it settles its texts and colors, then ready"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: none
    lg1: exploring
    lg2: ready
    lg3: Breaks AReadyFrameIsSettled or AReadyFrameUsesOnlyTeamTexts in some cases
    lg4: Path to the AReadyFrameIsSettled or AReadyFrameUsesOnlyTeamTexts bug
  }
  class lg0 tan
  class lg1 yellow
  class lg2 teal
  class lg3 mayBreak
  class lg4 bugPath
  s0: Not made
  s1: Exploring, not settled
  s2: Exploring, settled
  s3: Ready
  [*] --> s0
  s0 --> s0: a user adds a text (texts.set)
  s0 --> s1: a put with an own text, a missing text key or a color off the look
  s0 --> s2: a put (settled)
  s0 --> s3: a put with ready
  s1 --> s2: a put (settled) or a user adds a text (texts.set)
  s1 --> s3: a put with ready
  s2 --> s1: a put with an own text, a missing text key or a color off the look or a user removes a text key
  s2 --> s3: a put with ready or an agent marks it ready
  s3 --> s2: an agent explores it again
  s3 --> s3: a user removes a text key
  s3 --> s1: an agent explores it again
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 tan
  class s0 bugPath
  class s1 yellow
  class s2 yellow
  class s3 teal
  class s3 mayBreak
  class s3 bugPath
```
