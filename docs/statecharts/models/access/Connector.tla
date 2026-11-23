---- MODULE Connector ----
\* easel mcp-auth: a Claude connector signs in with a password that an owner
\* makes first (SPEC-mcp-auth.md). One connector user, ann-claude. Ann is an
\* owner. The person is Ann's Claude client. Someone else can get the password
\* too (the accepted risk of the spec).
\*
\* The password works one time, and runs out. The sign-in uses it, makes the
\* authorization code and binds the user in one write. The code gives the first
\* tokens. A refresh gives a new access token and a new refresh token.
\*
\* KeepPrevious is the rule of the refresh token, after Cloudflare's
\* workers-oauth-provider: the token that was used last still works until the
\* new one is used. So a lost answer does not stop the connector: the client
\* asks again with the token it holds. With KeepPrevious = FALSE, the old token
\* stops at once, and the next config shows what breaks.
\*
\* A refresh token older than these two stops the connector (OAuth 2.1, 4.3.1).
\* A copy of an old token is one step: "an old refresh token is used again".
\*
\* Time is coarse: "the password runs out", "the code runs out" and "the access
\* token runs out" are steps.
EXTENDS Naturals

CONSTANT KeepPrevious

VARIABLES
  user,       \* the connector user: "none" | "waiting" (has a password) | "in" (bound to a client) | "revoked"
  pw,         \* its password: "none" | "live" | "late" (ran out) | "used"
  code,       \* the authorization code of the person's sign-in: "none" | "live"
  grant,      \* the tokens of the person's sign-in, at the server: "none" | "live" | "stopped"
  cl,         \* the person's Claude client: "out" | "toldNo" | "code" | "in"
  held,       \* the refresh token the client holds: "none" | "cur" (the newest) | "prev" (the one used last)
  atOk,       \* the access token the client holds works at the server
  other,      \* someone else signed in with the password, and has a live connector
  signIns,    \* how many sign-ins the current password made
  exchanges,  \* how many times the current code gave tokens
  latePwWorked,      \* a password that ran out signed someone in
  callWhileStopped,  \* a call was answered while the person's tokens were stopped or the user was revoked
  refreshWhileStopped, \* a refresh was answered while the tokens were stopped or the user was revoked
  ownClientStopped   \* the person's own client, with no copy of a token, stopped its connector

vars == <<user, pw, code, grant, cl, held, atOk, other, signIns, exchanges,
          latePwWorked, callWhileStopped, refreshWhileStopped, ownClientStopped>>

Flags == <<latePwWorked, callWhileStopped, refreshWhileStopped, ownClientStopped>>

