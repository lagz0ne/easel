---- MODULE Browser ----
\* easel home: a browser signs in (SPEC-home.md). One user, U. Three browsers:
\* the phone of U shows a one-time code, and an owner approves it; the laptop of
\* U opens a sign-in link that `easel open` printed; a copy of that link is in
\* another browser (a link preview, or a message sent on).
\*
\* A browser is "in" while it holds a cookie of a live session. It is "ended"
\* while it holds the cookie of a session that ended (a revoke, an owner's end,
\* or 30 days with no use): its next read is refused, and it shows the sign-in.
\*
\* OneWrite is the rule of the link: one write checks that the link is live,
\* uses it and makes the session. With OneWrite = FALSE, a browser checks the
\* link, then makes its session in a second write, and the second config shows
\* what breaks.
\*
\* Time is coarse: "the code runs out", "the link runs out" and "the session
\* ends" are steps.
EXTENDS Naturals

CONSTANT OneWrite

VARIABLES
  user,       \* U: "live" | "revoked"
  link,       \* the sign-in link of U: "none" | "live" | "used" | "ended" (ran out, or revoked)
  phone,      \* "out" | "pending" (shows a code) | "approved" | "in" | "ended"
  laptop,     \* "out" | "checked" (OneWrite = FALSE only) | "in" | "ended"
  copy,       \* "out" | "checked" (OneWrite = FALSE only) | "in" | "ended"
  linkSignIns, \* how many browsers the current link signed in
  noGrant,     \* a browser got a session with no approved code and no live link
  readRevoked  \* a read was answered for a browser of U after U was revoked

vars == <<user, link, phone, laptop, copy, linkSignIns, noGrant, readRevoked>>

Opener == {"out", "checked", "in", "ended"}

TypeOK ==
  /\ user \in {"live", "revoked"}
  /\ link \in {"none", "live", "used", "ended"}
  /\ phone \in {"out", "pending", "approved", "in", "ended"}
  /\ laptop \in Opener /\ copy \in Opener
  /\ linkSignIns \in 0..2
  /\ noGrant \in BOOLEAN /\ readRevoked \in BOOLEAN

Init ==
  /\ user = "live" /\ link = "none"
  /\ phone = "out" /\ laptop = "out" /\ copy = "out"
  /\ linkSignIns = 0 /\ noGrant = FALSE /\ readRevoked = FALSE

\* ---- The code (the phone) ----

\* browser.start: the sign-in page asks for a code and shows it.
ThePhoneShowsACode ==
  /\ phone = "out"
  /\ phone' = "pending"
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, noGrant, readRevoked>>

\* users.approve <code>, from the CLI or the home page of an owner.
AnOwnerApprovesTheCode ==
  /\ phone = "pending" /\ user = "live"
  /\ phone' = "approved"
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, noGrant, readRevoked>>

\* users.deny <code>: the page says so, and shows a new code.
AnOwnerDeniesTheCode ==
  /\ phone = "pending"
  /\ phone' = "out"
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, noGrant, readRevoked>>

\* 10 minutes: a pending code, or an approved one that no browser used.
TheCodeRunsOut ==
  /\ phone \in {"pending", "approved"}
  /\ phone' = "out"
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, noGrant, readRevoked>>

\* POST /auth/code: one write uses the approved code and makes the session.
ThePhoneSignsIn ==
  /\ phone = "approved" /\ user = "live"
  /\ phone' = "in"
  /\ noGrant' = (noGrant \/ phone # "approved")
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, readRevoked>>

\* ---- The link (the laptop, and a copy) ----

\* browser.link, by the CLI of U (easel open): a new link, for 5 minutes.
TheCliMakesALink ==
  /\ user = "live" /\ link # "live"
  /\ link' = "live" /\ linkSignIns' = 0
  /\ UNCHANGED <<user, phone, laptop, copy, noGrant, readRevoked>>

TheLinkRunsOut ==
  /\ link = "live"
  /\ link' = "ended"
  /\ UNCHANGED <<user, phone, laptop, copy, linkSignIns, noGrant, readRevoked>>

\* POST /auth/open with OneWrite: the check, the use and the session are one write.
UseTheLink(b) ==
  /\ b = "out" /\ OneWrite
  /\ link = "live" /\ user = "live"
  /\ link' = "used" /\ linkSignIns' = linkSignIns + 1
  /\ noGrant' = (noGrant \/ link # "live")

\* With OneWrite = FALSE: the first write finds the link live ...
CheckTheLink(b) ==
  /\ b = "out" /\ ~OneWrite
  /\ link = "live" /\ user = "live"

\* ... and the second write uses it and makes the session, with no new look.
UseTheCheckedLink(b) ==
  /\ b = "checked"
  /\ link' = "used" /\ linkSignIns' = linkSignIns + 1
  /\ noGrant' = (noGrant \/ link # "live")

TheLaptopOpensTheLink ==
  /\ UseTheLink(laptop)
  /\ laptop' = "in"
  /\ UNCHANGED <<user, phone, copy, readRevoked>>

TheLaptopChecksTheLink ==
  /\ CheckTheLink(laptop)
  /\ laptop' = "checked"
  /\ UNCHANGED <<user, link, phone, copy, linkSignIns, noGrant, readRevoked>>

TheLaptopUsesTheCheckedLink ==
  /\ UseTheCheckedLink(laptop)
  /\ laptop' = "in"
  /\ UNCHANGED <<user, phone, copy, readRevoked>>

