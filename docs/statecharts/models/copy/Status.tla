---- MODULE Status ----
\* easel copy: the status of one app frame (SPEC-copy.md, Exploring and ready).
\* A frame is exploring until an agent marks it ready. An exploring frame may
\* have its own text and a color off the look. A ready frame settled them: each
\* text key that it uses is in the texts of the team, it has no text of its own,
\* and its colors are in the look.
\*
\* The frame is one frame: two frames do not share a status. The texts of the
\* team have two text keys. The current version of the frame is three facts:
\* the text keys that it uses, an own text, and a color off the look.
\*
\* A put on a ready frame (or a put with ready) applies the fixes by position:
\* a color off the look gets the class of the look. A text has no fix, so an own
\* text or a text key that the team does not have refuses that put.
\*
\* CanRemove is the rule of the texts: no call removes a text key. With
\* CanRemove = TRUE, a change of the texts removes one, and the second config
\* shows what breaks.
EXTENDS Naturals, FiniteSets

CONSTANT CanRemove

Keys == {"trial.start", "people.empty"}

VARIABLES
  status,   \* "none" (not made) | "exploring" | "ready"
  uses,     \* the text keys that the current version uses
  own,      \* the current version has a text of its own
  offLook,  \* the current version has a color that is not in the look
  team,     \* the text keys of the texts of the team
  looks     \* how many changes of the look were made (0..1)

vars == <<status, uses, own, offLook, team, looks>>

TypeOK ==
  /\ status \in {"none", "exploring", "ready"}
  /\ uses \subseteq Keys /\ team \subseteq Keys
  /\ own \in BOOLEAN /\ offLook \in BOOLEAN
  /\ looks \in 0..1

Settled == uses \subseteq team /\ ~own /\ ~offLook

Init ==
  /\ status = "none" /\ uses = {} /\ own = FALSE /\ offLook = FALSE
  /\ team = {} /\ looks = 0

\* ---- The frame ----

\* A put that does not ask for ready, on a new or an exploring frame: easel
\* keeps the version as the agent wrote it.
AnExploringPut(u, o, c) ==
  /\ status \in {"none", "exploring"}
  /\ status' = "exploring"
  /\ uses' = u /\ own' = o /\ offLook' = c
  /\ UNCHANGED <<team, looks>>

\* A put on a ready frame, or a put with ready: the fixes make each color a
\* color of the look. With an own text or a text key that the team does not
\* have, the put is refused (unsettled) and nothing changes.
AReadyPut(u, o, c) ==
  /\ u \subseteq team /\ ~o
  /\ status' = "ready"
  /\ uses' = u /\ own' = FALSE /\ offLook' = FALSE
  /\ UNCHANGED <<team, looks>>

AReadyPutIsRefused(u, o, c) ==
  /\ ~(u \subseteq team /\ ~o)
  /\ UNCHANGED vars

AnAgentMarksTheFrameReady ==
  /\ status = "exploring" /\ Settled
  /\ status' = "ready"
  /\ UNCHANGED <<uses, own, offLook, team, looks>>

TheMarkIsRefused ==
  /\ status = "exploring" /\ ~Settled
  /\ UNCHANGED vars

AnAgentExploresAgain ==
  /\ status = "ready"
  /\ status' = "exploring"
  /\ UNCHANGED <<uses, own, offLook, team, looks>>

\* ---- The texts and the look ----

AUserAddsAText(k) ==
  /\ k \notin team
  /\ team' = team \union {k}
  /\ UNCHANGED <<status, uses, own, offLook, looks>>

AUserRemovesAText(k) ==
  /\ CanRemove /\ k \in team
  /\ team' = team \ {k}
  /\ UNCHANGED <<status, uses, own, offLook, looks>>

\* The names of the look are fixed: a change gives new values to the same names.
\* So a color of the look stays a color of the look.
AUserChangesTheLook ==
  /\ looks = 0
  /\ looks' = 1
  /\ UNCHANGED <<status, uses, own, offLook, team>>

Next ==
  \/ \E u \in SUBSET Keys, o \in BOOLEAN, c \in BOOLEAN :
       \/ AnExploringPut(u, o, c)
       \/ AReadyPut(u, o, c)
       \/ (status # "none" /\ AReadyPutIsRefused(u, o, c))
  \/ AnAgentMarksTheFrameReady \/ TheMarkIsRefused \/ AnAgentExploresAgain
  \/ \E k \in Keys : AUserAddsAText(k) \/ AUserRemovesAText(k)
  \/ AUserChangesTheLook

Spec == Init /\ [][Next]_vars

\* ---- Rules, in the reader's words ----

\* "A ready frame has no finding of the settle rules in its current version."
AReadyFrameIsSettled == status = "ready" => Settled

\* "A ready frame shows each text from the texts of the team."
AReadyFrameUsesOnlyTeamTexts == status = "ready" => uses \subseteq team

\* "An exploring frame keeps what the agent wrote": it may be unsettled.
====
