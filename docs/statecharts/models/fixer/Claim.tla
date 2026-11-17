---- MODULE Claim ----
\* Two fixers and one error group (SPEC-fixer.md, "A fixer holds a claim", "A fixer fixes an
\* error"). The claim is a lease. The wrapper extends it every 5 minutes and stops its fixer
\* before it can run out, so a lease runs out only on a fixer that has stopped (crashed, or
\* stopped by its wrapper). Every write that changes the group carries the claim.
\* ship.sh --fixer runs in two steps with its gate between them: a check (extend, and the
\* Fixes-Error trailer check on origin/main) before the gate, and the push after it. The lease
\* can run out between them. Two parts of the design keep a fix from shipping without the claim
\* (SPEC-fixer): the wrapper stops its fixer's whole process group (PGID), so a stop takes
\* ship.sh with it; and ship.sh runs the extend and the trailer check again just before the push
\* (ReCheck). With either one off and the other on, every rule still holds; with both off,
\* FixShipsOnlyUnderClaim breaks (an orphaned ship.sh pushes after the lease ran out and a
\* second fixer claimed the group).
\* Builds and notLive are in Lifecycle.tla; here the fix's build is live at once.
EXTENDS Naturals, FiniteSets

CONSTANTS Fixers, First, Part, PGID, ReCheck
\* Part "issue": a new group; the claim and its GitHub issue (fixers stop once ready to fix).
\* Part "fix": the group has its issue; the claim, the ship, the note and resolve.
\* First claims first and is the one that stops; the fixers are alike, so the other order
\* adds only mirror paths.

VARIABLES
  holder,     \* who holds the live lease: "none" or a fixer
  status,     \* "open", "resolved"
  noted,      \* the group's issue is recorded (fixer.noteIssue answered noted)
  issues,     \* GitHub issues with the group's fingerprint label
  ships,      \* fix commits on main with the group's Fixes-Error trailer
  fixNoted,   \* the group's fix is recorded (fixer.noteFix answered noted)
  rogue,      \* a fix was pushed while its fixer did not hold the live lease
  pc          \* each fixer: "idle", "claimed", "issueOpened", "ready", "gating" (ship.sh
              \* checked, its gate runs), "pushed", "waiting", "done", "stopped", or
              \* "orphan" (the fixer was stopped, but its ship.sh runs on: only without PGID).
              \* A fixer that asks while the lease is live gets `held` and stays "idle".

vars == <<holder, status, noted, issues, ships, fixNoted, rogue, pc>>

Working == {"claimed", "issueOpened", "ready", "gating", "pushed", "waiting"}

Init ==
  /\ holder = "none" /\ status = "open" /\ noted = (Part = "fix")
  /\ issues = IF Part = "fix" THEN 1 ELSE 0
  /\ ships = 0 /\ fixNoted = FALSE /\ rogue = FALSE
  /\ pc = [f \in Fixers |-> "idle"]

\* `easel errors claim <fp>`: one conditional write. claimed when no lease is live.
\* The claim answer carries the issue and the noted fix. A fixer that finds a pushed fix not
\* yet noted (the Fixes-Error trailer on origin/main) goes to note it; a noted fix goes to
\* resolve; an issue already noted goes to fixing.
Claim(f) ==
  /\ pc[f] = "idle" /\ status = "open" /\ holder = "none"
  /\ f = First \/ pc[First] # "idle"
  /\ holder' = f
  /\ pc' = [pc EXCEPT ![f] =
             IF fixNoted THEN "waiting"
             ELSE IF ships > 0 THEN "pushed"
             ELSE IF noted THEN "ready"
             ELSE "claimed"]
  /\ UNCHANGED <<status, noted, issues, ships, fixNoted, rogue>>

\* It looks for an issue with the fingerprint label first; it opens one only when none is found.
FindOrOpenIssue(f) ==
  /\ pc[f] = "claimed"
  /\ issues' = IF issues = 0 THEN 1 ELSE issues
  /\ pc' = [pc EXCEPT ![f] = "issueOpened"]
  /\ UNCHANGED <<holder, status, noted, ships, fixNoted, rogue>>

\* fixer.noteIssue: noted with the live lease, lost without it (the fixer stops).
NoteIssue(f) ==
  /\ pc[f] = "issueOpened"
  /\ IF holder = f
       THEN noted' = TRUE /\ pc' = [pc EXCEPT ![f] = "ready"]
       ELSE UNCHANGED noted /\ pc' = [pc EXCEPT ![f] = "stopped"]
  /\ UNCHANGED <<holder, status, issues, ships, fixNoted, rogue>>

