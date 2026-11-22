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
\*
\* Part = "look" also has one live document of the tab (K7; SPEC-kit.md § compose). It is composed
\* with the kit version that the tab shows, and it can start before the page listens. Its piece
\* script says hello to its parent at once, and with Hello = "each50ms" again each 50 ms until it
\* gets a port. The page answers a hello with a port and the current kit; each later kit goes on
\* the port, so the document shows it with no reload. Hello = "once" (chart kit-look-hello-once)
\* is the design this rules out: a document that says hello once, before the page listens, never
\* gets a port, and keeps an old look after a change. It breaks K7.
EXTENDS Naturals, Sequences

CONSTANTS Part, KeepKit, Hello

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
  seen,      \* what the viewer saw when they asked: [look, piece] ("-" before)
  listens,   \* the page listens for the hello of its live documents
  doc,       \* the tab's live document: "none" (not started yet) or "live"
  port,      \* the live document holds a port from the page
  docKit     \* the kit version that the live document shows (0: none)

store == <<look, prevLook, lookRev, piece, pieceRev, hist, base>>
live == <<listens, doc, port, docKit>>
vars == <<look, prevLook, lookRev, piece, pieceRev, hist, base, shown, asked, seen, listens, doc, port, docKit>>
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
  /\ listens = FALSE /\ doc = "none" /\ port = FALSE /\ docKit = 0

\* easel kit get <piece> / easel look get: the writer reads the current revision.
Read(a) ==
  /\ base[a] # rev
  /\ base' = [base EXCEPT ![a] = rev]
  /\ UNCHANGED <<look, prevLook, lookRev, piece, pieceRev, hist, shown, asked, seen>> /\ UNCHANGED live

CanWrite(a) == base[a] # 0 /\ kit < MaxKit

\* easel kit put <piece> --base <rev>: one conditional write
\*   UPDATE pieces SET ..., rev = rev + 1 WHERE name = ? AND rev = :base AND (...) IS NOT (...)
\* and, in the same transaction, the new kit version.
PutPiece(a, d) ==
  /\ Part = "piece" /\ CanWrite(a) /\ base[a] = pieceRev /\ d # piece
  /\ piece' = d /\ pieceRev' = pieceRev + 1
  /\ hist' = Append(hist, Snap(look, d))
  /\ base' = [base EXCEPT ![a] = pieceRev + 1]
  /\ UNCHANGED <<look, prevLook, lookRev, shown, asked, seen>> /\ UNCHANGED live

\* A write on an old revision answers stale and writes nothing. The writer must read again.
PutStale(a) ==
  /\ base[a] # 0 /\ base[a] # rev
  /\ base' = [base EXCEPT ![a] = 0]
  /\ UNCHANGED <<look, prevLook, lookRev, piece, pieceRev, hist, shown, asked, seen>> /\ UNCHANGED live

\* easel look set --base <rev>: a readable look is saved as a new kit version.
SetLook(a, l) ==
  /\ Part = "look" /\ CanWrite(a) /\ base[a] = lookRev /\ l # look /\ l \in Readable
  /\ look' = l /\ prevLook' = look /\ lookRev' = lookRev + 1
  /\ hist' = Append(hist, Snap(l, piece))
  /\ base' = [base EXCEPT ![a] = lookRev + 1]
  /\ UNCHANGED <<piece, pieceRev, shown, asked, seen>> /\ UNCHANGED live

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
  /\ UNCHANGED <<piece, pieceRev, shown, asked, seen>> /\ UNCHANGED live

\* The board's cell `kit` reaches an open tab, which shows the newest kit version in each frame.
\* The page sends the kit on the port of each live document that has one: its piece script
\* replaces the two style texts, with no reload.
TabShows ==
  /\ shown # kit
  /\ shown' = kit
  /\ docKit' = IF port THEN kit ELSE docKit
  /\ UNCHANGED store /\ UNCHANGED <<asked, seen, listens, doc, port>>

\* The page starts to listen for hellos (its message handler). A document can start before it.
PageListens ==
  /\ Part = "look" /\ ~listens
  /\ listens' = TRUE
  /\ UNCHANGED store /\ UNCHANGED <<shown, asked, seen, doc, port, docKit>>

\* The answer to a hello: only when the page listens, a port and the current kit, at once.
Answer ==
  /\ port' = listens
  /\ docKit' = shown

\* A live document starts, composed with the kit version that the tab shows. Its piece script
\* says hello at once.
DocStarts ==
  /\ Part = "look" /\ doc = "none" /\ shown # 0
  /\ doc' = "live"
  /\ Answer
  /\ UNCHANGED store /\ UNCHANGED <<shown, asked, seen, listens>>

\* The piece script says hello again, 50 ms later, while it has no port (as penpal does). With
\* Hello = "once" it never says it again.
HelloAgain ==
  /\ Hello = "each50ms" /\ doc = "live" /\ ~port /\ listens
  /\ Answer
  /\ UNCHANGED store /\ UNCHANGED <<shown, asked, seen, listens, doc>>

\* A viewer asks for a change. The request keeps the kit version that the tab shows.
Ask ==
  /\ Part = "look" /\ shown # 0 /\ asked = 0
  /\ asked' = shown /\ seen' = hist[shown]
  /\ UNCHANGED <<look, prevLook, lookRev, piece, pieceRev, hist, base, shown>> /\ UNCHANGED live

Done ==
  /\ kit = MaxKit /\ shown = kit
  /\ UNCHANGED vars

Next ==
  \/ TabShows \/ Ask \/ Done \/ PageListens \/ DocStarts \/ HelloAgain
  \/ \E a \in Agents :
       \/ Read(a) \/ PutStale(a) \/ Undo(a)
       \/ \E d \in Docs : PutPiece(a, d)
       \/ \E l \in Looks : SetLook(a, l) \/ SetLookUnreadable(a, l)

\* A tab gets each change of the cell `kit`, the page listens in the end, and a piece script that
\* has no port says hello again: each of them is not put off forever.
Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(TabShows) /\ WF_vars(PageListens) /\ WF_vars(HelloAgain)

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

\* K7: a live document shows only a stored kit version, and never goes back to an older one.
ADocumentShowsOnlyAStoredKitVersion == docKit <= kit
ADocumentNeverGoesBack == [][doc = "live" => docKit' >= docKit]_vars

\* K7: each live document comes to show the newest kit version, with no reload: the page answers
\* its hello with a port, and sends each later kit on it. A document that started before the page
\* listened is not left behind.
ALiveDocumentShowsTheNewLook == <>[](doc = "live" => docKit = kit)

TypeOK ==
  /\ look \in Readable /\ piece \in Docs
  /\ prevLook \in Readable \cup {"-"}
  /\ kit \in 1..MaxKit /\ shown \in 0..MaxKit /\ asked \in 0..MaxKit
  /\ listens \in BOOLEAN /\ doc \in {"none", "live"} /\ port \in BOOLEAN /\ docKit \in 0..MaxKit
====
