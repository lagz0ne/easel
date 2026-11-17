# frames: a put in two steps (expected to break)

Expected to break: this is why a put on an id is one conditional write. This is a what-if, kept as a warning. It is the [frames-writes](frames-writes.md) model with `OneWrite = FALSE`: a put reads the row and checks the base and the document, awaits, then writes without looking again. Two agents that put on the same version both pass the check, and both write: the second write lands on a version its writer never read, and the first agent's document is lost. The model is [models/frames/Writes.tla](models/frames/Writes.tla) with [WritesTwoStep.cfg](models/frames/WritesTwoStep.cfg). TLC reaches 483 states; the chart draws the 13 chart states. `scripts/statecharts.sh` expects this chart to break, and fails if it ever holds. SPEC-frames.md § Journeys, Make and change frames, step 4 (F1), and its judged rules 1-4 are the answer.

```mermaid
---
title: "frames, if a put checked then wrote in two steps (expected to break)"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: setup
    lg1: live
    lg2: writing
    lg3: gone
    lg4: Path to the AWriteOnAnOldVersionIsNeverSaved or TheVersionGoesUpOnlyWhenTheDocumentChanges bug
  }
  class lg0 tan
  class lg1 blue
  class lg2 yellow
  class lg3 purple
  class lg4 bugPath
  s0: No canvas
  s1: Canvas, no frame yet
  s2: Canvas deleted, with its frames
  s3: Saved, the board not yet updated
  s4: Frame deleted
  s5: Frame live, agents up to date
  s6: Saved, the board not yet updated, one put checked, its write to come
  s7: Frame live, agents up to date, one put checked, its write to come
  s8: Two saves, the board not yet updated
  s9: Frame live, agents up to date, two puts checked, writes to come
  s10: Frame live, an agent holds an old version
  s11: Frame live, an agent holds an old version, one put checked, its write to come
  s12: Frame live, an agent holds an old version, two puts checked, writes to come
  [*] --> s0
  s0 --> s1: an agent makes the canvas
  s1 --> s2: an agent deletes the canvas
  s1 --> s3: an agent puts a new frame
  s3 --> s4: an agent deletes the frame
  s3 --> s5: the board shows the stored version
  s3 --> s6: a put on the current version checks, its write to come
  s5 --> s2: an agent deletes the canvas
  s5 --> s4: an agent deletes the frame
  s5 --> s7: a put on the current version checks, its write to come
  s4 --> s2: an agent deletes the canvas
  s6 --> s4: an agent deletes the frame
  s6 --> s7: the board shows the stored version
  s6 --> s8: the checked put writes, without looking again
  s7 --> s4: an agent deletes the frame
  s7 --> s3: the checked put writes, without looking again
  s7 --> s7: the agent gets the frame again
  s8 --> s4: an agent deletes the frame
  s8 --> s3: the board shows the stored version
  s7 --> s9: a put on the current version checks, its write to come
  s3 --> s10: the board shows the stored version
  s9 --> s4: an agent deletes the frame
  s9 --> s6: the checked put writes, without looking again
  s10 --> s5: a put on an old version answers stale, nothing written or the agent gets the frame again
  s10 --> s2: an agent deletes the canvas
  s10 --> s4: an agent deletes the frame
  s10 --> s11: a put on the current version checks, its write to come
  s6 --> s11: the board shows the stored version
  s11 --> s3: the checked put writes, without looking again
  s11 --> s4: an agent deletes the frame
  s11 --> s7: the agent gets the frame again or a put on an old version answers stale, nothing written
  s11 --> s12: a put on the current version checks, its write to come
  s12 --> s6: the checked put writes, without looking again
  s12 --> s4: an agent deletes the frame
  s12 --> s9: the agent gets the frame again
  s6 --> s3: the checked put writes, without looking again
  s11 --> s5: the checked put writes, without looking again
  s7 --> s5: the checked put writes, without looking again
  class s0 tan
  class s0 bugPath
  class s1 tan
  class s1 bugPath
  class s2 purple
  class s3 yellow
  class s3 bugPath
  class s4 purple
  class s5 blue
  class s5 bugPath
  class s6 yellow
  class s6 bugPath
  class s7 yellow
  class s7 bugPath
  class s8 yellow
  class s8 bugPath
  class s9 yellow
  class s9 bugPath
  class s10 blue
  class s11 yellow
  class s12 yellow
```

| Rule                                         | In plain words                                                                                                                                 | Spec line                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `AWriteOnAnOldVersionIsNeverSaved`           | **Breaks.** Both agents check version 1, then both write: the second write saves on version 2, which its writer never read.                    | SPEC-frames.md § Journeys, Make and change frames, step 4, and judged rule 2      |
| `TheVersionGoesUpOnlyWhenTheDocumentChanges` | **Breaks.** Both agents write the same document: the second write raises the version and changes nothing, where one write answers `unchanged`. | SPEC-frames.md § Journeys, Make and change frames, step 5, and judged rule 3      |
| `TypeOK`                                     | Holds.                                                                                                                                         | (model)                                                                           |
| `ARefusalWritesNothing`                      | Holds.                                                                                                                                         | SPEC-frames.md, judged rule 1                                                     |
| `EachDocumentChangeRaisesTheVersionByOne`    | Holds.                                                                                                                                         | SPEC-frames.md, judged rule 3                                                     |
| `APutOnAnIdNeverMakesAFrame`                 | Holds.                                                                                                                                         | SPEC-frames.md § Journeys, Make and change frames, step 6, and § Contract, Inputs |
| `TheBoardNeverShowsAVersionNotStored`        | Holds.                                                                                                                                         | SPEC-frames.md, judged rule 4                                                     |
| `TheBoardNeverGoesBack`                      | Holds.                                                                                                                                         | SPEC-frames.md, judged rule 4                                                     |
| `AtRestTheBoardShowsTheStoredVersion`        | Holds.                                                                                                                                         | SPEC-frames.md, judged rule 4                                                     |
| `ADeletedFrameIsOffTheBoard`                 | Holds.                                                                                                                                         | SPEC-frames.md, judged rule 4                                                     |
| `ADeletedCanvasHasNoFrames`                  | Holds.                                                                                                                                         | SPEC-frames.md § Journeys, Make a canvas, step 4                                  |
| `ADeletedFrameStaysDeleted`                  | Holds.                                                                                                                                         | SPEC-frames.md § Journeys, Make and change frames, step 8, and § Contract         |
| `NoDeadlock`                                 | Holds.                                                                                                                                         | (model)                                                                           |

## What the model leaves out

The same as [frames-writes](frames-writes.md#what-the-model-leaves-out). The await between the check and the write is one step of any length: anything may happen while it lasts. A checked write that finds the frame deleted answers `gone`.

## Steps the chart hides

- The steps [frames-writes](frames-writes.md#steps-the-chart-hides) hides.
- The full counterexamples are in the generator's output: `tlc-<rule>.out`.

## Make it again

```sh
scripts/statecharts.sh frames-writes-two-step          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check frames-writes-two-step  # change nothing; compare the block and the verdict in charts.tsv
```
