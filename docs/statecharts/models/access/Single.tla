---- MODULE Single ----
\* easel single: one person and one project on a public server (SPEC-single.md).
\* It is the access-browser model (Browser.tla) with the rules of EASEL_AUTH=single.
\*
\* Four names: "p" is the name of the person before a rename (rocky), "q" is its
\* name after (lagz0ne), "a" is an agent member with a token of `easel users add`
\* (vibea-claude), and "x" is a name that a stranger types (bob). "-" is no name.
\*
\* Three browsers: the phone shows a one-time code, and the person approves it;
\* the laptop opens a sign-in link of `easel open`; a copy of that link is in a
\* third browser. The CLI of the person, or of the agent, runs `easel open`.
\*
\* Single = TRUE is EASEL_AUTH=single: the code has no name and is for the person,
\* and an approve never makes a user. With Single = FALSE, the server keeps the
\* steps of approve (a name on the sign-in page, an approve that makes a user for a
\* new name), and the second config shows what breaks.
\*
\* A session that ends (a sign-out, users.end, a revoke, 30 days with no use) goes
\* to "out" at once: access-browser shows that the next read of such a browser is
\* refused. Time is coarse: "the code runs out" and "the link runs out" are steps.
EXTENDS Naturals, FiniteSets

CONSTANT Single

Names == {"p", "q", "a", "x"}

VARIABLES
  role,       \* [Names -> "none" | "owner" | "member"]
  phone,      \* "out" | "pending" (shows a code) | "approved" | "in"
  phoneName,  \* the name of the code, then of the session; "-" when out
  link,       \* "none" | "live" | "used" | "ended" (ran out, or revoked)
  linkName,   \* the name of the CLI that ran `easel open`, while the link is live
  laptop,     \* "out" | "in"
  laptopName, \* the name of the session of the laptop; "-" when out
  copy,       \* "out" | "in"
  copyName,   \* the name of the session of the copy; "-" when out
  linkSignIns, \* how many browsers the current link signed in
  noGrant,     \* a browser got a session with no approved code and no live link
  readGone     \* a read was answered for a browser of a name that is no user

vars == <<role, phone, phoneName, link, linkName, laptop, laptopName, copy, copyName,
          linkSignIns, noGrant, readGone>>

Owners == {n \in Names : role[n] = "owner"}

Person == CHOOSE n \in {"p", "q"} : role[n] = "owner"

TypeOK ==
  /\ role \in [Names -> {"none", "owner", "member"}]
  /\ phone \in {"out", "pending", "approved", "in"}
  /\ link \in {"none", "live", "used", "ended"}
  /\ laptop \in {"out", "in"} /\ copy \in {"out", "in"}
  /\ {phoneName, linkName, laptopName, copyName} \subseteq Names \cup {"-"}
  /\ linkSignIns \in 0..2
  /\ noGrant \in BOOLEAN /\ readGone \in BOOLEAN

Init ==
  /\ role = [n \in Names |-> CASE n = "p" -> "owner" [] n = "a" -> "member" [] OTHER -> "none"]
  /\ phone = "out" /\ phoneName = "-"
  /\ link = "none" /\ linkName = "-"
  /\ laptop = "out" /\ laptopName = "-"
  /\ copy = "out" /\ copyName = "-"
  /\ linkSignIns = 0 /\ noGrant = FALSE /\ readGone = FALSE

\* ---- The code (the phone) ----

\* browser.start. In single, the page has no name field: the code is for the person.
\* With Single = FALSE, the page asks for a name, and a stranger types "x".
ThePhoneShowsACode ==
  /\ phone = "out"
  /\ phone' = "pending"
  /\ phoneName' \in (IF Single THEN {Person} ELSE {Person, "x"})
  /\ UNCHANGED <<role, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant, readGone>>

