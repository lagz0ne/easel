---- MODULE Login ----
\* easel access, V1: logging in to an `approve` server (SPEC-access.md).
\* Ann gives the setup code and becomes the first owner. An agent named builder
\* joins by a code that an owner approves.
\*
\* The login is PKCE-style: the agent's CLI makes its own token and sends only
\* its digest. Approve binds that digest to the user, so the token works from
\* the approve on. `login.wait` carries no token and answers `granted` as often
\* as it is asked, while the token works.
\*
\* Sign out: `login.end` removes the calling user, as `users.revoke` does, in one
\* write: its row with its token, and its codes that still wait or were approved
\* are denied. The name is free again. The last owner answers `last`, and nothing
\* changes. `users.me` changes nothing, so it is not a step here.
\*
\* A code is kept as the server keeps it: a state ("pending", "approved",
\* "denied") and its time. "Expired" is not stored: it is a pending code past its
\* time. So a write that ends codes must look at the time, or it turns an expired
\* code into a denied one.
\*
\* Time is coarse: "a code runs out" and "a minute passes" are steps.
\* The rate limits are one flag: the agent's address is at a limit or not.
EXTENDS Naturals

VARIABLES
  setup,      \* the setup code: "unused" | "used"
  annCode,    \* the setup code Ann holds: "current" | "old" (from before a restart)
  role,       \* [People -> "none" | "owner" | "member" | "revoked" | "gone" (logged out)]
  req,        \* the stored state of the agent's login request: "none" | "pending" | "approved" | "denied"
  late,       \* that request is past its time (it reads as expired while it is pending)
  old,        \* an earlier code of the agent's that ran out, still kept: "none" | "pending" (past its time)
  approvals,  \* how many approves on that request answered `approved`
  cli,        \* the agent's CLI: "out" | "slow" | "waiting" | "stopped" | "in"
  lost,       \* the server answered `granted`, but the answer did not reach the CLI
  tokenLive,  \* the server accepts the token the agent's CLI made
  busy,       \* the agent's address is at a limit (waiting codes, or starts this minute)
  setupGrants,          \* how many times a setup code answered granted
  setupWithUsers,       \* a setup code answered granted while a user existed
  oldSetupWorked,       \* a setup code from before a restart answered granted
  grantedWhileRevoked,  \* login.wait answered granted while the agent was not a user
  okWhileRevoked,       \* a call with the agent's token was answered while it was not a user
  okAfterLogout         \* a call with the agent's token was answered after the agent logged out

vars == <<setup, annCode, role, req, late, old, approvals, cli, lost, tokenLive, busy,
          setupGrants, setupWithUsers, oldSetupWorked, grantedWhileRevoked, okWhileRevoked,
          okAfterLogout>>

People == {"ann", "builder"}
Users == {p \in People : role[p] \in {"owner", "member"}}
Owners == {p \in People : role[p] = "owner"}
HasUser == Users # {}
AgentIsUser == "builder" \in Users
HoldsToken == cli \in {"waiting", "stopped", "in"}

\* What login.wait reads from a kept code: a pending code past its time is expired.
Seen(state, isLate) == IF state = "pending" /\ isLate THEN "expired" ELSE state
code == Seen(req, late)
oldCode == Seen(old, TRUE)

