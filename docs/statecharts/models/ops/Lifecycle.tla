---- MODULE Lifecycle ----
\* One error group in easel (SPEC-ops.md, "An error group moves through its states"), and the
\* fixer that works on it (SPEC-fixer.md, "A fixer fixes an error"), one fixer at a time. Two
\* fixers and their claim are in Claim.tla. Builds are small numbers on one straight main line.
EXTENDS Naturals

CONSTANTS MaxBuild, Cap

VARIABLES
  side,        \* "server" or "browser": part of the fingerprint, fixed per group
  status,      \* "none" (never seen), "open", "resolved", "regressed", "human"
  live,        \* the build the server runs
  head,        \* the newest build on main
  cured,       \* the first build whose code no longer throws (0: none yet)
  fix,         \* the build of the noted fix that waits for resolve (0: none)
  fixedIn,     \* the group's fixedIn (0: null)
  attempts,    \* fixes shipped and noted for this group (fixer.noteFix)
  tries,       \* fixes that ship.sh --fixer gated: shipped, refused on a rule, or red
  regressions, \* times the group was marked regressed
  shipRegs,    \* regressions at the moment of the last ship
  lastSeen,    \* the highest build the error was seen on (0: never)
  issue,       \* the GitHub issue: "none", "open", "closed"
  fixer,       \* "idle", "claimed" (stop checks passed or pending), "shipped" (fix noted)
  dropped      \* the resolved group was dropped at the 1000 cap; its fingerprint is kept

vars == <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
          shipRegs, lastSeen, issue, fixer, dropped>>

Throws(b) == cured = 0 \/ b < cured

Init ==
  /\ side \in {"server", "browser"}
  /\ status = "none"
  /\ live = 1 /\ head = 1
  /\ cured = 0 /\ fix = 0 /\ fixedIn = 0
  /\ attempts = 0 /\ tries = 0 /\ regressions = 0 /\ shipRegs = 0 /\ lastSeen = 0
  /\ issue = "none" /\ fixer = "idle" /\ dropped = FALSE

\* The error happens on build b and the sink records it: the live build, or an older one
\* still running (a tab that has not reloaded, or the old server during a deploy). A resolved
\* group, kept or dropped at the cap, comes back as regressed only when b is its fixedIn or
\* later; an error on an older build changes no status.
ErrorSeen ==
  \E b \in 1..live :
  /\ Throws(b)
  /\ lastSeen' = IF b > lastSeen THEN b ELSE lastSeen
  /\ IF status = "none"
       THEN status' = "open" /\ UNCHANGED <<regressions, dropped>>
     ELSE IF status = "resolved" /\ b >= fixedIn
       THEN status' = "regressed" /\ regressions' = regressions + 1 /\ dropped' = FALSE
       ELSE UNCHANGED <<status, regressions, dropped>>
  /\ UNCHANGED <<side, live, head, cured, fix, fixedIn, attempts, tries, shipRegs, issue, fixer>>

\* ops keeps at most 1000 groups; the oldest resolved go first, with the fingerprint kept.
Dropped ==
  /\ status = "resolved" /\ ~dropped
  /\ dropped' = TRUE
  /\ UNCHANGED <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, issue, fixer>>

\* The tick lists open server groups only, so a browser group never gets here. A fixer claims
\* the group, and finds its issue by the fingerprint label (reopens it) or opens one.
FixerClaims ==
  /\ fixer = "idle"
  /\ side = "server"
  /\ status \in {"open", "regressed"}
  /\ fixer' = "claimed"
  /\ issue' = "open"
  /\ UNCHANGED <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, dropped>>

\* Stop check: two shipped fixes and it still fails. The issue gets needs-human.
FixerGivesUp ==
  /\ fixer = "claimed"
  /\ attempts >= Cap
  /\ status' = "human" /\ fixer' = "idle"
  /\ UNCHANGED <<side, live, head, cured, fix, fixedIn, attempts, tries, regressions, shipRegs,
                 lastSeen, issue, dropped>>

\* ship.sh --fixer gates the fix, pushes it, and notes it (attempts goes up).
FixerShips ==
  /\ fixer = "claimed"
  /\ attempts < Cap
  /\ head < MaxBuild
  /\ head' = head + 1
  /\ fix' = head + 1
  /\ \/ cured' = cured                                   \* the fix does not cure it
     \/ cured = 0 /\ cured' = head + 1                   \* the fix cures it
  /\ tries' = tries + 1
  /\ attempts' = attempts + 1
  /\ shipRegs' = regressions
  /\ fixer' = "shipped"
  /\ UNCHANGED <<side, status, live, fixedIn, regressions, lastSeen, issue, dropped>>

