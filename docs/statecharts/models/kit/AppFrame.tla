---- MODULE AppFrame ----
\* SPEC-kit.md § App frames: the life of one app frame in one tab, from its iframe to its removal.
\* An app frame is a TSX module (React and Tinker) in its own sandboxed iframe. Its app starts its
\* own Tinker scope and mounts its View. Then the frame says hello to its parent at once, and again
\* each 50 ms until it gets a port (as the piece script of an HTML frame does). The page answers a
\* hello with a port and the current kit; each later kit (a new look, K7) goes on that port.
\*
\* When the page removes the iframe (out of view at rest, the frame deleted, a new version), the
\* frame's scope must close first: when an iframe is removed, the async `scope.close()` in it does
\* not end, so its deferred ends do not run. With Close = "post" (chart kit-app-frame), the page
\* posts `close` to the frame, waits for `closed` (at most 200 ms), then removes the iframe. The
\* page itself ends its work that crosses the port (the kit messages, a subscription) when it
\* removes the iframe. A frame that is busy (a long loop) cannot answer: after 200 ms the page
\* removes it all the same.
\* Close = "none" (chart kit-app-frame-no-close) is the design this rules out: the page removes the
\* iframe at once, so the frame's deferred ends never run. It breaks TheEndsRunBeforeTheIframeGoes.
EXTENDS Naturals

CONSTANTS Close, MaxKit

VARIABLES
  kit,       \* the current kit version
  listens,   \* the page listens for the hellos of its iframes
  frame,     \* the iframe, as the page sees it: "none", "live", "closing" or "removed"
  app,       \* the app in the iframe: "none", "mounted", or "closed" (its scope closed, its ends ran)
  busy,      \* a long loop in the app: "never", "now" (it cannot answer), or "done"
  port,      \* the app holds a port from the page
  docKit,    \* the kit version that the app shows (0: none)
  pageWork   \* the page has work on the port: it sends the kit there

vars == <<kit, listens, frame, app, busy, port, docKit, pageWork>>

Init ==
  /\ kit = 1 /\ listens = FALSE
  /\ frame = "none" /\ app = "none" /\ busy = "never"
  /\ port = FALSE /\ docKit = 0 /\ pageWork = FALSE

\* The page starts to listen for hellos. An iframe can start before it.
PageListens ==
  /\ ~listens
  /\ listens' = TRUE
  /\ UNCHANGED <<kit, frame, app, busy, port, docKit, pageWork>>

\* The answer to a hello: only when the page listens, a port and the current kit, at once.
Answer ==
  /\ port' = listens
  /\ pageWork' = listens
  /\ docKit' = IF listens THEN kit ELSE docKit

\* The frame goes live: the page makes the iframe, composed with the current kit. The app starts
\* its scope, mounts its View, and says hello at once.
GoLive ==
  /\ frame = "none"
  /\ frame' = "live" /\ app' = "mounted"
  /\ port' = listens /\ pageWork' = listens /\ docKit' = kit
  /\ UNCHANGED <<kit, listens, busy>>

\* The app says hello again, 50 ms later, while it has no port. A busy app says nothing.
HelloAgain ==
  /\ frame = "live" /\ app = "mounted" /\ busy # "now" /\ ~port /\ listens
  /\ Answer
  /\ UNCHANGED <<kit, listens, frame, app, busy>>

\* A user changes the look: a new kit version. The page sends it on the port, with no reload.
NewLook ==
  /\ kit < MaxKit
  /\ kit' = kit + 1
  /\ docKit' = IF port /\ frame \in {"live", "closing"} THEN kit + 1 ELSE docKit
  /\ UNCHANGED <<listens, frame, app, busy, port, pageWork>>

\* The app runs a long loop (once in the model); later it ends.
Loop ==
  /\ app = "mounted" /\ frame \in {"live", "closing"} /\ busy = "never"
  /\ busy' = "now"
  /\ UNCHANGED <<kit, listens, frame, app, port, docKit, pageWork>>

