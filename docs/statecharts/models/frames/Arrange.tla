---- MODULE Arrange ----
\* SPEC-arrange.md rules 1 to 11 (E2.3 G1, G2 and G4): an agent places two frames, a and b, by
\* relation in one section: a new section, after a frame, or below a frame. easel computes each
\* place. The columns go from left to right with one gap between them; the frames of a column go
\* from top to bottom. b can get wider and narrower (a move with a size). An exact frame d is at
\* x 4, y 0, and comes and goes. A section in the flow starts at y 0, and goes below d when it would
\* come closer than the gap to it. The places are a function of the order and the sizes, so the
\* model holds no place: it computes each one, as `arrangePage` does in the write.
EXTENDS Integers, Sequences, FiniteSets

Arranged == {"a", "b"}
Gap == 1
Exact == [x |-> 4, y |-> 0, w |-> 1, h |-> 1]

VARIABLES
  cols,   \* the section: a sequence of columns, each a sequence of frames from top to bottom
  wide,   \* b is 2 wide (else 1)
  exactOn \* the exact frame d is on the page

vars == <<cols, wide, exactOn>>

Range(s) == {s[i] : i \in DOMAIN s}
In == UNION {Range(cols[i]) : i \in DOMAIN cols}
Max(S) == CHOOSE m \in S : \A n \in S : n <= m

Width(f) == IF f = "b" /\ wide THEN 2 ELSE 1
ColW(i) == Max({Width(f) : f \in Range(cols[i])})
ColH(i) == Len(cols[i]) + (Len(cols[i]) - 1) * Gap

RECURSIVE ColX(_)
ColX(i) == IF i = 1 THEN 0 ELSE ColX(i - 1) + ColW(i - 1) + Gap

ColOf(f) == CHOOSE i \in DOMAIN cols : f \in Range(cols[i])
RowOf(f) == CHOOSE k \in DOMAIN cols[ColOf(f)] : cols[ColOf(f)][k] = f

SecW == IF cols = <<>> THEN 0 ELSE ColX(Len(cols)) + ColW(Len(cols))
SecH == IF cols = <<>> THEN 0 ELSE Max({ColH(i) : i \in DOMAIN cols})

\* Two boxes are near when the space between them is less than the gap on both axes.
Space(a1, a2, b1, b2) == IF b1 >= a2 THEN b1 - a2 ELSE IF a1 >= b2 THEN a1 - b2 ELSE -1
Near(p, q) ==
  /\ Space(p.x, p.x + p.w, q.x, q.x + q.w) < Gap
  /\ Space(p.y, p.y + p.h, q.y, q.y + q.h) < Gap

AtTop == [x |-> 0, y |-> 0, w |-> SecW, h |-> SecH]
SecY == IF exactOn /\ cols # <<>> /\ Near(AtTop, Exact) THEN Exact.y + Exact.h + Gap ELSE 0

Box(f) ==
  [x |-> ColX(ColOf(f)), y |-> SecY + (RowOf(f) - 1) * (1 + Gap), w |-> Width(f), h |-> 1]

Boxes == {Box(f) : f \in In} \cup (IF exactOn THEN {Exact} ELSE {})

Init == cols = <<>> /\ wide = FALSE /\ exactOn = FALSE

InsertAt(s, i, e) == SubSeq(s, 1, i - 1) \o <<e>> \o SubSeq(s, i, Len(s))
RemoveAt(s, i) == SubSeq(s, 1, i - 1) \o SubSeq(s, i + 1, Len(s))

\* `section: <name>`: a new column at the end of the section.
PutSection(f) ==
  /\ f \notin In
  /\ cols' = Append(cols, <<f>>)
  /\ UNCHANGED <<wide, exactOn>>

\* `after: t`: a new column right after the column of t.
PutAfter(f, t) ==
  /\ f \notin In /\ t \in In
  /\ cols' = InsertAt(cols, ColOf(t) + 1, <<f>>)
  /\ UNCHANGED <<wide, exactOn>>

\* `below: t`: under t, in its column.
PutBelow(f, t) ==
  /\ f \notin In /\ t \in In
  /\ cols' = [cols EXCEPT ![ColOf(t)] = InsertAt(@, RowOf(t) + 1, f)]
  /\ UNCHANGED <<wide, exactOn>>

\* A move with a size: b gets wider, or narrower again.
Grow ==
  /\ "b" \in In /\ ~wide
  /\ wide' = TRUE
  /\ UNCHANGED <<cols, exactOn>>

Shrink ==
  /\ wide
  /\ wide' = FALSE
  /\ UNCHANGED <<cols, exactOn>>

\* A delete: a column with no frame goes too, so no hole stays.
Remove(f) ==
  /\ f \in In
  /\ LET i == ColOf(f)
         col == RemoveAt(cols[i], RowOf(f))
     IN cols' = IF col = <<>> THEN RemoveAt(cols, i) ELSE [cols EXCEPT ![i] = col]
  /\ wide' = (wide /\ f # "b")
  /\ UNCHANGED exactOn

\* An agent puts the exact frame d with `--at`, or deletes it.
ExactOn ==
  /\ ~exactOn
  /\ exactOn' = TRUE
  /\ UNCHANGED <<cols, wide>>

ExactOff ==
  /\ exactOn
  /\ exactOn' = FALSE
  /\ UNCHANGED <<cols, wide>>

Next ==
  \/ \E f \in Arranged : PutSection(f) \/ Remove(f)
  \/ \E f, t \in Arranged : PutAfter(f, t) \/ PutBelow(f, t)
  \/ Grow \/ Shrink \/ ExactOn \/ ExactOff

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ cols \in Seq(Seq(Arranged))
  /\ wide \in BOOLEAN
  /\ exactOn \in BOOLEAN

\* No two frames touch: each pair is at least the gap apart on one axis.
NoTouch == \A p, q \in Boxes : p # q => ~Near(p, q)

\* The columns are in their order, with one gap between two columns: no hole.
ColumnsInOrder ==
  \A i \in DOMAIN cols : i > 1 => ColX(i) = ColX(i - 1) + ColW(i - 1) + Gap

\* Each column has a frame: a delete leaves no empty column.
NoEmptyColumn == \A i \in DOMAIN cols : cols[i] # <<>>

\* The frames of a column are in their order, one gap apart.
RowsInOrder ==
  \A f, g \in In : (ColOf(f) = ColOf(g) /\ RowOf(g) = RowOf(f) + 1) => Box(g).y = Box(f).y + 1 + Gap

\* A frame is in one place of the section only.
OnePlace == \A i, j \in DOMAIN cols : i # j => Range(cols[i]) \cap Range(cols[j]) = {}

\* A grow or a shrink keeps the order, and moves each column after the frame by the change of the
\* width of its column, so the row stays in order with no touch.
ASizeMovesTheColumnsAfter ==
  [][(cols' = cols /\ exactOn' = exactOn /\ wide' # wide) =>
       \A j \in DOMAIN cols : j > ColOf("b") =>
         (ColX(j))' - ColX(j) = (ColW(ColOf("b")))' - ColW(ColOf("b"))]_vars

\* Only an agent changes the order: a size or an exact frame never does.
OnlyAnAgentChangesTheOrder ==
  [][(In' = In /\ (wide' # wide \/ exactOn' # exactOn)) => cols' = cols]_vars
====
