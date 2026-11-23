---- MODULE DesignChange ----
\* easel pieces: a change of the design system (SPEC-pieces.md § A change of the design system,
\* rules 17-19). The design system has one capsule C. Frame "r" (ready) and frame "e"
\* (exploring) depend on C. Frame "o" depends on no capsule that changes. Each frame is live in
\* one tab.
\*
\* The shape of C is "a" or "b". A design.put that breaks changes the shape (a prop is renamed);
\* a design.put that does not break keeps it. The current version of a frame is written for one
\* shape: it has a type error when the kit has the other one.
\*
\* A design.put is two steps: it checks the new folder and each frame that depends on C, then it
\* writes the new kit version. A frame put comes between them at any time. The write compares the
\* frames that it checked with the frames now (their versions): if one changed, it checks again.
\* A frame put, a mark and the write of a design.put are each one write; a frame put checks
\* against the current kit version.
\*
\* After the write, each live frame that depends on C and passes the check gets a new document.
\* The page keeps the old iframe until the new one draws. An exploring frame with a type error
\* keeps its last good document until a put fixes it.
\*
\* CheckReady is rule 17: a ready frame with a type error refuses the put (breaks). With
\* CheckReady = FALSE the put does not check the ready frames, and the second config shows what
\* breaks.
EXTENDS Naturals

CONSTANTS CheckReady, MaxKit

Shapes == {"a", "b"}
Uses == {"r", "e"}
Live == {"r", "e", "o"}
Kits == 1..MaxKit

VARIABLES
  kit,      \* the current kit version
  shape,    \* the shape of C in the current kit version
  code,     \* the shape that the current version of each frame in Uses is written for
  status,   \* "ready" or "exploring", for each frame in Uses
  put,      \* the design.put in work: "none", or the shape of C in its new folder
  seen,     \* the frames (code and status) that the design.put checked
  doc,      \* the kit version of the document that each live frame draws
  next      \* the kit version of the new document that loads, or 0

vars == <<kit, shape, code, status, put, seen, doc, next>>

Fits(f, s) == code[f] = s
Fit(f) == Fits(f, shape)

TypeOK ==
  /\ kit \in Kits /\ shape \in Shapes
  /\ code \in [Uses -> Shapes] /\ status \in [Uses -> {"ready", "exploring"}]
  /\ put \in Shapes \union {"none"}
  /\ seen \in [code : [Uses -> Shapes], status : [Uses -> {"ready", "exploring"}]]
  /\ doc \in [Live -> Kits] /\ next \in [Live -> Kits \union {0}]

Init ==
  /\ kit = 1 /\ shape = "a"
  /\ code = [f \in Uses |-> "a"]
  /\ status = [f \in Uses |-> IF f = "r" THEN "ready" ELSE "exploring"]
  /\ put = "none"
  /\ seen = [code |-> code, status |-> status]
  /\ doc = [f \in Live |-> 1] /\ next = [f \in Live |-> 0]

\* ---- design.put ----

\* An agent sends a new folder, with the shape of C in it. easel checks it and each frame that
\* depends on C.
ADesignPutStarts(s) ==
  /\ put = "none" /\ kit < MaxKit
  /\ put' = s
  /\ seen' = [code |-> code, status |-> status]
  /\ UNCHANGED <<kit, shape, code, status, doc, next>>

\* The frames that the check saw: a ready one written for another shape breaks.
Breaks(s) == \E f \in Uses : seen.status[f] = "ready" /\ seen.code[f] # s
Checked == seen = [code |-> code, status |-> status]

\* A ready frame has a type error against the new folder: the answer is breaks, and nothing is
\* written.
TheDesignPutBreaks ==
  /\ put # "none" /\ Checked /\ CheckReady /\ Breaks(put)
  /\ put' = "none"
  /\ UNCHANGED <<kit, shape, code, status, seen, doc, next>>

\* A frame changed after the check: easel checks again.
TheDesignPutChecksAgain ==
  /\ put # "none" /\ ~Checked
  /\ seen' = [code |-> code, status |-> status]
  /\ UNCHANGED <<kit, shape, code, status, put, doc, next>>

\* The write: a new kit version. Each live frame that depends on C and has no type error gets a
\* new document. An exploring frame with a type error keeps its document.
TheDesignPutWrites ==
  /\ put # "none" /\ Checked /\ ~(CheckReady /\ Breaks(put))
  /\ kit' = kit + 1 /\ shape' = put /\ put' = "none"
  /\ next' = [f \in Live |-> IF f \in Uses /\ Fits(f, put) THEN kit + 1 ELSE next[f]]
  /\ UNCHANGED <<code, status, seen, doc>>

\* ---- A frame put and a mark, at the same time ----

\* A frame put with no type error against the current kit version: a fix, or a new version
\* for the same shape. Its new version gets a new document. A put with a type error is refused
\* in each mode, and changes nothing.
AFramePut(f, s) ==
  /\ s = shape
  /\ code' = [code EXCEPT ![f] = s]
  /\ next' = [next EXCEPT ![f] = kit]
  /\ UNCHANGED <<kit, shape, status, put, seen, doc>>

AnAgentMarksTheFrameReady(f) ==
  /\ status[f] = "exploring" /\ Fit(f)
  /\ status' = [status EXCEPT ![f] = "ready"]
  /\ UNCHANGED <<kit, shape, code, put, seen, doc, next>>

AnAgentMarksTheFrameExploring(f) ==
  /\ status[f] = "ready"
  /\ status' = [status EXCEPT ![f] = "exploring"]
  /\ UNCHANGED <<kit, shape, code, put, seen, doc, next>>

\* ---- The page ----

\* The new iframe draws, and the page removes the old one.
TheNewDocumentDraws(f) ==
  /\ next[f] # 0
  /\ doc' = [doc EXCEPT ![f] = next[f]]
  /\ next' = [next EXCEPT ![f] = 0]
  /\ UNCHANGED <<kit, shape, code, status, put, seen>>

Next ==
  \/ \E s \in Shapes : ADesignPutStarts(s)
  \/ TheDesignPutBreaks \/ TheDesignPutChecksAgain \/ TheDesignPutWrites
  \/ \E f \in Uses, s \in Shapes : AFramePut(f, s)
  \/ \E f \in Uses : AnAgentMarksTheFrameReady(f) \/ AnAgentMarksTheFrameExploring(f)
  \/ \E f \in Live : TheNewDocumentDraws(f)

\* easel ends each design.put that it started, and the page draws each new document. The agents
\* need no fairness: a frame with a type error may stay so.
Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(TheDesignPutBreaks) /\ WF_vars(TheDesignPutChecksAgain)
  /\ WF_vars(TheDesignPutWrites)
  /\ \A f \in Live : WF_vars(TheNewDocumentDraws(f))

\* ---- Rules, in the reader's words ----

\* "No ready frame has a type error against the current kit version."
NoReadyFrameHasATypeError == \A f \in Uses : status[f] = "ready" => Fit(f)

\* "Each live frame that depends on a changed capsule shows the new kit version in the end",
\* read with rule 17: a frame with a type error shows its last good version until a put fixes it.
EachFrameOnCShowsTheNewKit == \A f \in Uses : <>[](Fit(f) => doc[f] = kit)

\* "A frame that depends on no changed capsule keeps its document."
AFrameOffCKeepsItsDocument == [][doc'["o"] = doc["o"] /\ next'["o"] = next["o"]]_vars

\* The literal rule, with no exception for a frame with a type error. It does not hold.
EachFrameOnCShowsTheNewKitLiterally == \A f \in Uses : <>[](doc[f] = kit)
====
