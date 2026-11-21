# kit: two agents change one piece

The chart shows one piece of the kit, from the seed (kit version 1) until kit version 3, while two agents read it and change it. A change is one conditional write on the revision that the agent read: the first change on a revision wins and makes a new kit version; a later change on the same revision answers `stale` and writes nothing. Each live frame then shows the new kit version, and no frame is written. The model is [models/kit/Kit.tla](models/kit/Kit.tla) with [KitPiece.cfg](models/kit/KitPiece.cfg) (`Part = "piece"`). TLC checks every rule below on all 51 of its states, and each one holds.

```mermaid
---
title: "kit: the look and the kit, their kit versions, and what a viewer saw"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: first
    lg1: changed
    lg2: behind
  }
  class lg0 tan
  class lg1 blue
  class lg2 yellow
  s0: The first look and kit (kit version 1): no tab open yet
  s1: The first look and kit (kit version 1): each tab shows it
  s2: Kit version 2: no tab open yet
  s3: Kit version 3: no tab open yet
  s4: Kit version 2: no tab open yet, a writer holds an old revision
  s5: Kit version 2: a tab shows an older kit version
  s6: Kit version 2: each tab shows it
  s7: Kit version 3: no tab open yet, a writer holds an old revision
  s8: Kit version 3: a tab shows an older kit version
  s9: Kit version 2: a tab shows an older kit version, a writer holds an old revision
  s10: Kit version 2: each tab shows it, a writer holds an old revision
  s11: Kit version 3: each tab shows it
  s12: Kit version 3: a tab shows an older kit version, a writer holds an old revision
  s13: Kit version 3: each tab shows it, a writer holds an old revision
  [*] --> s0
  s0 --> s1: each live frame shows the new kit version, no reload
  s0 --> s2: an agent changes the piece on the revision it read
  s0 --> s4: an agent changes the piece on the revision it read
  s2 --> s3: an agent changes the piece on the revision it read
  s2 --> s6: each live frame shows the new kit version, no reload
  s1 --> s5: an agent changes the piece on the revision it read
  s3 --> s11: each live frame shows the new kit version, no reload
  s4 --> s2: a change on an old revision answers stale, nothing written or a writer reads the current revision
  s4 --> s7: an agent changes the piece on the revision it read
  s4 --> s10: each live frame shows the new kit version, no reload
  s2 --> s7: an agent changes the piece on the revision it read
  s1 --> s9: an agent changes the piece on the revision it read
  s5 --> s6: each live frame shows the new kit version, no reload
  s5 --> s8: an agent changes the piece on the revision it read
  s6 --> s8: an agent changes the piece on the revision it read
  s7 --> s3: a change on an old revision answers stale, nothing written or a writer reads the current revision
  s7 --> s13: each live frame shows the new kit version, no reload
  s8 --> s11: each live frame shows the new kit version, no reload
  s9 --> s5: a change on an old revision answers stale, nothing written or a writer reads the current revision
  s9 --> s10: each live frame shows the new kit version, no reload
  s9 --> s12: an agent changes the piece on the revision it read
  s5 --> s12: an agent changes the piece on the revision it read
  s10 --> s6: a change on an old revision answers stale, nothing written or a writer reads the current revision
  s10 --> s12: an agent changes the piece on the revision it read
  s6 --> s12: an agent changes the piece on the revision it read
  s12 --> s8: a change on an old revision answers stale, nothing written or a writer reads the current revision
  s12 --> s13: each live frame shows the new kit version, no reload
  s13 --> s11: a change on an old revision answers stale, nothing written or a writer reads the current revision
  class s0 tan
  class s1 tan
  class s2 blue
  class s3 blue
  class s4 blue
  class s5 yellow
  class s6 blue
  class s7 blue
  class s8 yellow
  class s9 yellow
  class s10 blue
  class s11 blue
  class s12 yellow
  class s13 blue
```

| Rule                                 | In plain words                                                                                                                            | Spec line                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `TypeOK`                             | Each value is one the store, a tab or a writer can hold.                                                                                  | (model)                                                        |
| `AChangeOnAnOldRevisionIsNeverSaved` | A change lands only on the revision its writer read, so of two changes on one revision the second answers `stale`, and no change is lost. | SPEC-kit.md § Add to the kit, step 5, and judged rule 2 (K14)  |
| `ARefusalWritesNothing`              | A `stale` or `unreadable` answer changes no look, no piece and no kit version.                                                            | SPEC-kit.md, judged rule 1                                     |
| `EachChangeMakesOneKitVersion`       | Each change of the look or of a piece makes exactly one new kit version.                                                                  | SPEC-kit.md, judged rule 3 (K7, K13)                           |
| `TheNewestKitVersionIsTheStoredOne`  | The current kit version holds the stored look and the stored piece.                                                                       | SPEC-kit.md, judged rule 4                                     |
| `AKitVersionNeverChanges`            | A kit version never changes after it is written, and none goes away.                                                                      | SPEC-kit.md, judged rule 4 (K10, K11)                          |
| `NoStoredLookIsUnreadable`           | No kit version holds a look whose text fails WCAG AA.                                                                                     | SPEC-kit.md, judged rule 7 (K8)                                |
| `UndoGivesTheLookBefore`             | One step back gives the look from before the last change of the look, as a new kit version.                                               | SPEC-kit.md § Change the look, step 6, and judged rule 8 (K9)  |
| `ATabShowsOnlyAStoredKitVersion`     | A tab shows only a kit version that is stored.                                                                                            | SPEC-kit.md, judged rule 6                                     |
| `ATabNeverGoesBack`                  | A tab never goes back to an older kit version.                                                                                            | SPEC-kit.md, judged rule 6 (K7)                                |
| `TheBeforeShowsWhatTheViewerSaw`     | The Before of a request shows the look and the kit that the viewer saw when they asked, after any later change.                           | SPEC-kit.md § Change the look, step 7, and SPEC-queue.md (K10) |
| `NoDeadlock`                         | There is always a next step.                                                                                                              | (model)                                                        |

## What the model leaves out

- More than one piece and more than two writers: each piece acts the same, and two writers are enough for a race.
- The board's cell set after the row: the frames model ([frames-writes](frames-writes.md)) shows that pattern; here a tab reads the stored kit version in one step.
- The `taken`, `gone`, `offLook`, `tooBig`, `unchanged` and `invalid` answers. `unreadable` is a step that changes nothing, so it draws no arrow.
- Frames: no frame is written by a change of the kit, so the model has no frame. The picture of a frame in a kit version is in [frames-pictures](frames-pictures.md).
- The make step, the piece script and `compose`: a kit version holds its made CSS, and `compose`
  adds stored text only (SPEC-kit judged rules 5 and 9).
