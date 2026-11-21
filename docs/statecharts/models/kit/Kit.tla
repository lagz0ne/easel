---- MODULE Kit ----
\* SPEC-kit.md: the look and the kit of one easel, and their kit versions.
\* Each change of the look or of a piece is one conditional write on the revision that its writer
\* read (as frame.put on a frame version). It makes one new kit version, which holds the CSS made
\* for it (A+T: the Tailwind theme, the base and the pieces). A kit version never changes after it
\* is written. Frames are not written: each frame shows the current kit version.
\* A request keeps the kit version that the viewer saw when they asked, so its Before shows it.
\*
\* Part = "piece" (chart kit-piece): two agents change one piece at the same time (K13, K14).
\* Part = "look"  (chart kit-look): a user changes the look, a change that fails WCAG AA is
\* refused (K8), the user goes back one step (K9), and a viewer asks for a change (K10).
\* KeepKit = FALSE (chart kit-look-unbound) is the design this rules out: a request keeps only the
\* frame version, so its Before is drawn with the current kit version. It breaks K10.
EXTENDS Naturals, Sequences

CONSTANTS Part, KeepKit

Agents == IF Part = "piece" THEN {"A", "B"} ELSE {"U"}
Looks == {"L1", "L2", "Low"}         \* "Low" makes text fail WCAG AA contrast
Readable == {"L1", "L2"}
Docs == {"p1", "p2"}                 \* two texts of one piece (its CSS and template)
MaxKit == IF Part = "piece" THEN 3 ELSE 4   \* model bound: no kit version past this

VARIABLES
  look,      \* the stored look
  prevLook,  \* the look before the last change of the look ("-": none yet)
  lookRev,   \* the revision of the look
  piece,     \* the stored piece
  pieceRev,  \* the revision of the piece
  hist,      \* the kit versions: hist[n] is the look and the piece of kit version n
  base,      \* base[a]: the revision that writer a last read (0: none, or it must read again)
  shown,     \* the kit version that an open tab shows (0: no board read yet)
  asked,     \* the kit version that a request keeps from when the viewer asked (0: no request)
  seen       \* what the viewer saw when they asked: [look, piece] ("-" before)

vars == <<look, prevLook, lookRev, piece, pieceRev, hist, base, shown, asked, seen>>
kit == Len(hist)                     \* the current kit version
rev == IF Part = "piece" THEN pieceRev ELSE lookRev
Snap(l, p) == [look |-> l, piece |-> p]

Init ==
  \* The first start writes the seed: kit version 1, a complete look and kit (K1).
  /\ look = "L1" /\ prevLook = "-" /\ lookRev = 1
  /\ piece = "p1" /\ pieceRev = 1
  /\ hist = << Snap("L1", "p1") >>
  /\ base = [a \in Agents |-> 0]
  /\ shown = 0 /\ asked = 0 /\ seen = "-"

\* easel kit get <piece> / easel look get: the writer reads the current revision.
Read(a) ==
  /\ base[a] # rev
  /\ base' = [base EXCEPT ![a] = rev]
  /\ UNCHANGED <<look, prevLook, lookRev, piece, pieceRev, hist, shown, asked, seen>>

CanWrite(a) == base[a] # 0 /\ kit < MaxKit

\* easel kit put <piece> --base <rev>: one conditional write
\*   UPDATE pieces SET ..., rev = rev + 1 WHERE name = ? AND rev = :base AND (...) IS NOT (...)
\* and, in the same transaction, the new kit version.
PutPiece(a, d) ==
  /\ Part = "piece" /\ CanWrite(a) /\ base[a] = pieceRev /\ d # piece
  /\ piece' = d /\ pieceRev' = pieceRev + 1
  /\ hist' = Append(hist, Snap(look, d))
  /\ base' = [base EXCEPT ![a] = pieceRev + 1]
  /\ UNCHANGED <<look, prevLook, lookRev, shown, asked, seen>>

\* A write on an old revision answers stale and writes nothing. The writer must read again.
PutStale(a) ==
  /\ base[a] # 0 /\ base[a] # rev
  /\ base' = [base EXCEPT ![a] = 0]
  /\ UNCHANGED <<look, prevLook, lookRev, piece, pieceRev, hist, shown, asked, seen>>

\* easel look set --base <rev>: a readable look is saved as a new kit version.
SetLook(a, l) ==
  /\ Part = "look" /\ CanWrite(a) /\ base[a] = lookRev /\ l # look /\ l \in Readable
  /\ look' = l /\ prevLook' = look /\ lookRev' = lookRev + 1
  /\ hist' = Append(hist, Snap(l, piece))
  /\ base' = [base EXCEPT ![a] = lookRev + 1]
  /\ UNCHANGED <<piece, pieceRev, shown, asked, seen>>

