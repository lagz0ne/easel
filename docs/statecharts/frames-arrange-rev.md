# frames: two agents change exact places, with the revision

Two agents change the exact places of one page, each from what it read (SPEC-arrange.md rules 19 to
22, G6). Agent A puts the frame e right of the frame d, at the right edge of d that A read. Agent B
makes d wider, but only when its read says that the wider d does not touch e. Each change adds 1 to
the revision of the canvas, and a change that names an old revision is refused `changed`: it writes
nothing, and the agent reads again. The model is
[models/frames/ArrangeRev.tla](models/frames/ArrangeRev.tla) with
[ArrangeRev.cfg](models/frames/ArrangeRev.cfg). TLC checks every rule below on all 13 of its
states, and each one holds.

```mermaid
---
title: "frames: two agents change exact places from what each read"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: start
    lg1: read
    lg2: done
  }
  class lg0 tan
  class lg1 blue
  class lg2 teal
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
  s10: d is wide, e at x 3#59; A is done#59; B is done
  s11: d, e at x 2#59; A is done#59; B is done
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
  s6 --> s3: the revision changed: B is refused, and reads again
  s7 --> s4: the revision changed: A is refused, and reads again
  s8 --> s10: A puts e at x 3, right of d as A read it
  s9 --> s11: B reads that a wider d touches e: B keeps d
  class s0 tan
  class s1 blue
  class s2 blue
  class s3 tan
  class s4 tan
  class s5 blue
  class s6 blue
  class s7 blue
  class s8 blue
  class s9 blue
  class s10 teal
  class s11 teal
```

| Rule                    | In plain words                                           | Spec line               |
| ----------------------- | -------------------------------------------------------- | ----------------------- |
| `TypeOK`                | Each value is one that the server can hold.              | (model)                 |
| `NoTouch`               | d and e never touch.                                     | SPEC-arrange.md rule 21 |
| `ARefusalWritesNothing` | A change on an old revision writes nothing.              | SPEC-arrange.md rule 21 |
| `EachChangeAddsOne`     | Each change of a place or a size adds 1 to the revision. | SPEC-arrange.md rule 19 |
| `NoDeadlock`            | There is always a next step.                             | (model)                 |

## What the model leaves out

- The relations: a relation keeps its meaning when another agent changes the page, so it needs no
  revision ([frames-arrange](frames-arrange.md)).
- The answer of each change, which lists what touches (G5).
