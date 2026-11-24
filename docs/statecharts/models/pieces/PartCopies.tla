---- MODULE PartCopies ----
\* easel pieces base: a part of the design system and its copies in HTML frames
\* (SPEC-pieces-base.md). The part P has one source frame, its main, on the canvas
\* design-system. Frame "a" on the canvas product holds a copy of P. Frame "o" holds no copy.
\* Each frame is live in one tab.
\*
\* The main and the part: a put of the source frame writes a new main. The publish then writes
\* a new kit version with the next revision of P. The put and the publish are two writes, so a
\* publish can come late (a restart between them): each start publishes a main that is not yet
\* in the kit. A change of the look also makes a new kit version, with the same revision of P.
\*
\* The copy is a link: easel puts the part of the current kit version in it when it gives the
\* document to the tab. After a publish, the tab loads a new document for frame "a" only. The
\* page keeps the old iframe until the new one draws. An agent can put a new version of frame
\* "a" at any time.
\*
\* A request keeps the kit version of the tab. Its picture shows the copy with the part of that
\* kit version. With PartsInKit = FALSE, the picture takes the part of the current kit version,
\* and the second config shows what breaks.
EXTENDS Naturals

CONSTANTS PartsInKit, MaxKit, MaxRev

Kits == 1..MaxKit
Revs == 1..MaxRev

VARIABLES
  main,     \* the revision of P that the source frame holds now
  kit,      \* the current kit version
  revAt,    \* the revision of P in each kit version (0: no such kit version yet)
  shown,    \* the revision of P that the copy in frame "a" shows in the tab
  loading,  \* the revision of P in the new document of frame "a" that loads, or 0
  other,    \* the count of new documents that frame "o" got
  kept      \* the kit version that a request keeps, or 0 for no request

vars == <<main, kit, revAt, shown, loading, other, kept>>

Rev == revAt[kit]

TypeOK ==
  /\ main \in Revs /\ kit \in Kits
  /\ revAt \in [Kits -> Revs \union {0}]
  /\ shown \in Revs /\ loading \in Revs \union {0}
  /\ other \in Nat /\ kept \in Kits \union {0}

Init ==
  /\ main = 1 /\ kit = 1
  /\ revAt = [k \in Kits |-> IF k = 1 THEN 1 ELSE 0]
  /\ shown = 1 /\ loading = 0 /\ other = 0 /\ kept = 0

\* ---- The design system ----

\* An agent changes the main of P on design-system: a new version of the source frame.
AnAgentPutsTheMain ==
  /\ main < MaxRev
  /\ main' = main + 1
  /\ UNCHANGED <<kit, revAt, shown, loading, other, kept>>

\* The publish: a new kit version with the main as the next revision of P. The tab loads a new
\* document for each frame with a copy of P, and for no other frame.
ThePartIsPublished ==
  /\ main # Rev /\ kit < MaxKit
  /\ kit' = kit + 1
  /\ revAt' = [revAt EXCEPT ![kit + 1] = main]
  /\ loading' = main
  /\ UNCHANGED <<main, shown, other, kept>>

\* A person changes the look: a new kit version, with the same revision of P. The look goes to
\* each tab as a message, with no new document.
APersonChangesTheLook ==
  /\ kit < MaxKit
  /\ kit' = kit + 1
  /\ revAt' = [revAt EXCEPT ![kit + 1] = Rev]
  /\ UNCHANGED <<main, shown, loading, other, kept>>

\* ---- The frames ----

\* An agent puts a new version of frame "a". Its document has the part of the current kit.
AnAgentPutsTheCopyFrame ==
  /\ loading' = Rev
  /\ UNCHANGED <<main, kit, revAt, shown, other, kept>>

\* The new iframe of frame "a" draws, and the page removes the old one.
TheNewDocumentDraws ==
  /\ loading # 0
  /\ shown' = loading /\ loading' = 0
  /\ UNCHANGED <<main, kit, revAt, other, kept>>

\* A person asks for a change on frame "a". The request keeps the kit version of the tab.
APersonAsks ==
  /\ kept = 0
  /\ kept' = kit
  /\ UNCHANGED <<main, kit, revAt, shown, loading, other>>

Next ==
  \/ AnAgentPutsTheMain \/ ThePartIsPublished \/ APersonChangesTheLook
  \/ AnAgentPutsTheCopyFrame \/ TheNewDocumentDraws \/ APersonAsks

\* easel publishes each main (at the put, or at the next start), and the page draws each new
\* document. The agents and the person need no fairness.
Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(ThePartIsPublished) /\ WF_vars(TheNewDocumentDraws)

\* The picture of the request: the copy with the part of its kit version, or of the current one.
Picture == IF PartsInKit THEN revAt[kept] ELSE Rev

\* ---- Rules, in the reader's words ----

\* "A change of the main reaches the part": the part is the main in the end.
TheMainReachesThePart == <>[](Rev = main \/ kit = MaxKit)

\* "A change of a part reaches each copy": the copy shows the part of the current kit in the end.
EachCopyShowsTheCurrentPart == <>[](shown = Rev)

\* "A frame with no copy of the part keeps its document."
AFrameWithNoCopyKeepsItsDocument == other = 0

\* "A request shows the part as the person saw it": its picture has the part of its kit version.
ARequestShowsThePartOfItsKit == kept # 0 => Picture = revAt[kept]
====
