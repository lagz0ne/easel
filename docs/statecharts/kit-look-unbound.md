# kit: why a request keeps its kit version

The same model as [kit-look](kit-look.md), with `KeepKit = FALSE` ([KitLookUnbound.cfg](models/kit/KitLookUnbound.cfg)): a request keeps only the frame version, so its Before is drawn with the current kit version. After a change of the look, the Before shows a look that the viewer never saw, and `TheBeforeShowsWhatTheViewerSaw` breaks. This is why a request, a claim and a result keep their kit version.

```mermaid
---
title: "kit: the look and the kit, their kit versions, and what a viewer saw"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: first
    lg1: changed
    lg2: behind
    lg3: asked
    lg4: Breaks TheBeforeShowsWhatTheViewerSaw
    lg5: Breaks TheBeforeShowsWhatTheViewerSaw in some cases
    lg6: Path to the TheBeforeShowsWhatTheViewerSaw bug
  }
  class lg0 tan
  class lg1 blue
  class lg2 yellow
  class lg3 teal
  class lg4 breaks
  class lg5 mayBreak
  class lg6 bugPath
  s0: The first look and kit (kit version 1): no tab open yet
  s1: The first look and kit (kit version 1): each tab shows it
  s2: The first look and kit (kit version 1): each tab shows it#59; a request keeps this kit version
  s3: Kit version 2, a new look: no tab open yet
  s4: Kit version 2, a new look: a tab shows an older kit version
  s5: Kit version 2, a new look: each tab shows it
  s6: Kit version 3, the first look again: no tab open yet
  s7: Kit version 2, a new look: a tab shows an older kit version#59; a request keeps an older kit version
  s8: Kit version 2, a new look: each tab shows it#59; a request keeps this kit version
  s9: Kit version 3, the first look again: a tab shows an older kit version
  s10: Kit version 3, the first look again: each tab shows it
  s11: Kit version 4, a new look: no tab open yet
  s12: Kit version 2, a new look: each tab shows it#59; a request keeps an older kit version
  s13: Kit version 3, the first look again: a tab shows an older kit version#59; a request keeps an older kit version
  s14: Kit version 3, the first look again: each tab shows it#59; a request keeps this kit version
  s15: Kit version 4, a new look: a tab shows an older kit version
  s16: Kit version 4, a new look: each tab shows it
  s17: Kit version 3, the first look again: each tab shows it#59; a request keeps an older kit version
  s18: Kit version 4, a new look: a tab shows an older kit version#59; a request keeps an older kit version
  s19: Kit version 4, a new look: each tab shows it#59; a request keeps this kit version
  s20: Kit version 4, a new look: each tab shows it#59; a request keeps an older kit version
  [*] --> s0
  s0 --> s0: a writer reads the current revision
  s0 --> s1: each live frame shows the new kit version, no reload
  s0 --> s3: a user changes the look (WCAG AA holds)
  s1 --> s2: a viewer asks#59; the request keeps this kit version
  s1 --> s4: a user changes the look (WCAG AA holds)
  s3 --> s5: each live frame shows the new kit version, no reload
  s3 --> s6: a user changes the look (WCAG AA holds) or a user goes back one step
  s2 --> s7: a user changes the look (WCAG AA holds)
  s4 --> s5: each live frame shows the new kit version, no reload
  s4 --> s7: a viewer asks#59; the request keeps this kit version
  s4 --> s9: a user changes the look (WCAG AA holds) or a user goes back one step
  s5 --> s8: a viewer asks#59; the request keeps this kit version
  s5 --> s9: a user changes the look (WCAG AA holds) or a user goes back one step
  s6 --> s10: each live frame shows the new kit version, no reload
  s6 --> s11: a user changes the look (WCAG AA holds) or a user goes back one step
  s7 --> s12: each live frame shows the new kit version, no reload
  s7 --> s13: a user changes the look (WCAG AA holds) or a user goes back one step
  s8 --> s13: a user changes the look (WCAG AA holds) or a user goes back one step
  s9 --> s10: each live frame shows the new kit version, no reload
  s9 --> s13: a viewer asks#59; the request keeps this kit version
  s9 --> s15: a user changes the look (WCAG AA holds) or a user goes back one step
  s10 --> s14: a viewer asks#59; the request keeps this kit version
  s10 --> s15: a user changes the look (WCAG AA holds) or a user goes back one step
  s11 --> s16: each live frame shows the new kit version, no reload
  s12 --> s13: a user changes the look (WCAG AA holds) or a user goes back one step
  s13 --> s17: each live frame shows the new kit version, no reload
  s13 --> s18: a user changes the look (WCAG AA holds) or a user goes back one step
  s14 --> s18: a user changes the look (WCAG AA holds) or a user goes back one step
  s15 --> s16: each live frame shows the new kit version, no reload
  s15 --> s18: a viewer asks#59; the request keeps this kit version
  s16 --> s19: a viewer asks#59; the request keeps this kit version
  s17 --> s18: a user changes the look (WCAG AA holds) or a user goes back one step
  s18 --> s20: each live frame shows the new kit version, no reload
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 tan
  class s0 bugPath
  class s1 tan
  class s1 bugPath
  class s2 teal
  class s2 bugPath
  class s3 blue
  class s4 yellow
  class s5 blue
  class s6 blue
  class s7 teal
  class s7 breaks
  class s7 bugPath
  class s8 teal
  class s9 yellow
  class s10 blue
  class s11 blue
  class s12 teal
  class s12 breaks
  class s13 teal
  class s13 mayBreak
  class s14 teal
  class s15 yellow
  class s16 blue
  class s17 teal
  class s17 mayBreak
  class s18 teal
  class s18 mayBreak
  class s19 teal
  class s20 teal
  class s20 mayBreak
```

