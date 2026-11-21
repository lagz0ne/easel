---- MODULE Share ----
\* SPEC-frames.md § Journeys, Share a canvas and § Journeys, Open a share link, and judged rules
\* 12-14: a share link on one canvas, a viewer's tab at one address, and someone else guessing
\* passwords from another address.
\* Links are numbered in the order they are made; only the newest can be live (S2).
\* Sharing a shared canvas keeps its link and sets, changes or removes the password; setting
\* or changing it ends every pass. Unshare ends the link. Either one closes the live watches of
\* the passes it ends, before it answers (S3). Wrong tries count per (address, link) (S5, D7):
\* within one minute, tries 1-5 that are wrong answer `wrong`; any try after 5 wrong ones
\* answers `slow`, even the right password. share.open with no password always answers `locked`
\* (the password page) on a password link, even while the address is slowed for wrong tries.
\* Left out: the flood limit (any open past 30 a minute per address answers `slow`, and the
\* page calls again after `retryIn`) and the cap of 1000 passes per link (an open past it ends
\* the link's oldest pass). Neither changes what a tab is shown in the end.
\* Time is coarse: "a minute passes" clears the wrong tries.
EXTENDS Naturals

CONSTANTS MaxWrong,  \* spec: 5 wrong tries in a minute (2 here, to keep the model small)
          MaxLinks,  \* bound on links made in one run (model size only)
          Passwords, \* the passwords a share may set; {"none"} while passwords are not built
          Unsharing  \* unshare is built (FALSE in a slice that ships share without it)

ASSUME "none" \in Passwords /\ Unsharing \in BOOLEAN

Addresses == {"viewer", "other"}

VARIABLES
  gen,      \* the newest link made (0: never shared)
  live,     \* the newest link is live (shared, not unshared)
  pw,       \* the newest link's password, or "none"
  wrong,    \* wrong[a]: wrong tries from address a on the newest link this minute
  tab,      \* the viewer's tab: "none" | "password" | "wrong" | "wait" | "open" | "ended"
  tabLink,  \* the link the tab opened (0: none)
  tabPw,    \* the password the tab's pass was given under ("none" if none was asked)
  slowedRight,   \* the viewer's right password was answered slow with fewer than 5 wrong tries of its own
  openedWhileSlow \* a right password opened the canvas while the viewer's address was slowed

vars == <<gen, live, pw, wrong, tab, tabLink, tabPw, slowedRight, openedWhileSlow>>
History == <<slowedRight, openedWhileSlow>>

LinkLive(l) == l = gen /\ live /\ l > 0
Slowed(a) == wrong[a] >= MaxWrong
NoWrong == [a \in Addresses |-> 0]

TypeOK ==
  /\ gen \in 0..MaxLinks /\ live \in BOOLEAN /\ pw \in Passwords
  /\ \A a \in Addresses : wrong[a] \in 0..MaxWrong
  /\ tabPw \in Passwords
  /\ tab \in {"none", "password", "wrong", "wait", "open", "ended"}

Init ==
  /\ gen = 0 /\ live = FALSE /\ pw = "none" /\ wrong = NoWrong
  /\ tab = "none" /\ tabLink = 0 /\ tabPw = "none"
  /\ slowedRight = FALSE /\ openedWhileSlow = FALSE

\* canvas.share on a canvas with no live link: a new link (128 random bits).
ShareNew(p) ==
  /\ ~live /\ gen < MaxLinks
  /\ gen' = gen + 1 /\ live' = TRUE /\ pw' = p /\ wrong' = NoWrong
  /\ UNCHANGED <<tab, tabLink, tabPw, History>>

\* canvas.share on a live link: the same link; a new or different password ends every pass,
\* and the viewer's open tab is told at once (it goes back to the password page).
ShareAgain(p) ==
  /\ live /\ p # pw
  /\ pw' = p
  /\ IF p # "none" /\ tab = "open" /\ LinkLive(tabLink)
       THEN tab' = "password" /\ tabPw' = "none"
       ELSE UNCHANGED <<tab, tabPw>>
  /\ UNCHANGED <<gen, live, wrong, tabLink, History>>

\* canvas.unshare: the link ends; the viewer's open tab is told at once.
Unshare ==
  /\ Unsharing /\ live
  /\ live' = FALSE
  /\ tab' = IF tab = "open" /\ tabLink = gen THEN "ended" ELSE tab
  /\ tabPw' = IF tab' = "open" THEN tabPw ELSE "none"
  /\ UNCHANGED <<gen, pw, wrong, tabLink, History>>

\* share.open { link, name? } on the live link: a pass, or `locked` (the password page), also
\* while the address is slowed for wrong tries (the flood limit is left out: see the header).
ViewerOpensTheLink ==
  /\ tab \in {"none", "ended"} /\ live
  /\ tabLink' = gen
  /\ IF pw = "none"
       THEN tab' = "open" /\ tabPw' = "none"
       ELSE tab' = "password" /\ UNCHANGED tabPw
  /\ UNCHANGED <<gen, live, pw, wrong, History>>

\* share.open on the link the viewer had, after it ended: `gone`.
ViewerOpensAnEndedLink ==
  /\ tab = "none" /\ tabLink > 0 /\ ~LinkLive(tabLink)
  /\ tab' = "ended"
  /\ UNCHANGED <<gen, live, pw, wrong, tabLink, tabPw, History>>

OnPasswordPage == tab \in {"password", "wrong", "wait"}

\* share.open { link, password, name? } with the link's current password
ViewerTypesTheRightPassword ==
  /\ OnPasswordPage
  /\ CASE ~LinkLive(tabLink)  -> tab' = "ended" /\ UNCHANGED <<tabPw, slowedRight>>
       [] Slowed("viewer")    -> tab' = "wait" /\ UNCHANGED tabPw
       [] OTHER               -> tab' = "open" /\ tabPw' = pw
  \* the two rules read the viewer's own count, not the lockout the server keeps
  /\ openedWhileSlow' = (openedWhileSlow \/ (tab' = "open" /\ wrong["viewer"] >= MaxWrong))
  /\ slowedRight' = (slowedRight \/ (tab' = "wait" /\ wrong["viewer"] < MaxWrong))
  /\ UNCHANGED <<gen, live, pw, wrong, tabLink>>