\* users.approve <code>, by the person. In single, the name of each code is a user.
\* With Single = FALSE, an approve of a code for a new name makes that user.
ThePersonApprovesTheCode ==
  /\ phone = "pending"
  /\ phone' = "approved"
  /\ role' = IF role[phoneName] = "none" THEN [role EXCEPT ![phoneName] = "member"] ELSE role
  /\ UNCHANGED <<phoneName, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant, readGone>>

\* users.deny <code>, or 10 minutes: a pending code, or an approved one that no browser used.
TheCodeEnds ==
  /\ phone \in {"pending", "approved"}
  /\ phone' = "out" /\ phoneName' = "-"
  /\ UNCHANGED <<role, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant, readGone>>

\* POST /auth/code: one write uses the approved code and makes the session.
ThePhoneSignsIn ==
  /\ phone = "approved" /\ role[phoneName] # "none"
  /\ phone' = "in"
  /\ noGrant' = (noGrant \/ phone # "approved")
  /\ UNCHANGED <<role, phoneName, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, readGone>>

\* ---- The link (the laptop, and a copy) ----

\* browser.link, by the CLI of the person or of the agent (easel open).
TheCliMakesALink ==
  /\ link # "live"
  /\ \E n \in {Person, "a"} : role[n] # "none" /\ linkName' = n
  /\ link' = "live" /\ linkSignIns' = 0
  /\ UNCHANGED <<role, phone, phoneName, laptop, laptopName, copy, copyName,
                 noGrant, readGone>>

TheLinkRunsOut ==
  /\ link = "live"
  /\ link' = "ended" /\ linkName' = "-"
  /\ UNCHANGED <<role, phone, phoneName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant, readGone>>

\* POST /auth/open: the check, the use and the session are one write.
UseTheLink(b) ==
  /\ b = "out"
  /\ link = "live" /\ role[linkName] # "none"
  /\ link' = "used" /\ linkName' = "-" /\ linkSignIns' = linkSignIns + 1
  /\ noGrant' = (noGrant \/ link # "live")

TheLaptopOpensTheLink ==
  /\ UseTheLink(laptop)
  /\ laptop' = "in" /\ laptopName' = linkName
  /\ UNCHANGED <<role, phone, phoneName, copy, copyName, readGone>>

TheCopyOpensTheLink ==
  /\ UseTheLink(copy)
  /\ copy' = "in" /\ copyName' = linkName
  /\ UNCHANGED <<role, phone, phoneName, laptop, laptopName, readGone>>

\* ---- A session ----

Read(b, n) == readGone' = (readGone \/ (b = "in" /\ role[n] = "none"))

ThePhoneReads ==
  /\ phone = "in" /\ Read(phone, phoneName)
  /\ UNCHANGED <<role, phone, phoneName, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant>>

TheLaptopReads ==
  /\ laptop = "in" /\ Read(laptop, laptopName)
  /\ UNCHANGED <<role, phone, phoneName, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant>>

TheCopyReads ==
  /\ copy = "in" /\ Read(copy, copyName)
  /\ UNCHANGED <<role, phone, phoneName, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant>>

\* POST /auth/out, users.end <session>, or 30 days with no use.
ThePhoneSessionEnds ==
  /\ phone = "in" /\ phone' = "out" /\ phoneName' = "-"
  /\ UNCHANGED <<role, link, linkName, laptop, laptopName, copy, copyName,
                 linkSignIns, noGrant, readGone>>

TheLaptopSessionEnds ==
  /\ laptop = "in" /\ laptop' = "out" /\ laptopName' = "-"
  /\ UNCHANGED <<role, phone, phoneName, link, linkName, copy, copyName,
                 linkSignIns, noGrant, readGone>>

TheCopySessionEnds ==
  /\ copy = "in" /\ copy' = "out" /\ copyName' = "-"
  /\ UNCHANGED <<role, phone, phoneName, link, linkName, laptop, laptopName,
                 linkSignIns, noGrant, readGone>>

\* ---- Revoke and rename ----

