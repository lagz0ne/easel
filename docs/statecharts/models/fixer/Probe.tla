---- MODULE Probe ----
\* The watcher of the watcher (SPEC-fixer.md, "Someone watches the watcher"; SPEC-ops.md,
\* "An agent checks the server"). A GitHub Actions probe every 10 minutes reads /api/ready,
\* which carries fixerSilent: no fixer tick has stamped fixerSeen for 30 minutes. Every
\* 5-minute tick stamps it, work or not.
\* StampsEveryTick = FALSE is the design this rules out: a tick stamps only when it finds work,
\* so a quiet day with no errors goes 30 minutes unstamped and opens prod-down while the
\* schedule runs (ProdDownMeansSomethingIsWrong breaks). Probe.cfg has StampsEveryTick = TRUE.
EXTENDS Naturals

CONSTANT StampsEveryTick

VARIABLES
  ready,      \* /api/ready answers 200 (every readiness check passes)
  work,       \* open server error groups exist
  tickOk,     \* the paseo schedule runs its 5-minute tick
  quiet,      \* fixerSilent: no tick has stamped fixerSeen for 30 minutes
  issue,      \* the prod-down issue: "closed" or "open"
  sawReady,   \* what the last probe read: the server was ready
  sawSilent,  \* what the last probe read: fixerSilent
  sawStopped  \* the last probe ran while the tick had stopped (what is true, not what it read)

vars == <<ready, work, tickOk, quiet, issue, sawReady, sawSilent, sawStopped>>

Init ==
  /\ ready = TRUE /\ work = FALSE /\ tickOk = TRUE /\ quiet = FALSE
  /\ issue = "closed" /\ sawReady = TRUE /\ sawSilent = FALSE /\ sawStopped = FALSE

Breaks  == ready /\ ready' = FALSE
           /\ UNCHANGED <<work, tickOk, quiet, issue, sawReady, sawSilent, sawStopped>>
Heals   == ~ready /\ ready' = TRUE
           /\ UNCHANGED <<work, tickOk, quiet, issue, sawReady, sawSilent, sawStopped>>
ErrorsArrive == ~work /\ work' = TRUE
           /\ UNCHANGED <<ready, tickOk, quiet, issue, sawReady, sawSilent, sawStopped>>
\* A fixer, started by the tick, resolves or hands off the last open group.
WorkDone == work /\ tickOk /\ work' = FALSE
           /\ UNCHANGED <<ready, tickOk, quiet, issue, sawReady, sawSilent, sawStopped>>
\* Without StampsEveryTick: a tick that finds work stamps fixerSeen.
TickFindsWork == ~StampsEveryTick /\ quiet /\ tickOk /\ work /\ quiet' = FALSE
           /\ UNCHANGED <<ready, work, tickOk, issue, sawReady, sawSilent, sawStopped>>
TickStops == tickOk /\ tickOk' = FALSE
           /\ UNCHANGED <<ready, work, quiet, issue, sawReady, sawSilent, sawStopped>>
\* The schedule comes back; its first tick stamps at once.
TickResumes == ~tickOk /\ tickOk' = TRUE /\ quiet' = FALSE
           /\ UNCHANGED <<ready, work, issue, sawReady, sawSilent, sawStopped>>

\* 30 minutes pass with no tick stamping fixerSeen. Every tick stamps, so this needs a stop;
\* without StampsEveryTick, a day with no work is enough.
ThirtyMinutesPass ==
  /\ ~quiet /\ (~tickOk \/ (~StampsEveryTick /\ ~work))
  /\ quiet' = TRUE
  /\ UNCHANGED <<ready, work, tickOk, issue, sawReady, sawSilent, sawStopped>>

\* The probe fails when not ready or fixerSilent; it opens prod-down on a failure, closes it on
\* a pass.
ProbeRuns ==
  /\ sawReady' = ready
  /\ sawSilent' = quiet
  /\ sawStopped' = ~tickOk
  /\ issue' = IF ready /\ ~quiet THEN "closed" ELSE "open"
  /\ (sawReady' # sawReady \/ sawSilent' # sawSilent \/ sawStopped' # sawStopped \/ issue' # issue)
  /\ UNCHANGED <<ready, work, tickOk, quiet>>

Next == Breaks \/ Heals \/ ErrorsArrive \/ WorkDone \/ TickStops \/ TickResumes
     \/ ThirtyMinutesPass \/ ProbeRuns \/ TickFindsWork

\* "prod-down opens only when the server is not ready or the fixer's schedule has stopped."
ProdDownMeansSomethingIsWrong == issue = "open" => ~sawReady \/ sawStopped
\* "When the probe finds the server not ready, prod-down is open."
NotReadyOpensProdDown == ~sawReady => issue = "open"
\* "When the probe finds the fixer silent for 30 minutes, prod-down is open."
SilentFixerOpensProdDown == sawSilent => issue = "open"
====
