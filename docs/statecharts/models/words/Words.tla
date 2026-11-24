---- MODULE Words ----
\* SPEC-words.md § The texts in a frame: the live document of an HTML frame in one tab. Two
\* frames: `keyed` has an element with data-easel-text="k", and an own text; `plain` has an own
\* text only. The team text k has no vi text at revision 1, and has one at revision 2.
\*
\* The page composes a live HTML frame with the script of the texts only when the frame has a text
\* key, or the pick is not en. The document then shows the text of k in the pick, and marks each
\* text that it does not translate. A new version, a new revision of the texts or a new pick that
\* the document does not show gives a new document.
EXTENDS Naturals

CONSTANT KeyHasRev

Frames == {"keyed", "plain"}
Locales == {"en", "vi"}
None == <<0, 0, "none">>

VARIABLES
  version,  \* the version of `keyed`
  rev,      \* the revision of the texts of the team
  pick,     \* the locale that the person picked in the dock
  live,     \* live[f]: the frame has a live document in the tab
  doc,      \* doc[f]: the version, the revision and the locale that the document was composed with
  marked    \* marked[f]: the texts that the live document marks as not translated

vars == <<version, rev, pick, live, doc, marked>>

VersionOf(f) == IF f = "keyed" THEN version ELSE 1

HasKey(f) == f = "keyed"

GetsScript(f) == HasKey(f) \/ pick # "en"

Want(f) == IF GetsScript(f) THEN <<VersionOf(f), rev, pick>> ELSE <<VersionOf(f), 0, "en">>

Key(d) == IF KeyHasRev THEN d ELSE <<d[1], d[3]>>

HasVi(r) == r = 2

Marks(f, d) ==
  IF d[3] # "vi" THEN {}
  ELSE {"own"} \cup (IF HasKey(f) /\ ~HasVi(d[2]) THEN {"k"} ELSE {})

Compose(f) ==
  /\ doc' = [doc EXCEPT ![f] = Want(f)]
  /\ marked' = [marked EXCEPT ![f] = Marks(f, Want(f))]

Init ==
  /\ version = 1 /\ rev = 1 /\ pick = "en"
  /\ live = [f \in Frames |-> FALSE]
  /\ doc = [f \in Frames |-> None]
  /\ marked = [f \in Frames |-> {}]

GoLive(f) ==
  /\ ~live[f]
  /\ live' = [live EXCEPT ![f] = TRUE]
  /\ Compose(f)
  /\ UNCHANGED <<version, rev, pick>>

Recompose(f) ==
  /\ live[f] /\ Key(doc[f]) # Key(Want(f))
  /\ Compose(f)
  /\ UNCHANGED <<version, rev, pick, live>>

Leave(f) ==
  /\ live[f]
  /\ live' = [live EXCEPT ![f] = FALSE]
  /\ doc' = [doc EXCEPT ![f] = None]
  /\ marked' = [marked EXCEPT ![f] = {}]
  /\ UNCHANGED <<version, rev, pick>>

PickLocale(l) ==
  /\ l # pick
  /\ pick' = l
  /\ UNCHANGED <<version, rev, live, doc, marked>>

SetTexts ==
  /\ rev = 1
  /\ rev' = 2
  /\ UNCHANGED <<version, pick, live, doc, marked>>

NewVersion ==
  /\ version = 1
  /\ version' = 2
  /\ UNCHANGED <<rev, pick, live, doc, marked>>

Next ==
  \/ \E f \in Frames : GoLive(f) \/ Recompose(f) \/ Leave(f)
  \/ \E l \in Locales : PickLocale(l)
  \/ SetTexts \/ NewVersion

Spec == Init /\ [][Next]_vars /\ \A f \in Frames : WF_vars(Recompose(f))

\* ---------- rules, in the reader's words ----------

\* A frame with no text key in en has no script of the texts: a change of the texts cannot reach it.
APlainFrameInEnglishHasNoTexts == doc["plain"][3] = "en" => doc["plain"][2] = 0

\* A live document marks the texts that its inputs do not translate, and no other.
ADocumentMarksOnlyWhatItDoesNotTranslate ==
  \A f \in Frames : live[f] => marked[f] = Marks(f, doc[f])

\* A document in en has no mark.
EnglishHasNoMark == \A f \in Frames : doc[f][3] = "en" => marked[f] = {}

\* A live frame comes to show the current version, texts and pick, unless it leaves the view first.
ALiveFrameComesToShowTheTexts ==
  \A f \in Frames : (live[f] /\ doc[f] # Want(f)) ~> (~live[f] \/ doc[f] = Want(f))

TypeOK ==
  /\ version \in 1..2 /\ rev \in 1..2 /\ pick \in Locales
  /\ live \in [Frames -> BOOLEAN]
  /\ doc \in [Frames -> ((0..2) \X (0..2) \X (Locales \cup {"none"}))]
  /\ marked \in [Frames -> SUBSET {"own", "k"}]
====