\* tries 1-5 that are wrong in a minute answer `wrong`; any try after 5 wrong ones answers `slow`
ViewerTypesAWrongPassword ==
  /\ OnPasswordPage
  /\ CASE ~LinkLive(tabLink) -> tab' = "ended" /\ UNCHANGED wrong
       [] Slowed("viewer")   -> tab' = "wait" /\ UNCHANGED wrong
       [] pw = "none"        -> tab' = "open" /\ UNCHANGED wrong
       [] OTHER              -> /\ wrong' = [wrong EXCEPT !["viewer"] = @ + 1]
                                /\ tab' = "wrong"
  /\ tabPw' = IF tab' = "open" THEN "none" ELSE tabPw
  /\ UNCHANGED <<gen, live, pw, tabLink, History>>

\* someone at another address makes 5 wrong tries in a minute on the same link
\* (one step here: their tries in between change nothing the viewer sees)
OtherAddressGuessesWrong ==
  /\ live /\ pw # "none" /\ ~Slowed("other")
  /\ wrong' = [wrong EXCEPT !["other"] = MaxWrong]
  /\ UNCHANGED <<gen, live, pw, tab, tabLink, tabPw, History>>

AMinutePasses ==
  /\ wrong # NoWrong
  /\ wrong' = NoWrong
  /\ UNCHANGED <<gen, live, pw, tab, tabLink, tabPw, History>>

ViewerClosesTheTab ==
  /\ tab # "none"
  /\ tab' = "none" /\ tabPw' = "none"
  /\ UNCHANGED <<gen, live, pw, wrong, tabLink, History>>

\* The model makes at most MaxLinks links; this end state is the bound, not the product.
TheModelStops ==
  /\ gen = MaxLinks /\ ~live /\ tab = "none"
  /\ UNCHANGED vars

Next ==
  \/ \E p \in Passwords : ShareNew(p) \/ ShareAgain(p)
  \/ Unshare \/ ViewerOpensTheLink \/ ViewerOpensAnEndedLink
  \/ ViewerTypesTheRightPassword \/ ViewerTypesAWrongPassword
  \/ OtherAddressGuessesWrong \/ AMinutePasses \/ ViewerClosesTheTab
  \/ TheModelStops

Spec == Init /\ [][Next]_vars

\* ---- Rules, in the reader's words ----

\* SPEC-frames.md § Journeys, Share a canvas, step 4, and judged rule 13 (S3): a tab shows the
\* canvas only while its link is live; unshare closes it at once.
ATabShowsTheCanvasOnlyWhileItsLinkIsLive == tab = "open" => LinkLive(tabLink)

\* SPEC-frames.md § Journeys, Share a canvas, step 3, and judged rule 12 (S2): a tab shows the
\* canvas only under the link's current password, so a new password ends every pass given under the
\* old one (or under none).
ATabShowsTheCanvasOnlyUnderTheCurrentPassword == tab = "open" => (pw = "none" \/ tabPw = pw)

\* SPEC-frames.md § Journeys, Share a canvas, step 3, and judged rule 12 (S2): sharing a shared
\* canvas keeps its link.
SharingAgainKeepsTheLink == [][(live /\ live') => gen' = gen]_vars

\* SPEC-frames.md § Journeys, Share a canvas, step 5, and judged rule 12: an ended link stays ended;
\* sharing again makes a new link.
AnEndedLinkStaysEnded ==
  [][\A l \in 1..gen : ~LinkLive(l) => ~(l = gen' /\ live')]_vars

\* SPEC-frames.md § Journeys, Open a share link, step 2, and judged rule 14: after 5 wrong tries in
\* a minute, every try answers slow, even the right one.
SlowEvenWithTheRightPassword == ~openedWhileSlow
NoMoreThan5WrongTriesAMinute == \A a \in Addresses : wrong[a] <= MaxWrong

\* SPEC-frames.md § Journeys, Open a share link, step 2, and judged rule 14 (S5, D7): wrong tries
\* from another address never lock the viewer out.
AnotherAddressCannotLockTheViewerOut == ~slowedRight
====
