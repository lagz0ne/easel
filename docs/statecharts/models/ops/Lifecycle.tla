---- MODULE Lifecycle ----
\* One error group in easel (SPEC-ops.md, "An error group moves through its states"), and the
\* fixer that works on it (SPEC-fixer.md, "A fixer fixes an error"), one fixer at a time. Two
\* fixers and their claim are in Claim.tla. Builds are small numbers on one straight main line.
EXTENDS Naturals

CONSTANTS MaxBuild, Cap, People
\* People: an owner may resolve or hand off a group by rpc, with no claim (ops-issues-person).
\* The fixer's chart (ops-issues) turns it off to stay under the chart budget.

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
  dropped,     \* the resolved group was dropped at the 1000 cap; its fingerprint is kept
  person       \* a person resolved the group or handed it off (rpc, no claim). It stays: the
               \* fixer sees it in ops (`reason` set, or `fixedIn` none of its noted fixes)

vars == <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
          shipRegs, lastSeen, issue, fixer, dropped, person>>

Throws(b) == cured = 0 \/ b < cured

Init ==
  /\ side \in {"server", "browser"}
  /\ status = "none"
  /\ live = 1 /\ head = 1
  /\ cured = 0 /\ fix = 0 /\ fixedIn = 0
  /\ attempts = 0 /\ tries = 0 /\ regressions = 0 /\ shipRegs = 0 /\ lastSeen = 0
  /\ issue = "none" /\ fixer = "idle" /\ dropped = FALSE
  /\ person = FALSE

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
  /\ UNCHANGED <<side, live, head, cured, fix, fixedIn, attempts, tries, shipRegs, issue, fixer,
                 person>>

\* ops keeps at most 1000 groups; the oldest resolved go first, with the fingerprint kept.
Dropped ==
  /\ status = "resolved" /\ ~dropped
  /\ dropped' = TRUE
  /\ UNCHANGED <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, issue, fixer, person>>

\* The tick lists open server groups only, so a browser group never gets here. A fixer claims
\* the group, and finds its issue by the fingerprint label (reopens it) or opens one.
FixerClaims ==
  /\ fixer = "idle"
  /\ side = "server"
  /\ status \in {"open", "regressed"}
  /\ fixer' = "claimed"
  /\ issue' = "open"
  /\ UNCHANGED <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, dropped, person>>

\* Stop check: two shipped fixes and it still fails, or a person resolved or handed off the
\* group before, and it came back. The issue gets needs-human.
FixerGivesUp ==
  /\ fixer = "claimed"
  /\ attempts >= Cap \/ person
  /\ status' = "human" /\ fixer' = "idle"
  /\ UNCHANGED <<side, live, head, cured, fix, fixedIn, attempts, tries, regressions, shipRegs,
                 lastSeen, issue, dropped, person>>

\* ship.sh --fixer gates the fix, pushes it, and notes it (attempts goes up).
FixerShips ==
  /\ fixer = "claimed"
  /\ attempts < Cap /\ ~person
  /\ head < MaxBuild
  /\ head' = head + 1
  /\ fix' = head + 1
  /\ \/ cured' = cured                                   \* the fix does not cure it
     \/ cured = 0 /\ cured' = head + 1                   \* the fix cures it
  /\ tries' = tries + 1
  /\ attempts' = attempts + 1
  /\ shipRegs' = regressions
  /\ fixer' = "shipped"
  /\ UNCHANGED <<side, status, live, fixedIn, regressions, lastSeen, issue, dropped, person>>

\* ship.sh --fixer refuses the fix on a fixer rule, or its gate is red: a person takes it.
FixRefused ==
  /\ fixer = "claimed"
  /\ attempts < Cap /\ ~person
  /\ tries' = tries + 1
  /\ status' = "human" /\ fixer' = "idle"
  /\ UNCHANGED <<side, live, head, cured, fix, fixedIn, attempts, regressions, shipRegs,
                 lastSeen, issue, dropped, person>>

\* ship.sh --fixer refuses because the line is stopped (trunk-red): nothing was gated. The
\* fixer releases the claim; the tick finds the group again later.
LineStopped ==
  /\ fixer = "claimed"
  /\ attempts < Cap /\ ~person
  /\ fixer' = "idle"
  /\ UNCHANGED <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, issue, dropped, person>>

\* Another agent ships something unrelated.
OtherShip ==
  /\ head < MaxBuild
  /\ head' = head + 1
  /\ UNCHANGED <<side, status, live, cured, fix, fixedIn, attempts, tries, regressions, shipRegs,
                 lastSeen, issue, fixer, dropped, person>>

