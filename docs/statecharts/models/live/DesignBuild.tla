---- MODULE DesignBuild ----
\* SPEC-live-screens.md decisions 9 and 10 (E11 V4, V7): an accept of a design starts the change
\* of the app, and the reply names a live build.
\*
\* A design agent resolved a request on `product` with a new version of its frame. A viewer
\* accepts the result. easel adds one build request on the frame. A design agent claims it,
\* changes the code, and ships it: the push makes a build that goes live with a deploy. The agent
\* resolves the build request with that build. It can also release it (it waits again) or decline
\* it (it needs a person). An accept of the build request adds no other request.
\*
\* CheckLive = TRUE is the rule of decision 10: easel refuses a resolve that names a build over
\* its own build. With CheckLive = FALSE, the second config shows what breaks.
EXTENDS Naturals

CONSTANT CheckLive

VARIABLES
  design,   \* the design request: "result" or "accepted"
  build,    \* the build request: "none", "waiting", "inWork", "resolved", "person", "accepted"
  added,    \* how many build requests easel added
  live,     \* the build that the site serves
  shipped,  \* the build that has the change of the agent, 0 before the push
  named     \* the build that the resolve names, 0 before the resolve

vars == <<design, build, added, live, shipped, named>>

TypeOK ==
  /\ design \in {"result", "accepted"}
  /\ build \in {"none", "waiting", "inWork", "resolved", "person", "accepted"}
  /\ added \in 0..2 /\ live \in 1..3 /\ shipped \in 0..3 /\ named \in 0..3

Init ==
  /\ design = "result" /\ build = "none" /\ added = 0
  /\ live = 1 /\ shipped = 0 /\ named = 0

AcceptDesign ==
  /\ design = "result"
  /\ design' = "accepted" /\ build' = "waiting" /\ added' = added + 1
  /\ UNCHANGED <<live, shipped, named>>

Claim ==
  /\ build = "waiting"
  /\ build' = "inWork"
  /\ UNCHANGED <<design, added, live, shipped, named>>

Ship ==
  /\ build = "inWork" /\ shipped = 0
  /\ shipped' = live + 1
  /\ UNCHANGED <<design, build, added, live, named>>

Deploy ==
  /\ shipped > live
  /\ live' = shipped
  /\ UNCHANGED <<design, build, added, shipped, named>>

Resolve ==
  /\ build = "inWork" /\ shipped # 0
  /\ CheckLive => shipped <= live
  /\ build' = "resolved" /\ named' = shipped
  /\ UNCHANGED <<design, added, live, shipped>>

Release ==
  /\ build = "inWork"
  /\ build' = "waiting"
  /\ UNCHANGED <<design, added, live, shipped, named>>

Decline ==
  /\ build = "inWork"
  /\ build' = "person"
  /\ UNCHANGED <<design, added, live, shipped, named>>

Edit ==
  /\ build = "person"
  /\ build' = "waiting"
  /\ UNCHANGED <<design, added, live, shipped, named>>

Rest ==
  /\ build = "accepted"
  /\ UNCHANGED vars

AcceptBuild ==
  /\ build = "resolved"
  /\ build' = "accepted"
  /\ UNCHANGED <<design, added, live, shipped, named>>

Next ==
  \/ AcceptDesign \/ Claim \/ Ship \/ Deploy \/ Resolve \/ Release \/ Decline \/ Edit
  \/ AcceptBuild \/ Rest

Spec == Init /\ [][Next]_vars

OneBuildRequestForEachAccept == added <= 1

ABuildRequestNeedsAnAccept == build # "none" => design = "accepted"

TheReplyNamesALiveBuild == build \in {"resolved", "accepted"} => (named # 0 /\ named <= live)

TheDesignStaysAccepted == [][design = "accepted" => design' = "accepted"]_vars
====
