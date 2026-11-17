---- MODULE ViewerQueue ----
\* One comment in the Comments panel of the easel viewer while agents work it
\* (SPEC-viewer.md "Follow the queue"; SPEC-queue.md "An agent works the queue").
\* The board stores no "claimed" status: a comment is claimed while its claimedUntil is ahead of
\* the server's time. The page reads that time from a clock capsule (its own clock plus the
\* server's offset, carried by the board), so a lease that runs out shows as open with no write.
\* MaxClaims stands for the 3 claims that run out before a comment is stuck, kept small for TLC.
EXTENDS Naturals

MaxClaims == 2

VARIABLES status,    \* on the server (cell comments): "open" or "done"
          until,     \* on the server: claimedUntil is "none" or "set"
          claims,    \* on the server: claims counted against the comment (attempts)
          expired,   \* the server's time is past claimedUntil (time alone, no write)
          tStatus, tUntil, tClaims,  \* the tab's copy of the same cell
          conn       \* the one socket: "up" or "down"

vars == <<status, until, claims, expired, tStatus, tUntil, tClaims, conn>>

\* What a comment shows, from a cell and the time. Both the panel and the queue use this.
Shows(s, u, c) ==
  CASE s = "done"                       -> "done"
    [] u = "set" /\ ~expired            -> "claimed"
    [] u = "set" /\ c >= MaxClaims      -> "stuck"
    [] OTHER                            -> "open"

Truth == Shows(status, until, claims)
Panel == Shows(tStatus, tUntil, tClaims)

Init ==
  /\ status = "open" /\ until = "none" /\ claims = 0 /\ expired = FALSE
  /\ tStatus = "open" /\ tUntil = "none" /\ tClaims = 0
  /\ conn = "up"

\* A board write reaches the tab at once over a live socket.
Push == IF conn = "up"
          THEN tStatus' = status' /\ tUntil' = until' /\ tClaims' = claims'
          ELSE UNCHANGED <<tStatus, tUntil, tClaims>>

\* easel next claims the oldest open comment; one whose lease ran out is open to it, unless stuck.
AgentClaims ==
  /\ Truth = "open"
  /\ until' = "set" /\ expired' = FALSE /\ claims' = claims + 1
  /\ UNCHANGED status
  /\ Push
  /\ UNCHANGED conn

\* A lease ends by time alone, with no timer and no write. The tab's clock passes it too.
TheLeaseRunsOut ==
  /\ until = "set" /\ ~expired
  /\ expired' = TRUE
  /\ UNCHANGED <<status, until, claims, tStatus, tUntil, tClaims, conn>>

AgentResolves ==
  /\ Truth = "claimed"
  /\ status' = "done"
  /\ UNCHANGED <<until, claims, expired>>
  /\ Push
  /\ UNCHANGED conn

\* easel release gives the claim back: claimedUntil cleared, the claim not counted.
AgentReleases ==
  /\ Truth = "claimed"
  /\ until' = "none" /\ claims' = claims - 1
  /\ UNCHANGED <<status, expired>>
  /\ Push
  /\ UNCHANGED conn

TheSocketDrops ==
  /\ conn = "up"
  /\ conn' = "down"
  /\ UNCHANGED <<status, until, claims, expired, tStatus, tUntil, tClaims>>

\* Back up, the tab reads the whole board again.
TheSocketReconnects ==
  /\ conn = "down"
  /\ conn' = "up"
  /\ tStatus' = status /\ tUntil' = until /\ tClaims' = claims
  /\ UNCHANGED <<status, until, claims, expired>>

Next == AgentClaims \/ TheLeaseRunsOut \/ AgentResolves \/ AgentReleases
     \/ TheSocketDrops \/ TheSocketReconnects

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ status \in {"open", "done"} /\ tStatus \in {"open", "done"}
  /\ until \in {"none", "set"} /\ tUntil \in {"none", "set"}
  /\ claims \in 0..MaxClaims /\ tClaims \in 0..MaxClaims
  /\ expired \in BOOLEAN
  /\ conn \in {"up", "down"}

\* If an agent's lease runs out before it resolves, the comment shows as open again (or stuck).
LeaseOutShowsOpen == Truth \in {"open", "stuck"} /\ conn = "up" => Panel \in {"open", "stuck"}

\* When an agent claims, resolves or releases a comment, every connected tab shows it at once.
PanelShowsLatest == conn = "up" => Panel = Truth

\* A done comment never shows as open or claimed again.
DoneStaysDone == status = "done" /\ conn = "up" => Panel = "done"

\* A comment past its last claim shows as stuck, not as open.
StuckShowsStuck == Truth = "stuck" /\ conn = "up" => Panel = "stuck"

====