LoopEnds ==
  /\ busy = "now" /\ frame # "removed"
  /\ busy' = "done"
  /\ UNCHANGED <<kit, listens, frame, app, port, docKit, pageWork>>

\* The page removes the frame: it goes out of view at rest, an agent deletes it, or a new version
\* replaces it. With Close = "post", the page posts `close` (on the port; with no port yet, to the
\* frame's window) and starts the 200 ms wait. With Close = "none", it removes the iframe at once,
\* and closes its side of the port.
Leave ==
  /\ frame = "live"
  /\ IF Close = "post"
       THEN /\ frame' = "closing"
            /\ UNCHANGED <<pageWork>>
       ELSE /\ frame' = "removed"
            /\ pageWork' = FALSE
  /\ UNCHANGED <<kit, listens, app, busy, port, docKit>>

\* The app gets `close`: `scope.close()` runs each deferred end, then the app posts `closed`.
AppCloses ==
  /\ frame = "closing" /\ app = "mounted" /\ busy # "now"
  /\ app' = "closed"
  /\ UNCHANGED <<kit, listens, frame, busy, port, docKit, pageWork>>

\* The page gets `closed`: it removes the iframe, and ends its own work on the port.
Remove ==
  /\ frame = "closing" /\ app = "closed"
  /\ frame' = "removed" /\ pageWork' = FALSE
  /\ UNCHANGED <<kit, listens, app, busy, port, docKit>>

\* No `closed` in 200 ms: the app is busy. The page removes the iframe all the same.
WaitEnds ==
  /\ frame = "closing" /\ app = "mounted" /\ busy = "now"
  /\ frame' = "removed" /\ pageWork' = FALSE
  /\ UNCHANGED <<kit, listens, app, busy, port, docKit>>

Done ==
  /\ frame = "removed" /\ kit = MaxKit
  /\ UNCHANGED vars

Next ==
  \/ PageListens \/ GoLive \/ HelloAgain \/ NewLook \/ Loop \/ LoopEnds
  \/ Leave \/ AppCloses \/ Remove \/ WaitEnds \/ Done

\* The page listens in the end, a frame with no port says hello again, a loop ends, an app that
\* got `close` closes, and the page removes a closed app or a busy one after the wait.
Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(PageListens) /\ WF_vars(HelloAgain) /\ WF_vars(LoopEnds)
  /\ WF_vars(AppCloses) /\ WF_vars(Remove) /\ WF_vars(WaitEnds)

\* ---------- rules, in the reader's words ----------

\* Decision 9: the iframe goes only after the app's scope closed and its deferred ends ran; or,
\* when the app is busy, after the 200 ms wait.
TheEndsRunBeforeTheIframeGoes == frame = "removed" => (app = "closed" \/ busy = "now")

\* Decision 9: when the iframe goes, the page has no work left on its port.
NoWorkIsLeftOnThePort == frame = "removed" => ~pageWork

\* An app closes only when the page asks it to.
AnAppClosesOnlyWhenAsked == [][app' = "closed" /\ app # "closed" => frame = "closing"]_vars

\* The page never waits for `closed` forever: a close ends with the iframe removed.
ACloseEnds == (frame = "closing") ~> (frame = "removed")

\* K7: an app shows only a stored kit version, and a live one comes to show the newest one, with
\* no reload, also when it started before the page listened.
AnAppShowsOnlyAStoredKitVersion == docKit <= kit
ALiveAppShowsTheNewLook == <>[](frame = "live" => docKit = kit)

TypeOK ==
  /\ kit \in 1..MaxKit /\ listens \in BOOLEAN
  /\ frame \in {"none", "live", "closing", "removed"}
  /\ app \in {"none", "mounted", "closed"}
  /\ busy \in {"never", "now", "done"}
  /\ port \in BOOLEAN /\ docKit \in 0..MaxKit /\ pageWork \in BOOLEAN
====
