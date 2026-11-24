---- MODULE ArrangeRev ----
\* SPEC-arrange.md rules 19 to 22 (E2.3 G6): two agents change the exact places of one page, each
\* from what it read. Agent A puts the frame e right of the frame d, at the right edge of d that it
\* read plus the gap. Agent B makes d wider, but only when its read says that the wider d does not
\* touch e. Each change adds 1 to the revision of the canvas. With CheckRev, a change that names a
\* revision that is not the revision now is refused `changed`, writes nothing, and the agent reads
\* again. CheckRev = FALSE is the change with no revision (chart frames-arrange-no-rev): each agent
\* is right about what it read, and the two changes together make d touch e.
EXTENDS Integers

CONSTANT CheckRev

Gap == 1

VARIABLES
  wd,    \* the width of d, at x 0: 1 or 2
  ex,    \* the x of e, or 0 when e is not on the page
  rev,   \* the revision of the canvas
  a,     \* agent A: "idle", "read" or "done"
  aSaw,  \* the width of d that A read
  aRev,  \* the revision that A read
  b,     \* agent B: "idle", "read" or "done"
  bSaw,  \* the x of e that B read (0: no e)
  bRev   \* the revision that B read

vars == <<wd, ex, rev, a, aSaw, aRev, b, bSaw, bRev>>

Space(a1, a2, b1, b2) == IF b1 >= a2 THEN b1 - a2 ELSE IF a1 >= b2 THEN a1 - b2 ELSE -1

\* d is at x 0 and y 0, wd wide; e is at y 0, 1 wide. Both are 1 high, so they are near when the
\* space between them on the x axis is less than the gap.
Touch(w, x) == x # 0 /\ Space(0, w, x, x + 1) < Gap

Init ==
  /\ wd = 1 /\ ex = 0 /\ rev = 0
  /\ a = "idle" /\ aSaw = 0 /\ aRev = 0
  /\ b = "idle" /\ bSaw = 0 /\ bRev = 0

Fresh(r) == ~CheckRev \/ r = rev

ReadA ==
  /\ a = "idle"
  /\ a' = "read" /\ aSaw' = wd /\ aRev' = rev
  /\ UNCHANGED <<wd, ex, rev, b, bSaw, bRev>>

\* `easel put --at <right of d>,0 --rev <read>`.
PutE ==
  /\ a = "read" /\ Fresh(aRev)
  /\ ex' = aSaw + Gap /\ rev' = rev + 1 /\ a' = "done"
  /\ UNCHANGED <<wd, aSaw, aRev, b, bSaw, bRev>>

RefuseA ==
  /\ a = "read" /\ ~Fresh(aRev)
  /\ a' = "idle"
  /\ UNCHANGED <<wd, ex, rev, aSaw, aRev, b, bSaw, bRev>>

ReadB ==
  /\ b = "idle"
  /\ b' = "read" /\ bSaw' = ex /\ bRev' = rev
  /\ UNCHANGED <<wd, ex, rev, a, aSaw, aRev>>

\* `easel move d --size 2x1 --rev <read>`, when the read says that the wider d touches nothing.
GrowD ==
  /\ b = "read" /\ Fresh(bRev) /\ ~Touch(2, bSaw)
  /\ wd' = 2 /\ rev' = rev + 1 /\ b' = "done"
  /\ UNCHANGED <<ex, a, aSaw, aRev, bSaw, bRev>>

\* B reads that a wider d would touch e, and leaves d as it is.
KeepD ==
  /\ b = "read" /\ Touch(2, bSaw)
  /\ b' = "done"
  /\ UNCHANGED <<wd, ex, rev, a, aSaw, aRev, bSaw, bRev>>

RefuseB ==
  /\ b = "read" /\ ~Fresh(bRev) /\ ~Touch(2, bSaw)
  /\ b' = "idle"
  /\ UNCHANGED <<wd, ex, rev, a, aSaw, aRev, bSaw, bRev>>

Done ==
  /\ a = "done" /\ b = "done"
  /\ UNCHANGED vars

Next == ReadA \/ PutE \/ RefuseA \/ ReadB \/ GrowD \/ KeepD \/ RefuseB \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ wd \in {1, 2} /\ ex \in {0, 2, 3} /\ rev \in 0..2
  /\ a \in {"idle", "read", "done"} /\ b \in {"idle", "read", "done"}

\* d and e never touch.
NoTouch == ~Touch(wd, ex)

\* A refusal writes nothing.
ARefusalWritesNothing ==
  [][(a = "read" /\ a' = "idle") \/ (b = "read" /\ b' = "idle") =>
       <<wd, ex, rev>>' = <<wd, ex, rev>>]_vars

\* Each change of a place or a size adds 1 to the revision.
EachChangeAddsOne == [][(<<wd, ex>>' # <<wd, ex>>) => rev' = rev + 1]_vars
====
