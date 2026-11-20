---- MODULE ViewerQueue ----
\* One request in the Requests panel of the easel viewer while agents and viewers work on it
\* (SPEC-viewer.md "Follow the requests"; SPEC-queue.md). The board stores no "in work" and
\* no "needs a person": the page derives them from claimedUntil, tries and the server's time,
\* which it reads from a clock capsule (its own clock plus the server's offset, carried by the
\* board). So a lease that runs out shows with no write.
\* The "changed" mark (E4.4 F6): this browser keeps, for each request, the `updated` time it
\* last opened, and the time of its last visit. A request shows "changed" while it changed
\* after both. The model keeps one flag: the tab has seen the latest change.
\* Cap stands for the 3 tries with no outcome before a request needs a person; small for TLC.
EXTENDS Naturals

Cap == 2

VARIABLES status,   \* on the server: "open" | "asking" | "resolved" | "accepted" | "person" |
                    \* "closed" ("accepted" stands for resolved with acceptedBy set)
          until,    \* on the server: claimedUntil is "none" or "set"
          tries,    \* on the server: tries since the request was posted or sent back
          expired,  \* the server's time is past claimedUntil (time alone, no write)
          tStatus, tUntil, tTries,  \* the tab's copy of the same cell
          seen,     \* this browser opened the request after its latest change
          conn      \* the one socket: "up" or "down"

vars == <<status, until, tries, expired, tStatus, tUntil, tTries, seen, conn>>

\* What a request shows, from a cell and the time. The panel and the queue use one function.
Shows(s, u, c) ==
  CASE s # "open"                   -> s
    [] u = "set" /\ ~expired        -> "inWork"
    [] c >= Cap                     -> "needsPerson"
    [] OTHER                        -> "waiting"

Truth == Shows(status, until, tries)
Panel == Shows(tStatus, tUntil, tTries)
\* The states that wait for a viewer: the count on the Requests button counts them.
ForAViewer(s) == s \in {"asking", "resolved", "person", "needsPerson"}

Init ==
  /\ status = "open" /\ until = "none" /\ tries = 0 /\ expired = FALSE
  /\ tStatus = "open" /\ tUntil = "none" /\ tTries = 0
  /\ seen = TRUE
  /\ conn = "up"

\* A board write reaches the tab at once over a live socket. Every write changes `updated`,
\* so the request shows "changed" until the viewer opens it.
Push == /\ IF conn = "up"
             THEN tStatus' = status' /\ tUntil' = until' /\ tTries' = tries'
             ELSE UNCHANGED <<tStatus, tUntil, tTries>>
        /\ seen' = FALSE
        /\ UNCHANGED conn

AgentClaims ==
  /\ Truth = "waiting"
  /\ until' = "set" /\ expired' = FALSE /\ tries' = tries + 1
  /\ UNCHANGED status
  /\ Push

\* A lease ends by time alone, with no timer and no write. The tab's clock passes it too.
TheLeaseRunsOut ==
  /\ until = "set" /\ ~expired /\ status = "open"
  /\ expired' = TRUE
  /\ UNCHANGED <<status, until, tries, tStatus, tUntil, tTries, seen, conn>>

AgentReleases ==
  /\ Truth = "inWork"
  /\ until' = "none"
  /\ UNCHANGED <<status, tries, expired>>
  /\ Push

\* resolve, ask or decline
Outcome(s) ==
  /\ Truth = "inWork"
  /\ status' = s /\ until' = "none"
  /\ UNCHANGED <<tries, expired>>
  /\ Push

\* edit, answer, reopen: back to the queue, tries at 0
SendBack ==
  /\ status' = "open" /\ until' = "none" /\ tries' = 0
  /\ UNCHANGED expired
  /\ Push

AViewerEdits == Truth \in {"waiting", "needsPerson", "person"} /\ SendBack
AViewerAnswers == Truth = "asking" /\ SendBack
AViewerReopens == Truth \in {"resolved", "accepted"} /\ SendBack

AViewerAccepts ==
  /\ Truth = "resolved"
  /\ status' = "accepted"
  /\ UNCHANGED <<until, tries, expired>>
  /\ Push

\* close; in work it is the viewer who takes the request back (E4.1 N9), and the claim ends.
AViewerCloses ==
  /\ Truth \in {"waiting", "inWork", "needsPerson", "person", "asking"}
  /\ status' = "closed" /\ until' = "none"
  /\ UNCHANGED <<tries, expired>>
  /\ Push

\* The viewer opens the request in this browser: its "changed" mark goes.
YouOpenIt ==
  /\ conn = "up" /\ ~seen
  /\ seen' = TRUE
  /\ UNCHANGED <<status, until, tries, expired, tStatus, tUntil, tTries, conn>>

TheSocketDrops ==
  /\ conn = "up"
  /\ conn' = "down"
  /\ UNCHANGED <<status, until, tries, expired, tStatus, tUntil, tTries, seen>>

\* Back up, the tab reads the whole board again.
TheSocketReconnects ==
  /\ conn = "down"
  /\ conn' = "up"
  /\ tStatus' = status /\ tUntil' = until /\ tTries' = tries
  /\ UNCHANGED <<status, until, tries, expired, seen>>

Next == AgentClaims \/ TheLeaseRunsOut \/ AgentReleases
     \/ Outcome("resolved") \/ Outcome("asking") \/ Outcome("person")
     \/ AViewerEdits \/ AViewerAnswers \/ AViewerAccepts \/ AViewerReopens \/ AViewerCloses
     \/ YouOpenIt \/ TheSocketDrops \/ TheSocketReconnects

Spec == Init /\ [][Next]_vars

States == {"waiting", "inWork", "needsPerson", "asking", "resolved", "accepted", "person", "closed"}

TypeOK ==
  /\ status \in {"open", "asking", "resolved", "accepted", "person", "closed"}
  /\ tStatus \in {"open", "asking", "resolved", "accepted", "person", "closed"}
  /\ until \in {"none", "set"} /\ tUntil \in {"none", "set"}
  /\ tries \in 0..Cap /\ tTries \in 0..Cap
  /\ expired \in BOOLEAN /\ seen \in BOOLEAN
  /\ conn \in {"up", "down"}
  /\ Panel \in States

\* E4.4 F1, F4: every connected tab shows the state of the request now, with no reload.
PanelShowsLatest == conn = "up" => Panel = Truth

\* A lease that runs out shows as waiting again, or as "needs a person", with no write.
LeaseOutShowsWithNoWrite ==
  (conn = "up" /\ until = "set" /\ expired /\ status = "open") => Panel \in {"waiting", "needsPerson"}

\* E4.4 F2: the count for a viewer counts the request exactly when it waits for a viewer.
TheCountIsRight == conn = "up" => (ForAViewer(Panel) <=> ForAViewer(Truth))

\* E4.4 F6: after a change, the request shows "changed" until the viewer opens it.
AChangeShowsUntilOpened == [][(status' # status \/ tries' # tries) => ~seen']_vars

====
