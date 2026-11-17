---- MODULE Writes ----
\* SPEC-frames.md § Journeys, Make and change frames, and judged rules 1-4: one canvas, one frame
\* id, two agents writing it. A put on an id is one conditional write (F1): the base check, the
\* document compare and the version bump are one statement, so no step comes between them.
\* The row is saved first; the board's cell is set after, in its own step, from the row as it
\* is stored at that moment.
\* OneWrite = FALSE is the two-step save this rules out (chart frames-writes-two-step): the put
\* reads the row and checks base and document, awaits, then writes without looking again, so
\* another agent's save can land between the two steps. Writes.cfg has OneWrite = TRUE.
EXTENDS Naturals

CONSTANT OneWrite

Agents == {"A", "B"}
Docs == {"x", "y"}      \* two documents an agent can write
MaxVersion == 3         \* model bound: no write past version 3

VARIABLES
  canvas,   \* "none" | "open" | "deleted"
  frame,    \* "none" | "live" | "deleted"   (one frame id)
  version,  \* the stored version (0 before the frame exists)
  doc,      \* the stored document: "x" | "y" | "-"
  base,     \* base[a]: the version agent a last got back (0 = none)
  board,    \* the version the board's cell shows (0 = not on the board)
  pending,  \* pending[a]: agent a's row is saved and its cell set is still to come
  wants     \* wants[a]: without OneWrite, the document agent a checked and is still to write

vars == <<canvas, frame, version, doc, base, board, pending, wants>>
NoWant == [a \in Agents |-> "-"]
store == <<canvas, frame, version, doc>>
NoBase == [a \in Agents |-> 0]

Init ==
  /\ canvas = "none" /\ frame = "none" /\ version = 0 /\ doc = "-"
  /\ base = NoBase /\ board = 0 /\ pending = [a \in Agents |-> FALSE] /\ wants = NoWant

\* easel canvas new. (A second one answers taken and changes nothing, so it is no step here.)
MakeCanvas ==
  /\ canvas = "none"
  /\ canvas' = "open"
  /\ UNCHANGED <<frame, version, doc, base, board, pending, wants>>

\* easel put without --id: a new frame at version 1
MakeFrame(a, d) ==
  /\ canvas = "open" /\ frame = "none"
  /\ frame' = "live" /\ version' = 1 /\ doc' = d
  /\ base' = [base EXCEPT ![a] = 1]
  /\ pending' = [pending EXCEPT ![a] = TRUE]
  /\ UNCHANGED <<canvas, board, wants>>

\* easel get: the agent learns the current version
GetFrame(a) ==
  /\ frame = "live" /\ ~pending[a]
  /\ base[a] # version
  /\ base' = [base EXCEPT ![a] = version]
  /\ UNCHANGED <<canvas, frame, version, doc, board, pending, wants>>

\* easel put --id --base with document d is one conditional write (F1-F3):
\*   UPDATE frames SET html = d, version = version + 1
\*   WHERE canvas = ? AND id = ? AND version = base AND html IS NOT d
\* No row changed: the same transaction reads the row to answer gone, stale or unchanged.
CanPut(a) == base[a] # 0 /\ ~pending[a] /\ wants[a] = "-"

PutGone(a) ==
  /\ CanPut(a) /\ frame # "live"
  /\ base' = [base EXCEPT ![a] = 0]
  /\ UNCHANGED <<canvas, frame, version, doc, board, pending, wants>>

PutStale(a) ==
  /\ CanPut(a) /\ frame = "live" /\ base[a] # version
  /\ base' = [base EXCEPT ![a] = 0]
  /\ UNCHANGED <<canvas, frame, version, doc, board, pending, wants>>

\* the same document: answers unchanged, and nothing at all changes (a stutter step)
PutUnchanged(a, d) ==
  /\ CanPut(a) /\ frame = "live" /\ base[a] = version /\ d = doc
  /\ UNCHANGED vars

PutSaves(a, d) ==
  /\ CanPut(a) /\ frame = "live" /\ base[a] = version /\ d # doc
  /\ version < MaxVersion
  /\ IF OneWrite
       THEN /\ version' = version + 1 /\ doc' = d
            /\ base' = [base EXCEPT ![a] = version + 1]
            /\ pending' = [pending EXCEPT ![a] = TRUE]
            /\ UNCHANGED wants
       ELSE /\ wants' = [wants EXCEPT ![a] = d]
            /\ UNCHANGED <<version, doc, base, pending>>
  /\ UNCHANGED <<canvas, frame, board>>

\* without OneWrite: the write after the check, made without looking at the row again
PutWritesLater(a) ==
  /\ wants[a] # "-"
  /\ wants' = [wants EXCEPT ![a] = "-"]
  /\ IF frame = "live" /\ version < MaxVersion
       THEN /\ version' = version + 1 /\ doc' = wants[a]
            /\ base' = [base EXCEPT ![a] = version + 1]
            /\ pending' = [pending EXCEPT ![a] = TRUE]
       ELSE /\ base' = [base EXCEPT ![a] = 0]
            /\ UNCHANGED <<version, doc, pending>>
  /\ UNCHANGED <<canvas, frame, board>>

