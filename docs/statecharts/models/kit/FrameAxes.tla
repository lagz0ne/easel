---- MODULE FrameAxes ----
\* SPEC-kit.md § The capsules, "The axes in the viewer": the locale and the data state of the
\* capsule frames of one canvas, in one tab. Two frames: `cap` is a capsule frame, `plain` is an
\* HTML frame or an app frame with no capsule.
\*
\* A capsule frame tells the page what it can show: when it gets its port, it posts its axes (the
\* locales, and the values of its capsule's config). The page keeps them for that frame version.
\* The locale is one pick for the canvas; the data state is a pick for each frame. The page
\* composes a frame with the picks only after that frame version posted its axes, and only with
\* the values that it posted. A pick that differs from the live document gives a new document:
\* the frame draws in a new scope (the same path as a new version, chart kit-app-frame). A new
\* version can drop a data state: a pick of it falls back to the frame's default.
\* Version 1 of `cap` has the data states many and empty; version 2 has only many.
EXTENDS Naturals

Frames == {"cap", "plain"}
Locales == {"en", "vi"}
States(v) == IF v = 1 THEN {"many", "empty"} ELSE {"many"}
Default == <<"en", "default">>

VARIABLES
  version,  \* the version of `cap`
  live,     \* live[f]: the frame has a live document in the tab
  offered,  \* offered[f]: the frame version posted its axes, and the page keeps them
  locale,   \* the locale that the person picked for the canvas
  state,    \* the data state that the person picked for `cap` ("default": none picked)
  docAxes   \* docAxes[f]: the locale and the data state that the live document was composed with

vars == <<version, live, offered, locale, state, docAxes>>

\* The axes that the page composes a frame with: the picks, once the frame version posted its axes.
Want(f) == IF offered[f] THEN <<locale, IF f = "cap" THEN state ELSE "default">> ELSE Default

Init ==
  /\ version = 1
  /\ live = [f \in Frames |-> FALSE]
  /\ offered = [f \in Frames |-> FALSE]
  /\ locale = "en" /\ state = "default"
  /\ docAxes = [f \in Frames |-> Default]

\* The frame comes into view at rest: the page composes its document with the axes it wants.
GoLive(f) ==
  /\ ~live[f]
  /\ live' = [live EXCEPT ![f] = TRUE]
  /\ docAxes' = [docAxes EXCEPT ![f] = Want(f)]
  /\ UNCHANGED <<version, offered, locale, state>>

\* The capsule frame gets its port and posts its axes. A frame with no capsule posts none.
Offer ==
  /\ live["cap"] /\ ~offered["cap"]
  /\ offered' = [offered EXCEPT !["cap"] = TRUE]
  /\ UNCHANGED <<version, live, locale, state, docAxes>>

\* The person picks a locale for the canvas: the control shows once a frame posted its axes.
PickLocale(l) ==
  /\ \E f \in Frames : offered[f]
  /\ l # locale
  /\ locale' = l
  /\ UNCHANGED <<version, live, offered, state, docAxes>>

\* The person picks a data state of `cap`, from the values that this version posted.
PickState(s) ==
  /\ offered["cap"] /\ s \in States(version) /\ s # state
  /\ state' = s
  /\ UNCHANGED <<version, live, offered, locale, docAxes>>

\* The live document differs from the picks: the page composes a new one (a new scope).
Recompose(f) ==
  /\ live[f] /\ docAxes[f] # Want(f)
  /\ docAxes' = [docAxes EXCEPT ![f] = Want(f)]
  /\ UNCHANGED <<version, live, offered, locale, state>>

\* An agent puts version 2 of `cap`: a new document with no axes yet; a dropped pick falls back.
NewVersion ==
  /\ version = 1
  /\ version' = 2
  /\ offered' = [offered EXCEPT !["cap"] = FALSE]
  /\ state' = IF state \in States(2) THEN state ELSE "default"
  /\ docAxes' = [docAxes EXCEPT !["cap"] = Default]
  /\ UNCHANGED <<live, locale>>

\* The frame leaves the view at rest: its document goes; the page keeps its axes and the picks.
Leave(f) ==
  /\ live[f]
  /\ live' = [live EXCEPT ![f] = FALSE]
  /\ docAxes' = [docAxes EXCEPT ![f] = Default]
  /\ UNCHANGED <<version, offered, locale, state>>

Next ==
  \/ \E f \in Frames : GoLive(f)
  \/ \E f \in Frames : Recompose(f)
  \/ \E f \in Frames : Leave(f)
  \/ Offer \/ NewVersion
  \/ \E l \in Locales : PickLocale(l)
  \/ \E s \in {"many", "empty"} : PickState(s)

\* A live capsule frame posts its axes, and the page composes again when the picks differ.
Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(Offer) /\ \A f \in Frames : WF_vars(Recompose(f))

\* ---------- rules, in the reader's words ----------

\* A frame that posts no axes is never composed again for a pick: a pick does not reload it.
APlainFrameIgnoresThePicks == docAxes["plain"] = Default

\* A document shows only a data state that its version posted.
ADocumentShowsOnlyOfferedValues == docAxes["cap"][2] \in States(version) \cup {"default"}

\* The pick of a data state is always one that the current version has, or none.
APickIsAValueOfTheVersion == state \in States(version) \cup {"default"}

\* A live frame whose document differs from the picks comes to show them, unless it leaves first.
ALiveFrameComesToShowThePicks ==
  \A f \in Frames :
    (live[f] /\ docAxes[f] # Want(f)) ~> (~live[f] \/ docAxes[f] = Want(f))

TypeOK ==
  /\ version \in 1..2
  /\ live \in [Frames -> BOOLEAN] /\ offered \in [Frames -> BOOLEAN]
  /\ locale \in Locales /\ state \in {"many", "empty", "default"}
  /\ docAxes \in [Frames -> Locales \X {"many", "empty", "default"}]
====
