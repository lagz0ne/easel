---- MODULE WalkBackend ----
\* SPEC-prototype.md ship 5 (rule 10, decisions 33 to 40, E12 J10): the backend switch of the
\* walk. One switch of the board, "examples" or "live". With "examples", a call of the screen waits
\* until the person picks its answer in the bar. With "live", a call goes to the live server: one
\* server of the build on a new database. The server is not set up at first; then it starts, is
\* ready, fails, or goes (a new deploy, a stop). A new deploy starts it again on a new database.
\*
\* The screen runs in one scope, and the scope has one backend: the backend of the switch when the
\* scope started. A press makes a call on the backend of the scope. A pick of the switch in a walk
\* closes the scope, which ends the call that waits, and starts the walk again at its first state
\* in a new scope with the new backend: a value of a step on one backend is not a value of the
\* other (the code KDWB-RTQM of the examples is on no live server). With "live" and a server that
\* is not ready, the walk is held: no screen runs, and the bar says why. When the server is ready,
\* the walk starts at its first state. When the server goes, a live walk is held again.
\*
\* KeepScope is the bug of the twin: with TRUE (chart viewer-walk-backend-keep-scope), a pick of
\* the switch changes only the value of the switch, and the scope keeps its backend.
EXTENDS Naturals

CONSTANT KeepScope

Backends == {"examples", "live"}

VARIABLES
  backend,  \* the value of the switch of the board
  server,   \* the live server: "none" (not set up), "starting", "ready", "failed", "gone"
  walk,     \* "off", "first" (the first state shows), "later" (a later state shows), "held"
  scope,    \* the backend of the scope of the screen, or "none" when no screen runs
  call      \* the backend where a call of the screen waits, or "none"

vars == <<backend, server, walk, scope, call>>

Runs == walk \in {"first", "later"}

Init ==
  /\ backend = "examples" /\ server = "none"
  /\ walk = "off" /\ scope = "none" /\ call = "none"

\* The screen starts at the first state on the backend b, or is held when b has no ready server.
StartOn(b, s) ==
  IF b = "live" /\ s # "ready"
    THEN walk' = "held" /\ scope' = "none" /\ call' = "none"
    ELSE walk' = "first" /\ scope' = b /\ call' = "none"

StartWalk ==
  /\ walk = "off"
  /\ StartOn(backend, server)
  /\ UNCHANGED <<backend, server>>

Pick(b) ==
  /\ b # backend
  /\ backend' = b
  /\ IF walk = "off" \/ (KeepScope /\ walk # "held")
       THEN UNCHANGED <<walk, scope, call>>
       ELSE StartOn(b, server)
  /\ UNCHANGED server

\* A press on the screen calls the server, on the backend of the scope.
Press ==
  /\ Runs /\ call = "none"
  /\ call' = scope
  /\ UNCHANGED <<backend, server, walk, scope>>

\* The person picks the answer of a call that waits on the examples.
PickAnswer ==
  /\ Runs /\ call = "examples"
  /\ call' = "none" /\ walk' = "later"
  /\ UNCHANGED <<backend, server, scope>>

\* The live server answers a call.
ServerAnswers ==
  /\ Runs /\ call = "live" /\ server = "ready"
  /\ call' = "none" /\ walk' = "later"
  /\ UNCHANGED <<backend, server, scope>>

\* Back or Restart: the value of that step in a new scope on the same backend.
StepBack ==
  /\ walk = "later"
  /\ walk' = "first" /\ call' = "none"
  /\ UNCHANGED <<backend, server, scope>>

Leave ==
  /\ walk # "off"
  /\ walk' = "off" /\ scope' = "none" /\ call' = "none"
  /\ UNCHANGED <<backend, server>>

\* The hub sets up the live server, and a deploy starts it.
Deploy ==
  /\ server \in {"none", "failed", "gone"}
  /\ server' = "starting"
  /\ UNCHANGED <<backend, walk, scope, call>>

ServerReady ==
  /\ server = "starting"
  /\ server' = "ready"
  /\ IF walk = "held" /\ backend = "live"
       THEN walk' = "first" /\ scope' = "live" /\ call' = "none"
       ELSE UNCHANGED <<walk, scope, call>>
  /\ UNCHANGED backend

ServerFails ==
  /\ server = "starting"
  /\ server' = "failed"
  /\ UNCHANGED <<backend, walk, scope, call>>

\* The server goes: a new deploy takes it, or it stops. A screen on it is held; its call ends.
ServerGoes ==
  /\ server = "ready"
  /\ server' = "gone"
  /\ IF scope = "live"
       THEN walk' = "held" /\ scope' = "none" /\ call' = "none"
       ELSE UNCHANGED <<walk, scope, call>>
  /\ UNCHANGED backend

Next ==
  \/ StartWalk
  \/ \E b \in Backends : Pick(b)
  \/ Press \/ PickAnswer \/ ServerAnswers \/ StepBack \/ Leave
  \/ Deploy \/ ServerReady \/ ServerFails \/ ServerGoes

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ backend \in Backends
  /\ server \in {"none", "starting", "ready", "failed", "gone"}
  /\ walk \in {"off", "first", "later", "held"}
  /\ scope \in Backends \cup {"none"}
  /\ call \in Backends \cup {"none"}
  /\ (scope = "none") <=> ~Runs
  /\ call # "none" => Runs

\* "A call of the walk waits only on the backend that the switch shows."
EachCallWaitsOnTheSwitch == call # "none" => call = backend

\* "A screen runs on the live server only while the server is ready."
LiveRunsOnAReadyServer == scope = "live" => server = "ready"

\* "The walk is held only when the switch is live and the server is not ready; the bar says why."
HeldOnlyForTheServer == walk = "held" => (backend = "live" /\ server # "ready")

\* "A pick of the switch in a walk starts the walk again at its first state."
APickStartsAgain ==
  [][(Runs /\ backend' # backend) => walk' \in {"first", "held"}]_vars

\* "When the live server is ready, a held walk starts at its first state."
ReadyStartsTheWalk ==
  [][(walk = "held" /\ server' = "ready" /\ backend' = "live") => walk' = "first"]_vars
====