Put(a, d) == PutGone(a) \/ PutStale(a) \/ PutUnchanged(a, d) \/ PutSaves(a, d)

\* after the row: the cell is set from the row as stored now (not from what this put wrote)
SetCell(a) ==
  /\ pending[a]
  /\ board' = IF frame = "live" THEN version ELSE 0
  /\ pending' = [pending EXCEPT ![a] = FALSE]
  /\ UNCHANGED <<canvas, frame, version, doc, base, wants>>

\* easel rm <canvas> <id>: the row and the cell go together
DeleteFrame ==
  /\ frame = "live"
  /\ frame' = "deleted" /\ board' = 0
  /\ UNCHANGED <<canvas, version, doc, base, pending, wants>>

\* easel canvas rm: the canvas and its frames. (Taken only when no cell set is pending, and
\* each agent's later put, which answers gone, is folded into this step.)
DeleteCanvas ==
  /\ canvas = "open" /\ \A a \in Agents : ~pending[a] /\ wants[a] = "-"
  /\ canvas' = "deleted"
  /\ frame' = IF frame = "live" THEN "deleted" ELSE frame
  /\ board' = 0 /\ base' = NoBase
  /\ UNCHANGED <<version, doc, pending, wants>>

\* the end: the canvas is gone
Done ==
  /\ canvas = "deleted"
  /\ UNCHANGED vars

Next ==
  \/ MakeCanvas \/ DeleteFrame \/ DeleteCanvas
  \/ \E a \in Agents :
       \/ GetFrame(a) \/ SetCell(a) \/ PutWritesLater(a)
       \/ \E d \in Docs : MakeFrame(a, d) \/ Put(a, d)
  \/ Done

Spec == Init /\ [][Next]_vars

\* ---------- rules, in the reader's words ----------

\* SPEC-frames.md § Journeys, Make and change frames, step 4, and judged rule 2 (F1): no write is
\* lost. A save lands only on the version its writer read, so a put made on a version that is no
\* longer current is never saved.
AWriteOnAnOldVersionIsNeverSaved ==
  [][(frame = "live" /\ frame' = "live" /\ version' # version)
       => \E a \in Agents : base[a] = version /\ base'[a] = version + 1]_vars

\* SPEC-frames.md, judged rule 1: a stale, gone or unchanged answer writes nothing.
ARefusalWritesNothing ==
  [][\A a \in Agents, d \in Docs :
       (PutGone(a) \/ PutStale(a) \/ PutUnchanged(a, d)) => UNCHANGED <<store, board>>]_vars

\* SPEC-frames.md, judged rule 3: each change of the document raises the version by one.
EachDocumentChangeRaisesTheVersionByOne ==
  [][(frame = "live" /\ frame' = "live" /\ doc' # doc) => version' = version + 1]_vars

\* SPEC-frames.md § Journeys, Make and change frames, step 5, and judged rule 3 (F2): the version
\* goes up only when the document changes.
TheVersionGoesUpOnlyWhenTheDocumentChanges ==
  [][(frame = "live" /\ frame' = "live" /\ version' # version) => doc' # doc]_vars

\* SPEC-frames.md § Journeys, Make and change frames, step 6, and § Contract, Inputs (F3): a put on
\* an id never makes a frame; a missing id answers gone.
APutOnAnIdNeverMakesAFrame ==
  [][\A a \in Agents, d \in Docs : Put(a, d) => frame' = frame]_vars

\* SPEC-frames.md, judged rule 4: the board shows no version the store does not hold.
TheBoardNeverShowsAVersionNotStored == board <= version

\* SPEC-frames.md, judged rule 4: the board never goes back to an older version of a live frame.
TheBoardNeverGoesBack ==
  [][(frame = "live" /\ frame' = "live") => board' >= board]_vars

\* SPEC-frames.md, judged rule 4: when no write is in flight, the board shows what is stored.
AtRestTheBoardShowsTheStoredVersion ==
  (\A a \in Agents : ~pending[a]) => board = (IF frame = "live" THEN version ELSE 0)

\* SPEC-frames.md, judged rule 4: a deleted frame is off the board, and stays off.
ADeletedFrameIsOffTheBoard == frame # "live" => board = 0

\* SPEC-frames.md § Journeys, Make a canvas, step 4: a deleted canvas keeps no frames.
ADeletedCanvasHasNoFrames == canvas # "open" => frame # "live"

\* SPEC-frames.md § Journeys, Make and change frames, step 8, and § Contract: a deleted frame stays
\* deleted (a later call answers gone).
ADeletedFrameStaysDeleted == [][frame = "deleted" => frame' = "deleted"]_vars

TypeOK ==
  /\ canvas \in {"none", "open", "deleted"}
  /\ frame \in {"none", "live", "deleted"}
  /\ version \in 0..MaxVersion
  /\ board \in 0..MaxVersion
====