\* ship.sh --fixer refuses the fix on a fixer rule, or its gate is red: a person takes it.
FixRefused ==
  /\ fixer = "claimed"
  /\ attempts < Cap
  /\ tries' = tries + 1
  /\ status' = "human" /\ fixer' = "idle"
  /\ UNCHANGED <<side, live, head, cured, fix, fixedIn, attempts, regressions, shipRegs,
                 lastSeen, issue, dropped>>

\* ship.sh --fixer refuses because the line is stopped (trunk-red): nothing was gated. The
\* fixer releases the claim; the tick finds the group again later.
LineStopped ==
  /\ fixer = "claimed"
  /\ attempts < Cap
  /\ fixer' = "idle"
  /\ UNCHANGED <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, issue, dropped>>

\* Another agent ships something unrelated.
OtherShip ==
  /\ head < MaxBuild
  /\ head' = head + 1
  /\ UNCHANGED <<side, status, live, cured, fix, fixedIn, attempts, tries, regressions, shipRegs,
                 lastSeen, issue, fixer, dropped>>

\* The newest build deploys; a newer push cancels the deploys before it.
Deploy ==
  /\ live < head
  /\ live' = head
  /\ UNCHANGED <<side, status, head, cured, fix, fixedIn, attempts, tries, regressions, shipRegs,
                 lastSeen, issue, fixer, dropped>>

\* resolve --build n: notLive while live < n (no change, so no step); failing when the error
\* was seen on a build >= n; resolved otherwise, and the fixer closes the issue.
FixerResolves ==
  /\ fixer = "shipped"
  /\ live >= fix
  /\ lastSeen < fix
  /\ status' = "resolved" /\ fixedIn' = fix /\ fix' = 0
  /\ issue' = "closed" /\ fixer' = "idle"
  /\ UNCHANGED <<side, live, head, cured, attempts, tries, regressions, shipRegs, lastSeen,
                 dropped>>

FixerSeesFailing ==
  /\ fixer = "shipped"
  /\ live >= fix
  /\ lastSeen >= fix
  /\ fix' = 0 /\ fixer' = "claimed"
  /\ UNCHANGED <<side, status, live, head, cured, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, issue, dropped>>

\* Nothing is left to ship or deploy with these few builds.
Done ==
  /\ fixer = "idle" /\ head = MaxBuild /\ live = head
  /\ UNCHANGED vars

Next == ErrorSeen \/ Dropped \/ FixerClaims \/ FixerGivesUp \/ FixerShips \/ FixRefused
     \/ LineStopped \/ OtherShip \/ Deploy \/ FixerResolves \/ FixerSeesFailing \/ Done

\* ---- Rules, in the reader's words ----

\* "A browser-only group never starts a fix."
BrowserGroupGetsNoFix == side = "browser" => tries = 0
\* "A browser-only group opens no issue."
BrowserGroupOpensNoIssue == side = "browser" => issue = "none"
\* "A group is resolved only once the live build has its fix."
ResolvedOnlyWhenFixIsLive == status = "resolved" => live >= fixedIn /\ fixedIn > 0
\* "A group is never resolved when it was already seen failing on the fix's build or later."
ResolvedNotAlreadyFailing == status = "resolved" => lastSeen < fixedIn
\* "A group is marked regressed only when seen on a build at or after its fix."
RegressedOnlyAfterFix == status = "regressed" => fixedIn > 0 /\ lastSeen >= fixedIn
\* "A group that was resolved never comes back as new: it is regressed."
OpenMeansNeverResolved == status = "open" => fixedIn = 0
\* "Once resolved, the issue is closed."
ResolvedClosesIssue == status = "resolved" => issue = "closed"
\* "A group handed to a person has an open issue that says so."
PersonSeesAnOpenIssue == status = "human" => issue = "open"
\* "After the second regression no fix ships; a person takes it."
NoFixAfterSecondRegression == shipRegs < Cap
\* "A group handed to a person stays with the person."
HumanStaysHuman == [][status = "human" => status' = "human"]_vars
\* "The fixer tries at most two fixes on one group before a person is called."
AtMostTwoFixTries == tries <= Cap
====
