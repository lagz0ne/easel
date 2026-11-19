# Epics

This file is the story map of easel. It lists the epics in the order that a user meets them. Each
epic links to its journeys in the module specs. The journeys stay in the specs, so each journey has
one source. The words come from [glossary.md](glossary.md). The actors are in
[actors.md](actors.md).

## Method

An epic file holds requirements. A module spec holds the design that meets them. Keep the two
apart.

- A requirement says what an actor needs, and why. It does not say how easel does it
  (ISO/IEC/IEEE 29148: necessary and free of implementation).
- Each requirement has a fit criterion: a check that a person can see, with no mechanism in it
  (Volere).
- Write examples in the words of the actor, not in UI steps or internals (Cucumber, declarative
  style).

| Step              | Source                                    | Action                                                                               |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| 1. Write          | Patton, story mapping (2008)              | Give the epic one outcome sentence and its actors. List its journeys.                |
| 2. Check form     | Cockburn, use cases (2000); INVEST (2003) | Each journey has one actor, one need, a trigger, a success end and its failure ends. |
| 3. Map needs      | Wynne, Example Mapping (2015)             | For each journey, list the requirements, their fit criteria, and the open questions. |
| 4. Walk the slice | Patton                                    | Read the epic from left to right as one actor. Find the missing step.                |
| 5. Check design   | ISO/IEC/IEEE 29148, traceability          | Compare the module spec with the requirements. List each gap as a design change.     |
| 6. Prove          | SPEC.md, Success Criteria 1 and 8         | Each fit criterion becomes a test. Each rule with state becomes a statechart rule.   |

A journey is ready when it has no open question. A journey with many requirements is too large:
split it. Write in ASD-STE100, with the terms of the glossary only.

## Story map

The main story is E1, E2, E3, then E4. E5 gives the same actions through MCP. E6 and E7 keep the
server healthy.