| Rule                                 | In plain words                                                                                                                                                                                                                  | Spec line                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `TypeOK`                             | Each value is one the store, a tab or a writer can hold.                                                                                                                                                                        | (model)                                                        |
| `AChangeOnAnOldRevisionIsNeverSaved` | A change lands only on the revision its writer read, so of two changes on one revision the second answers `stale`, and no change is lost.                                                                                       | SPEC-kit.md § Add to the kit, step 5, and judged rule 2 (K14)  |
| `ARefusalWritesNothing`              | A `stale` or `unreadable` answer changes no look, no piece and no kit version.                                                                                                                                                  | SPEC-kit.md, judged rule 1                                     |
| `EachChangeMakesOneKitVersion`       | Each change of the look or of a piece makes exactly one new kit version.                                                                                                                                                        | SPEC-kit.md, judged rule 3 (K7, K13)                           |
| `TheNewestKitVersionIsTheStoredOne`  | The current kit version holds the stored look and the stored piece.                                                                                                                                                             | SPEC-kit.md, judged rule 4                                     |
| `AKitVersionNeverChanges`            | A kit version never changes after it is written, and none goes away.                                                                                                                                                            | SPEC-kit.md, judged rule 4 (K10, K11)                          |
| `NoStoredLookIsUnreadable`           | No kit version holds a look whose text fails WCAG AA.                                                                                                                                                                           | SPEC-kit.md, judged rule 7 (K8)                                |
| `UndoGivesTheLookBefore`             | One step back gives the look from before the last change of the look, as a new kit version.                                                                                                                                     | SPEC-kit.md § Change the look, step 6, and judged rule 8 (K9)  |
| `ATabShowsOnlyAStoredKitVersion`     | A tab shows only a kit version that is stored.                                                                                                                                                                                  | SPEC-kit.md, judged rule 6                                     |
| `ATabNeverGoesBack`                  | A tab never goes back to an older kit version.                                                                                                                                                                                  | SPEC-kit.md, judged rule 6 (K7)                                |
| `TheBeforeShowsWhatTheViewerSaw`     | The Before of a request shows the look and the kit that the viewer saw when they asked, after any later change. **Breaks here**: the request keeps only the frame version, so its Before is drawn with the current kit version. | SPEC-kit.md § Change the look, step 7, and SPEC-queue.md (K10) |
| `NoDeadlock`                         | There is always a next step.                                                                                                                                                                                                    | (model)                                                        |

## What the model leaves out

- More than one piece and more than two writers: each piece acts the same, and two writers are enough for a race.
- The board's cell set after the row: the frames model ([frames-writes](frames-writes.md)) shows that pattern; here a tab reads the stored kit version in one step.
- The `taken`, `gone`, `offLook`, `tooBig`, `unchanged` and `invalid` answers. `unreadable` is a step that changes nothing, so it draws no arrow.
- Frames: no frame is written by a change of the kit, so the model has no frame. The picture of a frame in a kit version is in [frames-pictures](frames-pictures.md).
- The make step, the piece script and `compose`: a kit version holds its made CSS, and `compose`
  adds stored text only (SPEC-kit judged rules 5 and 9).
