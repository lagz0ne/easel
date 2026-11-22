---- MODULE KitRuntime ----
\* SPEC-kit.md § App frames, "The runtime" and "Accept the runtime of this easel": the runtime of
\* each kit version, one app frame, and an update of easel. A kit version gets the runtime of the
\* easel that runs at its first use (a put), and keeps it (K11). A change of the look copies the
\* runtime of the kit version before it. The team accepts the runtime of this easel: one statement
\* writes the next kit version, as the current one with this runtime, only when the current one has
\* a runtime and it is another one. A put pins the frame to the current kit version. A put of the
\* same document writes nothing; with `Same = "runtime"`, the same document is the same text on the
\* same runtime, and with `Same = "text"`, the same text only (the rule before the accept).
\*
\* One text is enough: the agent puts the same TSX again. Two runtimes (one update of easel) and
\* `MaxKit` kit versions keep the model finite.
EXTENDS Naturals, Sequences

CONSTANTS Same, MaxKit

None == 0
Runtimes == {1, 2}

VARIABLES
  easel,     \* the runtime of the easel that runs: 1, then 2 after an update
  kits,      \* kits[k]: the runtime of kit version k (None: no first use yet); the last is current
  how,       \* how[k]: how kit version k came: "seed", "look" or "accept"
  frame,     \* the app frame: the kit version it is pinned to (0: no put yet)
  saved,     \* the count of the frame's versions
  accepted,  \* the team accepted the runtime of this easel, and easel did not update since
  putSince   \* a put ended after the accept

vars == <<easel, kits, how, frame, saved, accepted, putSince>>

Init ==
  /\ easel = 1 /\ kits = <<None>> /\ how = <<"seed">>
  /\ frame = 0 /\ saved = 0 /\ accepted = FALSE /\ putSince = FALSE

Current == Len(kits)

\* The runtime of kit version k; the frame with no put shows none.
Rt(k) == IF k = 0 THEN None ELSE kits[k]

\* An update of easel: the binary that runs has another runtime. No stored runtime changes.
Update ==
  /\ easel = 1
  /\ easel' = 2 /\ accepted' = FALSE
  /\ UNCHANGED <<kits, how, frame, saved, putSince>>

\* An agent puts the same document again on the current kit version. Its first use gives the kit
\* version the runtime of this easel. When the document is not the same, a new frame version.
Put ==
  LET r == IF kits[Current] = None THEN easel ELSE kits[Current]
      same == frame # 0 /\ (Same = "text" \/ Rt(frame) = r)
  IN /\ kits' = [kits EXCEPT ![Current] = r]
     /\ IF same
          THEN UNCHANGED <<frame, saved>>
          ELSE /\ frame' = Current /\ saved' = saved + 1
     /\ putSince' = TRUE
     /\ UNCHANGED <<easel, how, accepted>>

\* A change of the look: the next kit version, with the runtime of the one before.
Look ==
  /\ Current < MaxKit
  /\ kits' = Append(kits, kits[Current]) /\ how' = Append(how, "look")
  /\ UNCHANGED <<easel, frame, saved, accepted, putSince>>

\* The team accepts the runtime of this easel: one statement, only when it changes the runtime.
Accept ==
  /\ Current < MaxKit
  /\ kits[Current] \notin {None, easel}
  /\ kits' = Append(kits, easel) /\ how' = Append(how, "accept")
  /\ accepted' = TRUE /\ putSince' = FALSE
  /\ UNCHANGED <<easel, frame, saved>>

\* An accept with nothing to change: it answers unchanged and writes nothing.
AcceptUnchanged ==
  /\ kits[Current] \in {None, easel}
  /\ accepted' = TRUE /\ putSince' = FALSE
  /\ UNCHANGED <<easel, kits, how, frame, saved>>

Next == Update \/ Put \/ Look \/ Accept \/ AcceptUnchanged

Spec == Init /\ [][Next]_vars

\* ---------- rules, in the reader's words ----------

\* K11: a runtime that a kit version has never changes, after an update of easel too.
AStoredRuntimeNeverChanges ==
  [][\A k \in 1..Len(kits) : kits[k] # None => kits'[k] = kits[k]]_vars

\* A frame shows the runtime of its kit version until a put gives it a new version.
AFrameKeepsItsRuntimeUntilAPut == [][saved' = saved => Rt(frame)' = Rt(frame)]_vars

\* After the team accepts, the next put of an app frame gives it the runtime of this easel.
APutAfterAcceptGivesTheEaselRuntime == (accepted /\ putSince) => Rt(frame) = easel

\* An accepted kit version has another runtime than the one before it.
AnAcceptChangesTheRuntime ==
  \A k \in 2..Len(kits) : how[k] = "accept" => kits[k] # None /\ kits[k] # kits[k - 1]

\* A new frame version shows another document: the put of the same one writes nothing.
ANewVersionShowsAnotherDocument == [][saved' > saved => Rt(frame)' # Rt(frame)]_vars

TypeOK ==
  /\ easel \in Runtimes
  /\ kits \in Seq({None} \cup Runtimes) /\ Len(kits) \in 1..MaxKit
  /\ how \in Seq({"seed", "look", "accept"}) /\ Len(how) = Len(kits)
  /\ frame \in 0..MaxKit /\ saved \in Nat
  /\ accepted \in BOOLEAN /\ putSince \in BOOLEAN
====