| ID  | Epic                      | Outcome                                                        | Actors             | Journeys                                                                                                                              | Status                     | Review |
| --- | ------------------------- | -------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------ |
| E1  | Get in                    | A person or an agent gets a token when an owner approves it.   | owner, agent       | [access](../SPEC-access.md#journeys), [cli](../SPEC-cli.md#journeys)                                                                  | Built                      | to do  |
| E2  | Make frames               | An agent puts HTML frames on a canvas and changes them safely. | agent              | [frames](../SPEC-frames.md#make-a-canvas): make a canvas, make and change frames                                                      | Built, except `frame.move` | to do  |
| E3  | Share and look            | A person opens a link and sees the frames change at once.      | agent, viewer      | [frames](../SPEC-frames.md#share-a-canvas): share, open; [viewer](../SPEC-viewer.md#journeys) 7; [design](../SPEC-design.md#journeys) | Built                      | to do  |
| E4  | Comment and get a change  | A viewer asks for a change. An agent makes it and replies.     | viewer, agent      | [queue](../SPEC-queue.md#journeys) 3; [viewer](../SPEC-viewer.md#pin-a-comment): pin a comment, follow the queue                      | Not built                  | active |
| E5  | Work through MCP          | An agent with no shell does all of E2, E3 and E4.              | agent              | [mcp](../SPEC-mcp.md#journeys) 3                                                                                                      | Not built                  | active |
| E6  | Watch production          | An owner and an agent see errors, health and backups.          | owner, server      | [ops](../SPEC-ops.md#journeys) 5                                                                                                      | Built, except backups      | to do  |
| E7  | Fix errors with no person | An agent fixes a production error and proves the fix.          | fixer, tick, probe | [fixer](../SPEC-fixer.md#journeys) 5                                                                                                  | Not built                  | to do  |

## E4: Comment and get a change

| ID   | Journey                     | Actor  | Design                                                                                       | Review |
| ---- | --------------------------- | ------ | -------------------------------------------------------------------------------------------- | ------ |
| E4.1 | Ask for a change            | viewer | [queue](../SPEC-queue.md#a-viewer-adds-a-comment), [viewer](../SPEC-viewer.md#pin-a-comment) | ready  |
| E4.2 | Do the change and reply     | agent  | [queue](../SPEC-queue.md#an-agent-works-the-queue)                                           | ready  |
| E4.3 | A request no agent finishes | agent  | [queue](../SPEC-queue.md#a-comment-no-agent-finishes)                                        | ready  |
| E4.4 | Follow the requests         | viewer | [viewer](../SPEC-viewer.md#follow-the-queue)                                                 | ready  |

### E4.1 Ask for a change

- **Actor:** viewer.
- **Need:** ask for a change to one part of a design, and know that easel received the request.
- **Trigger:** the viewer sees something to change.
- **Success end:** all people on the canvas see the request, and an agent can take it.
- **Failure end:** easel does not accept the request. The viewer keeps the text and knows why.

| ID  | Requirement                                                                                                                                                  | Fit criterion                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | The viewer can point at the exact part of a frame that the request is about.                                                                                 | Another person who reads the request finds that part without help.                                                                       |
| N2  | The viewer can ask about the canvas as a whole, not about one frame.                                                                                         | A request such as "add a frame for the checkout page" has no frame, and an agent can still act on it.                                    |
| N3  | The viewer knows if easel received the request.                                                                                                              | Easel never loses a request silently, and never saves one request two times.                                                             |
| N4  | Each request has a short reference that people can use when they talk about it.                                                                              | Two requests on one canvas never have the same reference.                                                                                |
| N5  | All people who look at the canvas see the new request.                                                                                                       | They see it within 1 second, with no reload.                                                                                             |
| N6  | The request shows who asked.                                                                                                                                 | The request shows the name that the viewer gave.                                                                                         |
| N7  | The request stays on the part that it is about.                                                                                                              | When an agent moves the frame, the request moves with it.                                                                                |
| N8  | The request keeps what the viewer saw. A frame can change, become old, or be removed.                                                                        | A person can see what the viewer saw, and can see that the frame changed or was removed since.                                           |
| N9  | The viewer can correct a request, for example one sent too soon by mistake. The viewer can take back a request at any time, also while an agent works on it. | A request sent by mistake can be corrected before an agent starts work on it. A request that the viewer takes back never shows a result. |
| N10 | If easel does not accept what a viewer typed, the viewer keeps the text and knows why. This applies to a request, a correction, an answer and a note.        | The text is never lost when the frame is removed, the link stops, the canvas has too many requests, or another viewer acted first.       |
| N11 | One viewer cannot flood a canvas with requests.                                                                                                              | A flood from one viewer does not stop other viewers.                                                                                     |

#### Design changes that E4.1 needs

All rows below are closed in the specs (`224aa9e`, `c02b9e3`, `08a5056`).

The current specs do not meet these requirements. Change the specs before the queue is built.

| Req. | Gap in the design now                                                                                                | Spec                    |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| N2   | A comment must have a frame, and the claim allows a change to that frame only (queue rule 14).                       | SPEC-queue, SPEC-mcp    |
| N8   | A comment does not keep the frame version. A frame delete also deletes its comments (`easel rm`, `easel canvas rm`). | SPEC-queue, SPEC-frames |
| N9   | No call corrects or removes a comment.                                                                               | SPEC-queue, SPEC-viewer |

### E4.2 Do the change and reply

- **Actor:** agent. The viewer takes part when the agent asks a question or shows the result.
- **Need:** take a request, make the change without a conflict, and prove to the viewer that the
  change is done in the right way.
- **Trigger:** the agent is ready for work.
- **Success end:** the viewer accepts the result.
- **Failure end:** the agent cannot do the request. Another agent or a person can take it.

| ID  | Requirement                                                                                                                            | Fit criterion                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| M1  | No request waits for ever while newer requests get done.                                                                               | Agents take requests in the order they came.                                                                            |
| M2  | Two agents never work on the same request at the same time.                                                                            | No request gets two changes from two agents.                                                                            |
| M3  | The agent has all the facts it needs without a browser: the text, the place, what the viewer saw, and the current frame.               | An agent does the change with the CLI or MCP only.                                                                      |
| M4  | A request comes back to the queue if its agent stops.                                                                                  | No person must free a request after an agent crashes.                                                                   |
| M5  | An agent that needs more time keeps the request.                                                                                       | A second agent does not take a request while the first agent still works on it.                                         |
| M6  | An agent that cannot do the request gives it back.                                                                                     | Another agent can take it at once.                                                                                      |
| M7  | A waiting agent gets a new request quickly, without a busy loop.                                                                       | A new request reaches a waiting agent within 1 second.                                                                  |
| M8  | A request allows a change only to what it is about: its frame, or its canvas for a request about the whole canvas (N2).                | The text of a request cannot make an agent change another canvas or another user.                                       |
| M9  | The agent can ask the viewer a question before it makes the change.                                                                    | The viewer sees the question on the request and answers it. No agent works on it until the answer.                      |
| M10 | A question or a result can use the form that shows it best: text, HTML, a diagram, or a comparison of options or of before and after.  | The viewer can see two options side by side and pick one.                                                               |
| M11 | When the agent says that the change is done, it gives the proof: what changed, before and after, and how the change meets the request. | The viewer can decide from the proof alone, with no other tool.                                                         |
| M12 | The viewer accepts the result, or opens the request again with a note.                                                                 | A request that the viewer opens again goes back to the queue with all its history.                                      |
| M13 | The viewer sees each question and each result.                                                                                         | Within 1 second, with no reload.                                                                                        |
| M14 | A request with a question waits for a viewer. It is not in the agent queue, and it never becomes stuck.                                | A question with no answer does not block other requests.                                                                |
| M15 | A result with no answer from a viewer counts as done. A viewer can open it again later.                                                | No request stays open only because no viewer answered.                                                                  |
| M16 | Any viewer of the link can answer a question, accept a result, or open a request again. The request shows who did it.                  | A team decides together, and each step shows a name.                                                                    |
| M17 | The questions, the options, the proof and the decision stay with the request after it is done.                                         | A person can find later why a part of the design is as it is.                                                           |
| M18 | A request that waits for a long time shows that it may be outdated.                                                                    | A person can tell an old request from a new one at a glance.                                                            |
| M19 | An answer from a viewer does not put the request behind requests that came later.                                                      | An agent takes a request that was asked and then answered before a request that was asked after it.                     |
| M20 | A viewer who acts on a request knows when another viewer acted on it first.                                                            | When two viewers act on one request at the same time, each viewer sees the outcome, and the text of each is kept (N10). |

Decided:

- Requests have no priority. Oldest first (M1) is the only order.
- Loose ends are better than stuck work. When a person does not answer, the work goes on, and a
  person can open it again later (M14, M15, M18).
- The name on a step is the name that the viewer gave. Easel does not prove it. The need of M16 is
  to work as a team, not proof. Proof of who acted is an E1 need, if it becomes necessary.

#### Design changes that E4.2 needs

All rows below are closed in the specs (`224aa9e`, `c02b9e3`, `08a5056`).

| Req.     | Gap in the design now                                                                                           | Spec                          |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| M9, M12  | A comment has one reply. Threads are out of scope.                                                              | SPEC-queue                    |
| M10, M11 | A reply is plain text of 1 to 2000 characters.                                                                  | SPEC-queue, SPEC-mcp          |
| M9, M12  | A comment has two stored states, `open` and `done`. There is no state that waits for the viewer, and no accept. | SPEC-queue, queue-lease chart |
| M11, N8  | easel keeps no old version of a frame ("Frame history" is out of scope), so "before" cannot be shown.           | SPEC.md, SPEC-frames          |
| M1       | "Priorities" is in the deferred list. Remove it: the need is not there.                                         | SPEC-queue                    |

### E4.3 A request no agent finishes

- **Actor:** agent. A person decides at the end.
- **Need:** a request that agents cannot finish does not block other work and is not lost. A
  person sees it and decides.
- **Trigger:** a try on the request ends with no change.
- **Success end:** a person makes the request clear and sends it back to the agents, or closes it.

A retry helps only when the cause is outside the request. The same request usually fails for the
same reason, so the answer to a failure is a clear outcome, not one more try.

| Case                                                                    | Answer                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| The agent stops: crash, kill, restart, lost connection, lease ends.     | Retry: another agent takes it (M4).               |
| A short error outside easel: model rate limit, network, deploy.         | Retry, as above.                                  |
| The request is unclear.                                                 | Ask the viewer (M9).                              |
| The request is not possible or not allowed.                             | Give it back with the reason, to a person (P2).   |
| The result is wrong.                                                    | The viewer opens it again (M12).                  |
| Another agent changed the frame during the work.                        | Get the frame again and go on, in the same claim. |
| The frame or the canvas is removed.                                     | Mark it "may be outdated" (N8, M18).              |
| The request itself makes each agent stop (size, hostile text, timeout). | Send it to a person (P1).                         |

| ID  | Requirement                                                                                                           | Fit criterion                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P1  | A request that agents stop on again and again, with no outcome, goes to a person.                                     | A request never loops for ever between agents.                   |
| P2  | An agent that gives back a request says why.                                                                          | A person sees the reason for each try that ended with no change. |
| P3  | People see which requests no agent could finish.                                                                      | They find them at a glance, on the canvas.                       |
| P4  | Any viewer of the link, or an owner from the CLI, can make the request clear and send it back, or close it.           | No request stays without a way out.                              |
| P5  | An agent that does not understand a request asks a question (M9). It does not fail again and again.                   | An unclear request reaches a person after one try.               |
| P6  | Each try ends with one clear outcome: done, a question, or given back with a reason. Only a stopped agent gives none. | A person can see why each try ended.                             |

The number of stops before a request goes to a person (P1) is a design value, not a requirement.

#### Design changes that E4.3 needs

All rows below are closed in the specs (`224aa9e`, `c02b9e3`, `08a5056`).

| Req.   | Gap in the design now                                                     | Spec                          |
| ------ | ------------------------------------------------------------------------- | ----------------------------- |
| P1, P6 | Three claims of any kind make a comment stuck. A release gives no reason. | SPEC-queue, queue-lease chart |
| P4     | Nothing frees a stuck comment ("Freeing a stuck comment" is deferred).    | SPEC-queue, SPEC-viewer       |

### E4.4 Follow the requests

- **Actor:** viewer.
- **Need:** see what happens to all requests on the canvas, and find the requests that wait for a
  viewer.
- **Trigger:** the viewer opens the canvas, or comes back to it.
- **Success end:** the viewer knows the state of each request, and acts on the ones that wait.

| ID  | Requirement                                                                                                                                                                              | Fit criterion                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| F1  | The viewer sees all requests on the canvas and the state of each: waiting, in work (with the agent name), question for a viewer, result to check, done, needs a person, may be outdated. | Each state looks different. No reading is needed to tell them apart.                             |
| F2  | The viewer finds at a glance the requests that wait for a viewer: questions and results to check.                                                                                        | The count of these requests is always visible.                                                   |
| F3  | From a request, the viewer goes to its place on the canvas. From a place on the canvas, the viewer opens its request.                                                                    | One action in each direction.                                                                    |
| F4  | A change of state shows at once.                                                                                                                                                         | Within 1 second, with no reload.                                                                 |
| F5  | Done requests do not get in the way of open ones. A person can still find them (M17).                                                                                                    | Open work shows first. Old decisions are one step away.                                          |
| F6  | A viewer who comes back sees what changed while they were away.                                                                                                                          | An indicator shows each request that changed since the last visit of that browser, with a count. |

Decided:

- A viewer gets no notice outside the browser (mail, chat). A viewer has no address, and nothing
  blocks while a viewer is away. F6 covers the return.
- A viewer sees the requests of one canvas only. An owner who needs all canvases uses the CLI.

### E4 walk of the slice

On 2026-11-19, E4 was read from left to right as one viewer: open the link, ask, follow, answer,
accept. The walk changed N9 and N10, and added M19 and M20.

| Req. | Gap in the design now                                                       | Spec                     |
| ---- | --------------------------------------------------------------------------- | ------------------------ |
| N9   | No viewer takes back a request while an agent holds it.                     | SPEC-queue, request-life |
| N10  | Only the text of a new request is kept when easel does not accept it.       | SPEC-viewer              |
| M19  | An answer puts the request at the back of the queue.                        | SPEC-queue               |
| M20  | The design does not say what a viewer sees when another viewer acted first. | SPEC-viewer              |

## E5: Work through MCP

| ID   | Journey               | Actor | Design                                                                                          | Review |
| ---- | --------------------- | ----- | ----------------------------------------------------------------------------------------------- | ------ |
| E5.1 | Connect an agent      | user  | [mcp](../SPEC-mcp.md#a-local-agent-adds-easel), [mcp](../SPEC-mcp.md#a-remote-agent-adds-easel) | active |
| E5.2 | Work with no shell    | agent | [mcp](../SPEC-mcp.md#an-agent-works-through-mcp)                                                | active |
| E5.3 | Work reaches an agent | agent | [queue](../SPEC-queue.md#an-agent-works-the-queue)                                              | active |

Decided:

- E5 serves agents that run on a machine, and hosted agents with no shell: an agent in the Claude
  web app, and a cloud agent that a person starts from a phone.
- Easel connects in the ways that these platforms support. It does not ask them for more.

### E5.1 Connect an agent

- **Actor:** a user who runs an agent.
- **Need:** give an agent access to easel, also an agent with no shell.
- **Trigger:** the user wants an agent to work on canvases.
- **Success end:** the agent sees what it can do in easel.
- **Failure end:** the agent cannot get in, and the user knows why.

| ID  | Requirement                                                                                                                                     | Fit criterion                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| C1  | A user connects an agent in a way that its platform supports.                                                                                   | A user connects an agent in the Claude web app, and a cloud agent from a phone, with no shell there. |
| C2  | The user can stop the access of one agent at once, in easel. This is also true when the access leaked or the user does not control the harness. | After the stop, the next action of that agent fails, and the other agents keep working.              |
| C3  | A failed connection says why.                                                                                                                   | The user sees the cause without logs: no access, access stopped, or a wrong address.                 |

Decided:

- Easel owns the access, the queue and the time limits. A harness can give more protection, but
  easel does not depend on it.

### E5.2 Work with no shell

- **Actor:** agent.
- **Need:** do the work of an agent in E2, E3 and E4, with the same results as with the CLI.
- **Trigger:** the agent has a task on a canvas, or gets a request.
- **Success end:** the work ends as it does with the CLI.
- **Failure end:** the agent knows what happened and what to do next.

| ID  | Requirement                                                                                 | Fit criterion                                                                                                              |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| W1  | All actions of an agent in E2, E3 and E4 are possible with no shell.                        | An agent does the full E4.2 loop through MCP only.                                                                         |
| W2  | The agent learns from easel alone what each action does and when to use it.                 | An agent that does not know easel does a request, with the list of actions as its only guide.                              |
| W3  | The agent sees a frame as a viewer sees it.                                                 | An agent with no tool other than easel sees the picture of a frame.                                                        |
| W4  | Each failure tells the agent what happened and what to do next.                             | After each failure, the next action of the agent is correct, with no person.                                               |
| W5  | Text in a request or a frame never makes an agent do more than the request allows.          | A frame or a request that tells the agent to act on another canvas changes nothing there.                                  |
| W6  | No access is given because of text in a request or a frame.                                 | Each access that easel gives comes from a person who decided it.                                                           |
| W7  | Easel notices when the work of an agent looks wrong, and acts before a person must find it. | When an agent acts in a way that is not normal, a person learns of it from easel, and no harm grows while no person looks. |

Open questions:

- W7: which signs show that the work of an agent looks wrong, and what must easel do then?

### E5.3 Work reaches an agent

- **Actor:** agent. A person starts the work when the agent runs in a chat.
- **Need:** a request reaches an agent that can do it, also an agent that does not wait for work.
- **Trigger:** a request is waiting.
- **Success end:** an agent has the request.
- **Failure end:** no agent can take the request. It waits in the queue, and people see that it
  waits (F1).

| ID  | Requirement                                                                            | Fit criterion                                                                                                 |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D1  | All requests wait in one queue until an agent connects and takes them.                 | A request made when no agent is connected waits, and an agent that connects later gets it in the order of M1. |
| D2  | An agent that asks for work gets it (pull).                                            | M7 is true for an agent with no shell.                                                                        |
| D4  | When a person tells it to, an agent in a chat does all requests that wait on a canvas. | A person says "do the open requests on canvas X", and each of them ends with an outcome.                      |
| D5  | A person starts work on the requests from a phone.                                     | From a phone only, a person gets the open requests on a canvas done.                                          |

Decided:

- For now, agents get work only by pull, through MCP. Easel runs no agent of its own. Requests
  wait in the queue until an agent connects.
- Deferred: easel gives a request to an agent that does not ask for work, also one that is not
  running (push).
