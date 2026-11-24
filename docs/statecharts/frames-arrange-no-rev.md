# frames: why a change of an exact place names the revision

This chart breaks on purpose. It is [frames-arrange-rev](frames-arrange-rev.md) with no revision
check ([ArrangeNoRev.cfg](models/frames/ArrangeNoRev.cfg)). Each agent is right about what it read:
A puts e right of d as d was, and B makes d wider while e is not there yet. Together, the two
changes make d touch e. So `frame.put`, `frame.move` and `section.set` take `rev`, and refuse a
change on an old revision (SPEC-arrange.md rule 21, G6). TLC finds `NoTouch` broken in 4 steps.

```mermaid
---
title: "frames: two agents change exact places from what each read"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: start
    lg1: read
    lg2: done
    lg3: touch
    lg4: Breaks NoTouch
    lg5: Path to the NoTouch bug
  }
  class lg0 tan
  class lg1 blue
  class lg2 teal
  class lg3 pink
  class lg4 breaks
  class lg5 bugPath
  s0: d, no e
  s1: d, no e#59; B read
  s2: d, no e#59; A read
  s3: d, e at x 2#59; A is done
  s4: d is wide, no e#59; B is done
  s5: d, no e#59; A read#59; B read
  s6: d, e at x 2#59; A is done#59; B read#59; B holds an old read
  s7: d is wide, no e#59; A read#59; A holds an old read#59; B is done
  s8: d is wide, no e#59; A read#59; B is done
  s9: d, e at x 2#59; A is done#59; B read
  s10: d is wide, e at x 2#59; d touches e#59; A is done#59; B is done
  s11: d is wide, e at x 3#59; A is done#59; B is done
  s12: d, e at x 2#59; A is done#59; B is done
  [*] --> s0
  s0 --> s1: B reads the page
  s0 --> s2: A reads the page
  s1 --> s4: B makes d wider, clear of e as B read it
  s1 --> s5: A reads the page
  s2 --> s3: A puts e at x 2, right of d as A read it
  s2 --> s5: B reads the page
  s3 --> s9: B reads the page
  s4 --> s8: A reads the page
  s5 --> s6: A puts e at x 2, right of d as A read it
  s5 --> s7: B makes d wider, clear of e as B read it
  s6 --> s10: B makes d wider, clear of e as B read it
  s7 --> s10: A puts e at x 2, right of d as A read it
  s8 --> s11: A puts e at x 3, right of d as A read it
  s9 --> s12: B reads that a wider d touches e: B keeps d
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 tan
  class s0 bugPath
  class s1 blue
  class s2 blue
  class s2 bugPath
  class s3 tan
  class s4 tan
  class s5 blue
  class s5 bugPath
  class s6 blue
  class s7 blue
  class s7 bugPath
  class s8 blue
  class s9 blue
  class s10 pink
  class s10 breaks
  class s10 bugPath
  class s11 teal
  class s12 teal
```

| Rule                    | In plain words                                           | Verdict |
| ----------------------- | -------------------------------------------------------- | ------- |
| `NoTouch`               | d and e never touch.                                     | breaks  |
| `ARefusalWritesNothing` | A change on an old revision writes nothing.              | holds   |
| `EachChangeAddsOne`     | Each change of a place or a size adds 1 to the revision. | holds   |