\* The newest build deploys; a newer push cancels the deploys before it.
Deploy ==
  /\ live < head
  /\ live' = head
  /\ UNCHANGED <<side, status, head, cured, fix, fixedIn, attempts, tries, regressions, shipRegs,
                 lastSeen, issue, fixer, dropped, person>>

\* resolve --build n: notLive while live < n (no change, so no step); failing when the error
\* was seen on a build >= n; resolved otherwise, and the fixer closes the issue.
FixerResolves ==
  /\ fixer = "shipped"
  /\ live >= fix
  /\ lastSeen < fix
  /\ status' = "resolved" /\ fixedIn' = fix /\ fix' = 0
  /\ issue' = "closed" /\ fixer' = "idle"
  /\ UNCHANGED <<side, live, head, cured, attempts, tries, regressions, shipRegs, lastSeen,
                 dropped, person>>

FixerSeesFailing ==
  /\ fixer = "shipped"
  /\ live >= fix
  /\ lastSeen >= fix
  /\ fix' = 0 /\ fixer' = "claimed"
  /\ UNCHANGED <<side, status, live, head, cured, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, issue, dropped, person>>

\* An owner's `easel errors resolve <fp> --build n` (ops.resolveError, no claim). While a lease
\* is live it answers held and changes nothing, so it is no step here; so are notLive (live < n)
\* and failing (seen on a build >= n). resolved otherwise. ops touches no GitHub issue: an open
\* one stays open until the tick closes it. A person's resolve keeps the attempt count, and
\* a regression after it goes back to a person. A dropped group is in no list, so an owner
\* cannot see it: resolve answers gone and changes nothing, so it is no step.
OwnerResolves ==
  /\ People /\ fixer = "idle"
  /\ status # "none" /\ ~dropped
  /\ \E n \in 1..live :
       /\ lastSeen < n
       /\ status' = "resolved" /\ fixedIn' = n
  /\ person' = TRUE
  /\ UNCHANGED <<side, live, head, cured, fix, attempts, tries, regressions, shipRegs, lastSeen,
                 issue, fixer, dropped>>

\* An owner's `easel errors hand-off <fp> --reason <text>` (ops.handOff, no claim). held while a
\* lease is live (no step). ops opens no issue: the person who hands it off is the person. A
\* dropped group answers gone (no step), as for resolve.
OwnerHandsOff ==
  /\ People /\ fixer = "idle"
  /\ status # "none" /\ ~dropped
  /\ status' = "human" /\ person' = TRUE
  /\ UNCHANGED <<side, live, head, cured, fix, fixedIn, attempts, tries, regressions, shipRegs,
                 lastSeen, issue, fixer, dropped>>

\* The tick closes the open prod-error issue of a resolved group (SPEC-fixer.md, the tick,
\* step 1.2): a person resolved it, or a fixer stopped between resolve and close.
TickClosesIssue ==
  /\ status = "resolved" /\ issue = "open"
  /\ issue' = "closed"
  /\ UNCHANGED <<side, status, live, head, cured, fix, fixedIn, attempts, tries, regressions,
                 shipRegs, lastSeen, fixer, dropped, person>>

\* Nothing is left to ship or deploy with these few builds.
Done ==
  /\ fixer = "idle" /\ head = MaxBuild /\ live = head
  /\ UNCHANGED vars

Next == ErrorSeen \/ Dropped \/ FixerClaims \/ FixerGivesUp \/ FixerShips \/ FixRefused
     \/ LineStopped \/ OtherShip \/ Deploy \/ FixerResolves \/ FixerSeesFailing \/ Done
     \/ OwnerResolves \/ OwnerHandsOff \/ TickClosesIssue

\* Only the tick is fair: it runs every 5 minutes. Nothing else has to happen.
Spec == Init /\ [][Next]_vars /\ WF_vars(TickClosesIssue)

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
\* "Once a fixer resolves a group, its issue is closed."
ResolvedClosesIssue == status = "resolved" /\ ~person => issue = "closed"
\* "A resolved group with an open issue gets it closed by the tick."
ResolvedIssueGetsClosed ==
  (status = "resolved" /\ issue = "open") ~> (issue = "closed" \/ status # "resolved")
\* "A group a fixer hands to a person has an open issue that says so."
PersonSeesAnOpenIssue == status = "human" /\ ~person => issue = "open"
\* "After the second regression no fix ships; a person takes it."
NoFixAfterSecondRegression == shipRegs < Cap
\* "A group handed to a person stays with the person; only an owner's resolve moves it on."
HumanStaysHuman == [][status = "human" => status' = "human" \/ OwnerResolves]_vars
\* "The fixer tries at most two fixes on one group before a person is called."
AtMostTwoFixTries == tries <= Cap
====