\* A look that fails WCAG AA answers unreadable, with each failing pair. Nothing changes.
SetLookUnreadable(a, l) ==
  /\ Part = "look" /\ CanWrite(a) /\ base[a] = lookRev /\ l \notin Readable
  /\ UNCHANGED vars

\* easel look undo --base <rev>: one step back, to the look before the last change of the look.
\* It is a new kit version (as git revert), so no kit version is removed or changed.
Undo(a) ==
  /\ Part = "look" /\ CanWrite(a) /\ base[a] = lookRev /\ prevLook # "-"
  /\ look' = prevLook /\ prevLook' = look /\ lookRev' = lookRev + 1
  /\ hist' = Append(hist, Snap(prevLook, piece))
  /\ base' = [base EXCEPT ![a] = lookRev + 1]
  /\ UNCHANGED <<piece, pieceRev, shown, asked, seen>>

\* The board's cell `kit` reaches an open tab, which shows the newest kit version in each frame.
TabShows ==
  /\ shown # kit
  /\ shown' = kit
  /\ UNCHANGED <<look, prevLook, lookRev, piece, pieceRev, hist, base, asked, seen>>

\* A viewer asks for a change. The request keeps the kit version that the tab shows.
Ask ==
  /\ Part = "look" /\ shown # 0 /\ asked = 0
  /\ asked' = shown /\ seen' = hist[shown]
  /\ UNCHANGED <<look, prevLook, lookRev, piece, pieceRev, hist, base, shown>>

Done ==
  /\ kit = MaxKit /\ shown = kit
  /\ UNCHANGED vars

Next ==
  \/ TabShows \/ Ask \/ Done
  \/ \E a \in Agents :
       \/ Read(a) \/ PutStale(a) \/ Undo(a)
       \/ \E d \in Docs : PutPiece(a, d)
       \/ \E l \in Looks : SetLook(a, l) \/ SetLookUnreadable(a, l)

Spec == Init /\ [][Next]_vars

\* ---------- rules, in the reader's words ----------

\* K14: a write on an old revision of a piece is never saved, so no change is lost.
AChangeOnAnOldRevisionIsNeverSaved ==
  [][pieceRev' # pieceRev => \E a \in Agents : base[a] = pieceRev /\ base'[a] = pieceRev + 1]_vars

\* K14: a stale or unreadable answer writes nothing.
ARefusalWritesNothing ==
  [][\A a \in Agents, l \in Looks :
       (PutStale(a) \/ SetLookUnreadable(a, l)) => UNCHANGED <<look, piece, hist>>]_vars

\* K7, K13: each change of the look or of a piece makes exactly one new kit version.
EachChangeMakesOneKitVersion ==
  [][(look' # look \/ piece' # piece) => Len(hist') = Len(hist) + 1]_vars

\* The current kit version holds the stored look and piece.
TheNewestKitVersionIsTheStoredOne == hist[kit] = Snap(look, piece)

\* K10, K11: a kit version never changes after it is written. Nothing removes one.
AKitVersionNeverChanges ==
  [][Len(hist') >= Len(hist) /\ \A i \in 1..Len(hist) : hist'[i] = hist[i]]_vars

\* K8: no stored look fails WCAG AA, in any kit version.
NoStoredLookIsUnreadable == \A i \in 1..Len(hist) : hist[i].look \in Readable

\* K9: one step back gives the look from before the last change of the look.
UndoGivesTheLookBefore ==
  [][\A a \in Agents : Undo(a) => look' = prevLook /\ hist'[Len(hist')].look = prevLook]_vars

\* K7: a tab shows only a stored kit version, and never goes back to an older one.
ATabShowsOnlyAStoredKitVersion == shown <= kit
ATabNeverGoesBack == [][shown' >= shown]_vars

\* K10: the Before of a request shows the look and the kit that the viewer saw when they asked,
\* after any later change.
before == IF KeepKit THEN hist[asked] ELSE hist[kit]
TheBeforeShowsWhatTheViewerSaw == asked # 0 => before = seen

TypeOK ==
  /\ look \in Readable /\ piece \in Docs
  /\ prevLook \in Readable \cup {"-"}
  /\ kit \in 1..MaxKit /\ shown \in 0..MaxKit /\ asked \in 0..MaxKit
====