TheCopyOpensTheLink ==
  /\ UseTheLink(copy)
  /\ copy' = "in"
  /\ UNCHANGED <<user, phone, laptop, readRevoked>>

TheCopyChecksTheLink ==
  /\ CheckTheLink(copy)
  /\ copy' = "checked"
  /\ UNCHANGED <<user, link, phone, laptop, linkSignIns, noGrant, readRevoked>>

TheCopyUsesTheCheckedLink ==
  /\ UseTheCheckedLink(copy)
  /\ copy' = "in"
  /\ UNCHANGED <<user, phone, laptop, readRevoked>>

\* ---- A session ----

Read(b) == readRevoked' = (readRevoked \/ (b = "in" /\ user = "revoked"))

ThePhoneReads ==
  /\ phone = "in" /\ Read(phone)
  /\ UNCHANGED <<user, link, phone, laptop, copy, linkSignIns, noGrant>>

TheLaptopReads ==
  /\ laptop = "in" /\ Read(laptop)
  /\ UNCHANGED <<user, link, phone, laptop, copy, linkSignIns, noGrant>>

TheCopyReads ==
  /\ copy = "in" /\ Read(copy)
  /\ UNCHANGED <<user, link, phone, laptop, copy, linkSignIns, noGrant>>

\* POST /auth/out: the session ends, and the cookie goes.
ThePhoneSignsOut ==
  /\ phone = "in" /\ phone' = "out"
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, noGrant, readRevoked>>

TheLaptopSignsOut ==
  /\ laptop = "in" /\ laptop' = "out"
  /\ UNCHANGED <<user, link, phone, copy, linkSignIns, noGrant, readRevoked>>

\* users.end <session>, or 30 days with no use: the browser still holds the cookie.
ThePhoneSessionEnds ==
  /\ phone = "in" /\ phone' = "ended"
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, noGrant, readRevoked>>

TheLaptopSessionEnds ==
  /\ laptop = "in" /\ laptop' = "ended"
  /\ UNCHANGED <<user, link, phone, copy, linkSignIns, noGrant, readRevoked>>

TheCopySessionEnds ==
  /\ copy = "in" /\ copy' = "ended"
  /\ UNCHANGED <<user, link, phone, laptop, linkSignIns, noGrant, readRevoked>>

\* The next read of a browser whose session ended is refused: it shows the sign-in.
ThePhoneIsRefused ==
  /\ phone = "ended" /\ phone' = "out"
  /\ UNCHANGED <<user, link, laptop, copy, linkSignIns, noGrant, readRevoked>>

TheLaptopIsRefused ==
  /\ laptop = "ended" /\ laptop' = "out"
  /\ UNCHANGED <<user, link, phone, copy, linkSignIns, noGrant, readRevoked>>

TheCopyIsRefused ==
  /\ copy = "ended" /\ copy' = "out"
  /\ UNCHANGED <<user, link, phone, laptop, linkSignIns, noGrant, readRevoked>>

\* ---- Revoke ----

Ends(b) == IF b = "in" THEN "ended" ELSE b

\* users.revoke U: one write ends U, its codes, its link and all its sessions.
AnOwnerRevokesTheUser ==
  /\ user = "live"
  /\ user' = "revoked"
  /\ link' = IF link = "live" THEN "ended" ELSE link
  /\ phone' = IF phone \in {"pending", "approved"} THEN "out" ELSE Ends(phone)
  /\ laptop' = Ends(laptop) /\ copy' = Ends(copy)
  /\ UNCHANGED <<linkSignIns, noGrant, readRevoked>>

Next ==
  \/ ThePhoneShowsACode \/ AnOwnerApprovesTheCode \/ AnOwnerDeniesTheCode
  \/ TheCodeRunsOut \/ ThePhoneSignsIn
  \/ TheCliMakesALink \/ TheLinkRunsOut
  \/ TheLaptopOpensTheLink \/ TheLaptopChecksTheLink \/ TheLaptopUsesTheCheckedLink
  \/ TheCopyOpensTheLink \/ TheCopyChecksTheLink \/ TheCopyUsesTheCheckedLink
  \/ ThePhoneReads \/ TheLaptopReads \/ TheCopyReads
  \/ ThePhoneSignsOut \/ TheLaptopSignsOut
  \/ ThePhoneSessionEnds \/ TheLaptopSessionEnds \/ TheCopySessionEnds
  \/ ThePhoneIsRefused \/ TheLaptopIsRefused \/ TheCopyIsRefused
  \/ AnOwnerRevokesTheUser

Spec == Init /\ [][Next]_vars /\ WF_vars(ThePhoneSignsIn)

\* ---- Rules, in the reader's words ----

\* "A browser has a session only after an owner approved its code, or after it
\* used a sign-in link."
ASessionNeedsAnApprovedCodeOrALiveLink == ~noGrant

\* "A sign-in link signs in at most one browser."
ALinkSignsInAtMostOneBrowser == linkSignIns <= 1

\* "After a revoke, no browser of that user reads a canvas."
NoReadAfterARevoke == ~readRevoked

\* "After a revoke, no browser of that user holds a live session."
ARevokedUserHasNoLiveSession ==
  user = "revoked" => "in" \notin {phone, laptop, copy}

\* "An approved code signs the phone in, unless it runs out or U is revoked first."
AnApprovedCodeSignsThePhoneIn ==
  (phone = "approved") ~> (phone \in {"in", "out"})
====