TypeOK ==
  /\ user \in {"none", "waiting", "in", "revoked"}
  /\ pw \in {"none", "live", "late", "used"}
  /\ code \in {"none", "live"}
  /\ grant \in {"none", "live", "stopped"}
  /\ cl \in {"out", "toldNo", "code", "in"}
  /\ held \in {"none", "cur", "prev"}
  /\ atOk \in BOOLEAN /\ other \in BOOLEAN
  /\ signIns \in 0..1 /\ exchanges \in 0..1
  /\ (pw # "none") <=> (user \in {"waiting", "in"})
  /\ (held # "none") <=> (cl = "in")

Init ==
  /\ user = "none" /\ pw = "none" /\ code = "none" /\ grant = "none"
  /\ cl = "out" /\ held = "none" /\ atOk = FALSE /\ other = FALSE
  /\ signIns = 0 /\ exchanges = 0
  /\ latePwWorked = FALSE /\ callWhileStopped = FALSE
  /\ refreshWhileStopped = FALSE /\ ownClientStopped = FALSE

\* ---- The password ----

\* users.add: the name is free (never used, or revoked). The person gets the
\* password, and tries again if Claude told it no before.
AnOwnerMakesAPassword ==
  /\ user \in {"none", "revoked"}
  /\ user' = "waiting" /\ pw' = "live"
  /\ signIns' = 0
  /\ cl' = IF cl = "toldNo" THEN "out" ELSE cl
  /\ UNCHANGED <<code, grant, held, atOk, other, exchanges, Flags>>

ThePasswordRunsOut ==
  /\ pw = "live"
  /\ pw' = "late"
  /\ UNCHANGED <<user, code, grant, cl, held, atOk, other, signIns, exchanges, Flags>>

\* ---- The sign-in page ----

\* POST /oauth/authorize with the right name and password: one write uses the
\* password, makes the code and binds the user. The page redirects to Claude.
SignIn ==
  /\ user = "waiting"
  /\ pw = "live"
  /\ pw' = "used" /\ user' = "in"
  /\ signIns' = signIns + 1
  /\ latePwWorked' = (latePwWorked \/ pw = "late")

ThePersonSignsIn ==
  /\ cl = "out"
  /\ SignIn
  /\ cl' = "code" /\ code' = "live" /\ exchanges' = 0
  /\ UNCHANGED <<grant, held, atOk, other, callWhileStopped, refreshWhileStopped, ownClientStopped>>

\* The page says "This password does not work now" (used, ran out, or revoked).
ThePersonIsToldThePasswordDoesNotWork ==
  /\ cl = "out"
  /\ user # "none"
  /\ ~(pw = "live" /\ user = "waiting")
  /\ cl' = "toldNo"
  /\ UNCHANGED <<user, pw, code, grant, held, atOk, other, signIns, exchanges, Flags>>

SomeoneElseSignsIn ==
  /\ ~other
  /\ SignIn
  /\ other' = TRUE
  /\ UNCHANGED <<code, grant, cl, held, atOk, exchanges,
                 callWhileStopped, refreshWhileStopped, ownClientStopped>>

\* ---- The code ----

TheCodeRunsOut ==
  /\ code = "live"
  /\ code' = "none"
  /\ UNCHANGED <<user, pw, grant, cl, held, atOk, other, signIns, exchanges, Flags>>

\* POST /oauth/token, authorization_code, with the right verifier: the code is
\* used, and the first tokens are made.
CodeGivesTokens ==
  /\ cl = "code"
  /\ code = "live"
  /\ code' = "none"
  /\ grant' = "live"
  /\ exchanges' = exchanges + 1

TheClientGetsItsTokens ==
  /\ CodeGivesTokens
  /\ cl' = "in" /\ held' = "cur" /\ atOk' = TRUE
  /\ UNCHANGED <<user, pw, other, signIns, Flags>>

\* The tokens are made, but the answer does not reach Claude. Claude still holds
\* the code, and asks again.
TheTokenAnswerIsLost ==
  /\ CodeGivesTokens
  /\ UNCHANGED <<user, pw, cl, held, atOk, other, signIns, Flags>>

\* The code is used, or ran out, or the user was revoked: `invalid_grant`. A code
\* that is used a second time stops the tokens that it gave (OAuth 2.1, 4.1.3).
TheCodeIsRefused ==
  /\ cl = "code"
  /\ code = "none"
  /\ cl' = "toldNo"
  /\ grant' = IF grant = "live" THEN "stopped" ELSE grant
  /\ UNCHANGED <<user, pw, code, held, atOk, other, signIns, exchanges, Flags>>

\* ---- The tokens ----

TheAccessTokenRunsOut ==
  /\ atOk
  /\ atOk' = FALSE
  /\ UNCHANGED <<user, pw, code, grant, cl, held, other, signIns, exchanges, Flags>>

TheClientMakesACall ==
  /\ cl = "in"
  /\ atOk
  /\ callWhileStopped' = (callWhileStopped \/ grant # "live" \/ user # "in")
  /\ UNCHANGED <<user, pw, code, grant, cl, held, atOk, other, signIns, exchanges,
                 latePwWorked, refreshWhileStopped, ownClientStopped>>

RefreshWorks ==
  /\ grant = "live"
  /\ \/ held = "cur"
     \/ held = "prev" /\ KeepPrevious

\* POST /oauth/token, refresh_token: a new access token and a new refresh token.
\* The token that was used becomes the one used last.
Refresh(heard) ==
  /\ cl = "in"
  /\ RefreshWorks
  /\ held' = IF heard THEN "cur" ELSE "prev"
  /\ atOk' = IF heard THEN TRUE ELSE atOk
  /\ refreshWhileStopped' = (refreshWhileStopped \/ user # "in")
  /\ UNCHANGED <<user, pw, code, grant, cl, other, signIns, exchanges,
                 latePwWorked, callWhileStopped, ownClientStopped>>

TheClientRefreshes == Refresh(TRUE)
TheRefreshAnswerIsLost == Refresh(FALSE)

\* `invalid_grant`. A refresh token that is not one of the two that work, on
\* tokens that still work, is a reuse: it stops them.
TheRefreshIsRefused ==
  /\ cl = "in"
  /\ ~RefreshWorks
  /\ cl' = "toldNo" /\ held' = "none" /\ atOk' = FALSE
  /\ grant' = IF grant = "live" THEN "stopped" ELSE grant
  /\ ownClientStopped' = (ownClientStopped \/ grant = "live")
  /\ UNCHANGED <<user, pw, code, other, signIns, exchanges,
                 latePwWorked, callWhileStopped, refreshWhileStopped>>

AnOldRefreshTokenIsUsedAgain ==
  /\ grant = "live"
  /\ grant' = "stopped" /\ atOk' = FALSE
  /\ UNCHANGED <<user, pw, code, cl, held, other, signIns, exchanges, Flags>>

\* ---- Revoke ----

\* users.revoke ann-claude: one write ends the user, its password, its code and
\* all its tokens, also those of someone else who signed in with the password.
AnOwnerRevokesTheConnector ==
  /\ user \in {"waiting", "in"}
  /\ user' = "revoked" /\ pw' = "none" /\ code' = "none"
  /\ grant' = IF grant = "live" THEN "stopped" ELSE grant
  /\ atOk' = FALSE /\ other' = FALSE
  /\ UNCHANGED <<cl, held, signIns, exchanges, Flags>>

Next ==
  \/ AnOwnerMakesAPassword \/ ThePasswordRunsOut
  \/ ThePersonSignsIn \/ ThePersonIsToldThePasswordDoesNotWork \/ SomeoneElseSignsIn
  \/ TheCodeRunsOut \/ TheClientGetsItsTokens \/ TheTokenAnswerIsLost \/ TheCodeIsRefused
  \/ TheAccessTokenRunsOut \/ TheClientMakesACall
  \/ TheClientRefreshes \/ TheRefreshAnswerIsLost \/ TheRefreshIsRefused
  \/ AnOldRefreshTokenIsUsedAgain
  \/ AnOwnerRevokesTheConnector

Spec == Init /\ [][Next]_vars /\ WF_vars(TheClientRefreshes \/ TheRefreshIsRefused)

\* ---- Rules, in the reader's words ----

\* "The password works one time."
APasswordWorksOnce == signIns <= 1

\* "A password that ran out never signs anyone in."
ALatePasswordNeverWorks == ~latePwWorked

\* "An authorization code works one time."
ACodeWorksOnce == exchanges <= 1

\* "After a revoke, no call and no refresh is answered."
NoCallAfterARevoke == ~callWhileStopped
NoRefreshAfterARevoke == ~refreshWhileStopped

\* "A token works only for a connector user that is signed in."
ATokenWorksOnlyForAUser == (atOk \/ grant = "live") => user = "in"

\* "A lost refresh answer does not stop the connector": only a revoke, a copy of
\* an old token or a used code stops it, never the person's own client.
ALostAnswerNeverStopsTheConnector == ~ownClientStopped

\* "A connector whose tokens work stays connected": while its tokens are live,
\* the client gets a working access token in the end, unless it is stopped first.
AWorkingConnectorGetsAnAccessToken ==
  (cl = "in" /\ grant = "live") ~> (atOk \/ grant # "live" \/ cl # "in")
====
