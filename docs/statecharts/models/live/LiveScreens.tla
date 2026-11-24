---- MODULE LiveScreens ----
\* SPEC-live-screens.md decision 6: one take of one live screen (a screen in one take: a size
\* and a theme) on the page Live of `product`. After each deploy, the job takes the screen of the
\* live build and finds the After of that take by its name.
\*
\* Builds are 1, 2 and 3. `after` and `before` name the build of each image frame (0: none yet).
\* A take of a build that the After already has gives the same pixels, or other pixels (a take
\* that is not stable). A take can fail.
\*
\* PutEachTake = FALSE is the job of the spec. With PutEachTake = TRUE, the job puts each take
\* again, also a take of the build that the After already has, and the second config shows what
\* breaks.
EXTENDS Naturals

CONSTANT PutEachTake

VARIABLES
  live,    \* the build that /api/version names
  after,   \* the build of the After, 0 before the first take
  before,  \* the build of the Before, 0 before the second build
  status   \* the word of the take in the status frame

vars == <<live, after, before, status>>

Statuses == {"none", "new", "next", "same", "differs", "failed"}

TypeOK ==
  /\ live \in 1..3 /\ after \in 0..3 /\ before \in 0..3
  /\ status \in Statuses

Init == live = 1 /\ after = 0 /\ before = 0 /\ status = "none"

Deploy ==
  /\ live < 3
  /\ live' = live + 1
  /\ UNCHANGED <<after, before, status>>

Put ==
  /\ before' = IF after = 0 THEN before ELSE after
  /\ after' = live

TakeNew ==
  /\ after = 0
  /\ Put
  /\ status' = "new"
  /\ UNCHANGED live

TakeNext ==
  /\ after # 0 /\ after < live
  /\ Put
  /\ status' = "next"
  /\ UNCHANGED live

TakeSame ==
  /\ after = live
  /\ IF PutEachTake THEN Put ELSE UNCHANGED <<after, before>>
  /\ status' = "same"
  /\ UNCHANGED live

TakeDiffers ==
  /\ after = live
  /\ IF PutEachTake THEN Put ELSE UNCHANGED <<after, before>>
  /\ status' = "differs"
  /\ UNCHANGED live

TakeFails ==
  /\ status' = "failed"
  /\ UNCHANGED <<live, after, before>>

Next == Deploy \/ TakeNew \/ TakeNext \/ TakeSame \/ TakeDiffers \/ TakeFails

Spec == Init /\ [][Next]_vars

AfterIsNotNewerThanLive == after <= live

BeforeIsTheBuildBeforeAfter == before # 0 => before < after

ABeforeNeedsAnAfter == before # 0 => after # 0

ATakeOfTheSameBuildPutsNothing ==
  [][(live' = live /\ after = live) => UNCHANGED <<after, before>>]_vars

AFailedTakeKeepsTheLastGood == [][status' = "failed" => UNCHANGED <<after, before>>]_vars
====