\* ship.sh --fixer, step 1: extends the claim (refuses on lost) and checks for a landed fix
\* (refuses and names it); then its gate runs.
ShipChecks(f) ==
  /\ Part = "fix"
  /\ pc[f] = "ready"
  /\ pc' = [pc EXCEPT ![f] = IF holder = f /\ ships = 0 THEN "gating" ELSE "stopped"]
  /\ UNCHANGED <<holder, status, noted, issues, ships, fixNoted, rogue>>

\* ship.sh --fixer, step 2, after a green gate: with ReCheck it runs the extend and the trailer
\* check again, and refuses on lost or on a landed fix; then it pushes with the Fixes-Error
\* trailer. The re-check and the push are one step: the extend just made gives a fresh lease,
\* and the push takes seconds. An orphaned ship.sh pushes and ends; nothing notes its fix.
ShipPushes(f) ==
  /\ pc[f] \in {"gating", "orphan"}
  /\ IF ReCheck /\ ~(holder = f /\ ships = 0)
       THEN /\ UNCHANGED <<ships, rogue>>
            /\ pc' = [pc EXCEPT ![f] = "stopped"]
       ELSE /\ ships' = ships + 1
            /\ rogue' = (rogue \/ holder # f)
            /\ pc' = [pc EXCEPT ![f] = IF pc[f] = "orphan" THEN "stopped" ELSE "pushed"]
  /\ UNCHANGED <<holder, status, noted, issues, fixNoted>>

\* fixer.noteFix (ship.sh after the push, or the next fixer that found the trailer).
NoteFix(f) ==
  /\ pc[f] = "pushed"
  /\ IF holder = f
       THEN fixNoted' = TRUE /\ pc' = [pc EXCEPT ![f] = "waiting"]
       ELSE UNCHANGED fixNoted /\ pc' = [pc EXCEPT ![f] = "stopped"]
  /\ UNCHANGED <<holder, status, noted, issues, ships, rogue>>

\* fixer.resolve: resolved with the live lease (the claim ends), lost without it.
Resolve(f) ==
  /\ pc[f] = "waiting"
  /\ IF holder = f
       THEN status' = "resolved" /\ holder' = "none" /\ pc' = [pc EXCEPT ![f] = "done"]
       ELSE UNCHANGED <<status, holder>> /\ pc' = [pc EXCEPT ![f] = "stopped"]
  /\ UNCHANGED <<noted, issues, ships, fixNoted, rogue>>

\* The first fixer crashes, or its wrapper stops it after an extend failed. It does nothing more.
\* With PGID the stop takes its ship.sh too; without it, a ship.sh that runs its gate goes on.
Stops ==
  /\ pc[First] \in Working
  /\ pc' = [pc EXCEPT ![First] = IF pc[First] = "gating" /\ ~PGID THEN "orphan" ELSE "stopped"]
  /\ UNCHANGED <<holder, status, noted, issues, ships, fixNoted, rogue>>

\* The lease runs out: only on a stopped fixer, as no one extends it any more. Its ship.sh may
\* still be between its check and its push.
LeaseRunsOut ==
  /\ holder # "none"
  /\ pc[holder] \in {"stopped", "orphan"}
  /\ holder' = "none"
  /\ UNCHANGED <<status, noted, issues, ships, fixNoted, rogue, pc>>

Done ==
  /\ \/ holder = "none"
     \/ Part = "issue" /\ holder # "none" /\ pc[holder] = "ready"
  /\ \A f \in Fixers : \/ pc[f] \in {"done", "stopped"}
                       \/ pc[f] = "idle" /\ status = "resolved"
                       \/ pc[f] = "ready" /\ Part = "issue"
  /\ UNCHANGED vars

Next == \E f \in Fixers : Claim(f) \/ FindOrOpenIssue(f) \/ NoteIssue(f)
                         \/ ShipChecks(f) \/ ShipPushes(f) \/ NoteFix(f) \/ Resolve(f)
     \/ Stops \/ LeaseRunsOut \/ Done

\* ---- Rules, in the reader's words ----

\* "A second fixer never takes a group that another fixer holds."
NoClaimOverALiveLease == \A f \in Fixers : pc[f] \in Working => holder = f
\* "Two fixers never work on one group at the same time."
OneFixerAtATime == Cardinality({f \in Fixers : pc[f] \in Working}) <= 1
\* "A group gets one GitHub issue."
OneIssuePerGroup == issues <= 1
\* "A fix ships only from the fixer that holds the group's claim."
FixShipsOnlyUnderClaim == ~rogue
\* "A group gets one fix shipped." (one attempt at a time)
OneFixPerGroup == ships <= 1
\* "A group is resolved only with its fix recorded, so the attempt counts."
ResolvedOnlyWithItsFixNoted == status = "resolved" => fixNoted
====