Ends(b, n, gone) == IF n = gone THEN "out" ELSE b

NameAfter(n, gone) == IF n = gone THEN "-" ELSE n

\* users.revoke: one write ends the user, its codes, its link and its sessions.
\* The person is the last owner, so its revoke answers `last`; the agent can go.
\* With Single = FALSE, a user that a code made ("x") can go as well.
Revoke(gone) ==
  /\ role[gone] = "member"
  /\ role' = [role EXCEPT ![gone] = "none"]
  /\ link' = IF linkName = gone THEN "ended" ELSE link
  /\ linkName' = NameAfter(linkName, gone)
  /\ phone' = Ends(phone, phoneName, gone) /\ phoneName' = NameAfter(phoneName, gone)
  /\ laptop' = Ends(laptop, laptopName, gone) /\ laptopName' = NameAfter(laptopName, gone)
  /\ copy' = Ends(copy, copyName, gone) /\ copyName' = NameAfter(copyName, gone)
  /\ UNCHANGED <<linkSignIns, noGrant, readGone>>

ThePersonRevokesTheAgent == Revoke("a")

ThePersonRevokesTheStranger == Revoke("x")

Moved(n) == IF n = "p" THEN "q" ELSE n

\* users.rename p q: one write moves the user, its codes, its link and its sessions
\* to the new name. A name of a user, or of a code that waits, answers `taken`.
ThePersonIsRenamed ==
  /\ role["p"] = "owner" /\ role["q"] = "none"
  /\ phoneName # "q"
  /\ role' = [role EXCEPT !["p"] = "none", !["q"] = "owner"]
  /\ phoneName' = Moved(phoneName) /\ linkName' = Moved(linkName)
  /\ laptopName' = Moved(laptopName) /\ copyName' = Moved(copyName)
  /\ UNCHANGED <<phone, link, laptop, copy, linkSignIns, noGrant, readGone>>

Next ==
  \/ ThePhoneShowsACode \/ ThePersonApprovesTheCode \/ TheCodeEnds \/ ThePhoneSignsIn
  \/ TheCliMakesALink \/ TheLinkRunsOut \/ TheLaptopOpensTheLink \/ TheCopyOpensTheLink
  \/ ThePhoneReads \/ TheLaptopReads \/ TheCopyReads
  \/ ThePhoneSessionEnds \/ TheLaptopSessionEnds \/ TheCopySessionEnds
  \/ ThePersonRevokesTheAgent \/ ThePersonRevokesTheStranger \/ ThePersonIsRenamed

Spec == Init /\ [][Next]_vars /\ WF_vars(ThePhoneSignsIn)

\* ---- Rules, in the reader's words ----

Sessions == {<<phone, phoneName>>, <<laptop, laptopName>>, <<copy, copyName>>}

\* "Each session belongs to the person or to an agent, and to no other name."
ASessionIsThePersonsOrAnAgents ==
  \A s \in Sessions : s[1] = "in" => s[2] \in {Person, "a"}

\* "No step adds a person: the server has one owner, and no other user than the agent."
NoStepAddsAPerson ==
  /\ Cardinality(Owners) = 1
  /\ \A n \in Names \ {"a"} : role[n] # "member"

\* "A browser has a session only after an approved code, or a live link."
ASessionNeedsAnApprovedCodeOrALiveLink == ~noGrant

\* "A sign-in link signs in at most one browser."
ALinkSignsInAtMostOneBrowser == linkSignIns <= 1

\* "After a revoke, no browser of that user reads a canvas."
NoReadAfterARevoke == ~readGone

\* "Each live session belongs to a user: a revoke or a rename leaves none behind."
NoSessionOfANameThatIsGone ==
  \A s \in Sessions : s[1] = "in" => role[s[2]] # "none"

\* "An approved code signs the phone in, unless it ends or its user is revoked first."
AnApprovedCodeSignsThePhoneIn ==
  (phone = "approved") ~> (phone \in {"in", "out"})
====