TypeOK ==
  /\ setup \in {"unused", "used"}
  /\ annCode \in {"current", "old"}
  /\ role \in [People -> {"none", "owner", "member", "revoked", "gone"}]
  /\ req \in {"none", "pending", "approved", "denied"}
  /\ late \in BOOLEAN /\ (late => req = "pending")
  /\ old \in {"none", "pending"}
  /\ approvals \in 0..1
  /\ cli \in {"out", "slow", "waiting", "stopped", "in"}
  /\ lost \in BOOLEAN /\ tokenLive \in BOOLEAN /\ busy \in BOOLEAN
  /\ (req # "none") <=> (cli \in {"waiting", "stopped"})
  /\ lost => (cli = "waiting" /\ req = "approved")

Init ==
  /\ setup = "unused"
  /\ annCode = "current"
  /\ role = [p \in People |-> "none"]
  /\ req = "none" /\ late = FALSE /\ old = "none" /\ approvals = 0
  /\ cli = "out" /\ lost = FALSE
  /\ tokenLive = FALSE
  /\ busy = FALSE
  /\ setupGrants = 0
  /\ setupWithUsers = FALSE
  /\ oldSetupWorked = FALSE
  /\ grantedWhileRevoked = FALSE
  /\ okWhileRevoked = FALSE
  /\ okAfterLogout = FALSE

Flags == <<setupGrants, setupWithUsers, oldSetupWorked, grantedWhileRevoked, okWhileRevoked,
           okAfterLogout>>
Agent == <<req, late, old, approvals, cli, lost, tokenLive>>

\* ---- The setup code ----

\* login.setup with the code from the log: `granted`, as owner.
\* A used setup code answers `taken`; after a restart with no user, the old code answers `wrong`.
AnnGivesTheSetupCode ==
  /\ setup = "unused"
  /\ ~HasUser
  /\ annCode = "current"
  /\ setup' = "used"
  /\ role' = [role EXCEPT !["ann"] = "owner"]
  /\ setupGrants' = setupGrants + 1
  /\ setupWithUsers' = (setupWithUsers \/ HasUser)
  /\ oldSetupWorked' = (oldSetupWorked \/ annCode = "old")
  /\ UNCHANGED <<annCode, busy, Agent, grantedWhileRevoked, okWhileRevoked, okAfterLogout>>

\* Users, tokens and codes survive a restart. While there is no user, each start
\* prints a new setup code, and the one before stops working.
TheServerRestarts ==
  /\ annCode' = IF HasUser THEN annCode ELSE "old"
  /\ UNCHANGED <<setup, role, busy, Agent, Flags>>

AnnReadsTheNewSetupCode ==
  /\ annCode = "old"
  /\ ~HasUser
  /\ annCode' = "current"
  /\ UNCHANGED <<setup, role, busy, Agent, Flags>>

\* ---- The agent's login ----

\* login.start { name, digest }: a new pending code, or `slow` at a limit.
\* (`taken` cannot happen here: the agent's name is free whenever its CLI is out.)
TheAgentStartsALogin ==
  /\ cli \in {"out", "slow"}
  /\ IF busy
       THEN /\ cli' = "slow"
            /\ UNCHANGED <<req, late, approvals>>
       ELSE /\ req' = "pending" /\ late' = FALSE /\ approvals' = 0
            /\ cli' = "waiting"
  /\ UNCHANGED <<setup, annCode, role, old, lost, tokenLive, busy, Flags>>

\* Other logins from the agent's address, or from anywhere, reach a limit; and later
\* a minute passes, or those codes end.
TheAddressReachesALimit ==
  /\ ~busy /\ busy' = TRUE
  /\ UNCHANGED <<setup, annCode, role, Agent, Flags>>

TheLimitClears ==
  /\ busy /\ busy' = FALSE
  /\ UNCHANGED <<setup, annCode, role, Agent, Flags>>

\* Ctrl-C, or `--no-wait`: the CLI keeps the request and its token, to `--resume`.
TheAgentStopsWaiting ==
  /\ cli = "waiting"
  /\ cli' = "stopped" /\ lost' = FALSE
  /\ UNCHANGED <<setup, annCode, role, req, late, old, approvals, tokenLive, busy, Flags>>

\* `easel login --resume`.
TheAgentResumes ==
  /\ cli = "stopped"
  /\ cli' = "waiting"
  /\ UNCHANGED <<setup, annCode, role, req, late, old, approvals, lost, tokenLive, busy, Flags>>

\* users.approve [--owner]: `approved` on a pending code; the digest becomes a
\* live token. On any other code it answers `gone` and changes nothing.
Approve(asRole) ==
  /\ Owners # {}
  /\ code = "pending"
  /\ req' = "approved"
  /\ approvals' = approvals + 1
  /\ role' = [role EXCEPT !["builder"] = asRole]
  /\ tokenLive' = TRUE
  /\ UNCHANGED <<setup, annCode, late, old, cli, lost, busy, Flags>>

AnOwnerApprovesItsCode == Approve("member")
AnOwnerApprovesItsCodeAsOwner == Approve("owner")

\* users.deny on a pending code.
AnOwnerDeniesItsCode ==
  /\ Owners # {}
  /\ code = "pending"
  /\ req' = "denied"
  /\ UNCHANGED <<setup, annCode, role, late, old, approvals, cli, lost, tokenLive, busy, Flags>>

\* A code nobody approves runs out after 10 minutes, whether or not the CLI waits.
\* Nothing is written: its time passes, and it reads as expired from then on.
TheCodeRunsOut ==
  /\ code = "pending"
  /\ late' = TRUE
  /\ UNCHANGED <<setup, annCode, role, req, old, approvals, cli, lost, tokenLive, busy, Flags>>

\* login.wait on an approved code whose token works: `granted`. It carries no token.
WaitAnswersGranted ==
  /\ cli = "waiting"
  /\ req = "approved"
  /\ tokenLive
  /\ grantedWhileRevoked' = (grantedWhileRevoked \/ ~AgentIsUser)

TheAgentIsSignedIn ==
  /\ WaitAnswersGranted
  /\ cli' = "in" /\ req' = "none" /\ lost' = FALSE
  /\ UNCHANGED <<setup, annCode, role, late, old, approvals, tokenLive, busy,
                 setupGrants, setupWithUsers, oldSetupWorked, okWhileRevoked, okAfterLogout>>

\* The server answers `granted`, but the answer never reaches the CLI. The CLI
\* still holds its token, and asks again.
TheGrantedAnswerIsLost ==
  /\ WaitAnswersGranted
  /\ ~lost
  /\ lost' = TRUE
  /\ UNCHANGED <<setup, annCode, role, req, late, old, approvals, cli, tokenLive, busy,
                 setupGrants, setupWithUsers, oldSetupWorked, okWhileRevoked, okAfterLogout>>

\* login.wait: `denied` (denied, or revoked) or `expired`. The CLI drops its token.
TheAgentIsToldDenied ==
  /\ cli = "waiting"
  /\ code = "denied"
  /\ cli' = "out" /\ req' = "none" /\ lost' = FALSE
  /\ UNCHANGED <<setup, annCode, role, late, old, approvals, tokenLive, busy, Flags>>

\* The server still keeps the code that ran out; it reads as expired.
TheAgentIsToldItRanOut ==
  /\ cli = "waiting"
  /\ code = "expired"
  /\ cli' = "out" /\ req' = "none" /\ late' = FALSE /\ old' = "pending"
  /\ UNCHANGED <<setup, annCode, role, approvals, lost, tokenLive, busy, Flags>>

\* ---- Revoke and sign out ----

\* The write that removes a user (users.revoke and login.end share it). Each kept
\* code of the user's that was approved, or that is pending and not past its time,
\* is denied. A code past its time stays as it is, so it still reads expired.
EndOnRemove(state, isLate) ==
  IF state = "approved" \/ (state = "pending" /\ ~isLate) THEN "denied" ELSE state

Remove(p, mark) ==
  /\ role' = [role EXCEPT ![p] = mark]
  /\ IF p = "builder"
       THEN /\ tokenLive' = FALSE
            /\ req' = EndOnRemove(req, late)
            /\ old' = EndOnRemove(old, TRUE)
            /\ lost' = FALSE
       ELSE UNCHANGED <<tokenLive, req, old, lost>>

\* users.revoke: the user's tokens stop working and its codes end (wait answers
\* `denied`). The last owner answers `last` and nothing changes.
Revoke(p) ==
  /\ Owners # {}
  /\ p \in Users
  /\ Owners # {p}
  /\ Remove(p, "revoked")
  /\ UNCHANGED <<setup, annCode, late, approvals, cli, busy, Flags>>

AnOwnerRevokesTheAgent == Revoke("builder")
AnOwnerRevokesAnn == Revoke("ann")

\* login.end, with the caller's working token. The last owner is answered `last`,
\* and nothing changes: it stays an owner, and its token still works. Otherwise
\* the user goes; on `ended` the CLI deletes its token. When that answer is lost,
\* the CLI still holds a token that the server no longer accepts.
Logout(p, heard) ==
  /\ p \in Users
  /\ p = "builder" => (cli = "in" /\ tokenLive)
  /\ IF Owners = {p}
       THEN UNCHANGED vars
       ELSE /\ Remove(p, "gone")
            /\ cli' = IF p = "builder" /\ heard THEN "out" ELSE cli
            /\ UNCHANGED <<setup, annCode, late, approvals, busy, Flags>>

AnnLogsOut == Logout("ann", TRUE)
TheAgentLogsOut == Logout("builder", TRUE)
TheLogoutAnswerIsLost == Logout("builder", FALSE)

\* ---- Calls with the agent's token ----

TheAgentMakesACall ==
  /\ cli = "in"
  /\ tokenLive
  /\ okWhileRevoked' = (okWhileRevoked \/ (~AgentIsUser /\ role["builder"] # "gone"))
  /\ okAfterLogout' = (okAfterLogout \/ role["builder"] = "gone")
  /\ UNCHANGED <<setup, annCode, role, busy, Agent,
                 setupGrants, setupWithUsers, oldSetupWorked, grantedWhileRevoked>>

\* Refused { signIn: true }: the CLI drops the token and says to log in again.
TheAgentsCallIsRefused ==
  /\ cli = "in"
  /\ ~tokenLive
  /\ cli' = "out"
  /\ UNCHANGED <<setup, annCode, role, req, late, old, approvals, lost, tokenLive, busy, Flags>>

Next ==
  \/ AnnGivesTheSetupCode \/ TheServerRestarts \/ AnnReadsTheNewSetupCode
  \/ TheAgentStartsALogin \/ TheAddressReachesALimit \/ TheLimitClears
  \/ TheAgentStopsWaiting \/ TheAgentResumes
  \/ AnOwnerApprovesItsCode \/ AnOwnerApprovesItsCodeAsOwner \/ AnOwnerDeniesItsCode
  \/ TheCodeRunsOut
  \/ TheAgentIsSignedIn \/ TheGrantedAnswerIsLost
  \/ TheAgentIsToldDenied \/ TheAgentIsToldItRanOut
  \/ AnOwnerRevokesTheAgent \/ AnOwnerRevokesAnn
  \/ AnnLogsOut \/ TheAgentLogsOut \/ TheLogoutAnswerIsLost
  \/ TheAgentMakesACall \/ TheAgentsCallIsRefused

\* The CLI keeps asking while a granted answer is there to get.
Spec == Init /\ [][Next]_vars /\ WF_vars(TheAgentIsSignedIn)

\* ---- Rules, in the reader's words ----

\* "The setup code works once, and only while the server has no user."
SetupCodeWorksOnce == setupGrants <= 1
SetupCodeOnlyWhileNoUser == ~setupWithUsers

\* "Each start while there is no user prints a new setup code; the one before stops working."
AnOldSetupCodeNeverWorks == ~oldSetupWorked

\* "A code is single use: a second approve answers gone."
ACodeIsApprovedAtMostOnce == approvals <= 1

\* "A denied or expired code stays so, also when its user is revoked or logs out.
\* An approved code ends only by a revoke or a logout." (The CLI dropping its
\* request is "none"; a kept code that ran out is `old` from then on.)
ACodeThatEndedStaysEnded ==
  [][ /\ code \in {"denied", "expired"} => code' \in {code, "none"}
      /\ code = "expired" /\ code' = "none" => oldCode' = "expired"
      /\ code = "approved" => code' \in {"approved", "denied", "none"}
      /\ oldCode = "expired" => oldCode' = "expired" ]_vars

\* "A token works only while its user is a user: a revoke or a logout ends it."
ATokenWorksOnlyForAUser == tokenLive => AgentIsUser

\* "A revoked user is never signed in": login.wait never answers it granted,
\* and its next call is refused.
ARevokedUserIsNeverToldGranted == ~grantedWhileRevoked
ARevokedUserIsRefused == ~okWhileRevoked

\* "A logged-out user is refused": its token ends with the logout, so a call with
\* it is refused, also when the logout's answer was lost and the CLI still holds it.
ALoggedOutUserIsRefused == ~okAfterLogout

\* "A lost granted answer still signs the agent in": the CLI holds a token that
\* works until it hears the answer ...
AWorkingTokenIsNeverDropped == tokenLive => HoldsToken

\* ... and a CLI that waits on an approved code gets signed in, unless revoked
\* or stopped first.
ALostGrantedAnswerStillSignsTheAgentIn ==
  (cli = "waiting" /\ lost) ~> (cli \in {"in", "stopped"} \/ ~tokenLive)

\* "There is always an owner": once the setup code is used, revoke never
\* removes the last owner (it answers `last`).
ThereIsAlwaysAnOwner == setup = "used" => Owners # {}

\* "The last owner cannot log out": login.end answers `last` and changes nothing,
\* as users.revoke does. While p is the only owner, no step changes p's role, and
\* no step ends the agent's token while the agent is the only owner.
LastOwnerLogoutChangesNothing ==
  [][ \A p \in People :
        Owners = {p} => /\ role'[p] = role[p]
                        /\ (p = "builder" => tokenLive' = tokenLive) ]_vars
====
