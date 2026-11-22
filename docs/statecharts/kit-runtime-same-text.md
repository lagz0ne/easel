# kit: why the same TSX on another runtime is a new frame version

The same model as [kit-runtime](kit-runtime.md), with `Same = "text"` ([KitRuntimeSameText.cfg](models/kit/KitRuntimeSameText.cfg)): a put of the same TSX answers `unchanged`, on any runtime. That was the rule before the accept. `APutAfterAcceptGivesTheEaselRuntime` breaks in 4 steps: an agent puts the frame, easel updates, the team accepts, and the agent puts the same frame again. The put writes nothing, so the frame stays on the older runtime. This is why the same document of an app frame is the same text on the same runtime.

```mermaid
---
title: "kit: a team accepts the runtime of an update of easel"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: none
    lg1: same
    lg2: older
    lg3: waits
    lg4: Breaks APutAfterAcceptGivesTheEaselRuntime in some cases
    lg5: Path to the APutAfterAcceptGivesTheEaselRuntime bug
  }
  class lg0 tan
  class lg1 teal
  class lg2 yellow
  class lg3 blue
  class lg4 mayBreak
  class lg5 bugPath
  s0: no app frame yet
  s1: the frame shows the runtime of this easel
  s2: the frame shows an older runtime#59; the kit keeps it
  s3: the kit has the runtime of this easel#59; the frame waits for a put
  [*] --> s0
  s0 --> s1: an agent puts the frame: a new version
  s1 --> s2: an update of easel: it runs another runtime
  s2 --> s3: the team accepts the runtime of this easel: the next kit version
  s3 --> s3: an agent puts the same frame: nothing is written
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 tan
  class s0 bugPath
  class s1 teal
  class s1 bugPath
  class s2 yellow
  class s2 bugPath
  class s3 blue
  class s3 mayBreak
  class s3 bugPath
```

| Rule                                  | In plain words                                                                     | Spec line                     |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `APutAfterAcceptGivesTheEaselRuntime` | Breaks: the put after the accept writes nothing, so the frame keeps the older one. | SPEC-kit.md § App frames      |
| The other rules of kit-runtime        | Hold.                                                                              | [kit-runtime](kit-runtime.md) |

## What the model leaves out

The same as [kit-runtime](kit-runtime.md).
