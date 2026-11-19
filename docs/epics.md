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
| E5  | Work through MCP          | An agent with no shell does all of E2, E3 and E4.              | agent              | [mcp](../SPEC-mcp.md#journeys) 3                                                                                                      | Not built                  | to do  |
| E6  | Watch production          | An owner and an agent see errors, health and backups.          | owner, server      | [ops](../SPEC-ops.md#journeys) 5                                                                                                      | Built, except backups      | to do  |
| E7  | Fix errors with no person | An agent fixes a production error and proves the fix.          | fixer, tick, probe | [fixer](../SPEC-fixer.md#journeys) 5                                                                                                  | Not built                  | to do  |

## E4: Comment and get a change

| ID   | Journey                          | Actor  | Design                                                                                       | Review |
| ---- | -------------------------------- | ------ | -------------------------------------------------------------------------------------------- | ------ |
| E4.1 | Ask for a change                 | viewer | [queue](../SPEC-queue.md#a-viewer-adds-a-comment), [viewer](../SPEC-viewer.md#pin-a-comment) | ready  |
| E4.2 | Do the change and reply          | agent  | [queue](../SPEC-queue.md#an-agent-works-the-queue)                                           | ready  |
| E4.3 | A comment that no agent finishes | agent  | [queue](../SPEC-queue.md#a-comment-no-agent-finishes)                                        | active |
| E4.4 | Follow the comments              | viewer | [viewer](../SPEC-viewer.md#follow-the-queue)                                                 | to do  |

### E4.1 Ask for a change

- **Actor:** viewer.
- **Need:** ask for a change to one part of a design, and know that easel received the request.
- **Trigger:** the viewer sees something to change.
- **Success end:** all people on the canvas see the request, and an agent can take it.
- **Failure end:** easel does not accept the request. The viewer keeps the text and knows why.

| ID  | Requirement                                                                              | Fit criterion                                                                                          |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| N1  | The viewer can point at the exact part of a frame that the request is about.             | Another person who reads the request finds that part without help.                                     |
| N2  | The viewer can ask about the canvas as a whole, not about one frame.                     | A request such as "add a frame for the checkout page" has no frame, and an agent can still act on it.  |
| N3  | The viewer knows if easel received the request.                                          | Easel never loses a request silently, and never saves one request two times.                           |
| N4  | Each request has a short reference that people can use when they talk about it.          | Two requests on one canvas never have the same reference.                                              |
| N5  | All people who look at the canvas see the new request.                                   | They see it within 1 second, with no reload.                                                           |
| N6  | The request shows who asked.                                                             | The request shows the name that the viewer gave.                                                       |
| N7  | The request stays on the part that it is about.                                          | When an agent moves the frame, the request moves with it.                                              |
| N8  | The request keeps what the viewer saw. A frame can change, become old, or be removed.    | A person can see what the viewer saw, and can see that the frame changed or was removed since.         |
| N9  | The viewer can correct or take back a request, for example one sent too soon by mistake. | A request sent by mistake can be corrected or removed before an agent starts work on it.               |
| N10 | If easel cannot accept the request, the viewer keeps the text and knows why.             | The text is never lost when the frame is removed, the link stops, or the canvas has too many requests. |
| N11 | One viewer cannot flood a canvas with requests.                                          | A flood from one viewer does not stop other viewers.                                                   |

#### Design changes that E4.1 needs

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

| ID  | Requirement                                                                                                                            | Fit criterion                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| M1  | No request waits for ever while newer requests get done.                                                                               | Agents take requests in the order they came.                                                       |
| M2  | Two agents never work on the same request at the same time.                                                                            | No request gets two changes from two agents.                                                       |
| M3  | The agent has all the facts it needs without a browser: the text, the place, what the viewer saw, and the current frame.               | An agent does the change with the CLI or MCP only.                                                 |
| M4  | A request comes back to the queue if its agent stops.                                                                                  | No person must free a request after an agent crashes.                                              |
| M5  | An agent that needs more time keeps the request.                                                                                       | A second agent does not take a request while the first agent still works on it.                    |
| M6  | An agent that cannot do the request gives it back.                                                                                     | Another agent can take it at once.                                                                 |
| M7  | A waiting agent gets a new request quickly, without a busy loop.                                                                       | A new request reaches a waiting agent within 1 second.                                             |
| M8  | A request allows a change only to what it is about: its frame, or its canvas for a request about the whole canvas (N2).                | The text of a request cannot make an agent change another canvas or another user.                  |
| M9  | The agent can ask the viewer a question before it makes the change.                                                                    | The viewer sees the question on the request and answers it. No agent works on it until the answer. |
| M10 | A question or a result can use the form that shows it best: text, HTML, a diagram, or a comparison of options or of before and after.  | The viewer can see two options side by side and pick one.                                          |
| M11 | When the agent says that the change is done, it gives the proof: what changed, before and after, and how the change meets the request. | The viewer can decide from the proof alone, with no other tool.                                    |
| M12 | The viewer accepts the result, or opens the request again with a note.                                                                 | A request that the viewer opens again goes back to the queue with all its history.                 |
| M14 | A request with a question waits for a viewer. It is not in the agent queue, and it never becomes stuck.                                | A question with no answer does not block other requests.                                           |
| M15 | A result with no answer from a viewer counts as done. A viewer can open it again later.                                                | No request stays open only because no viewer answered.                                             |
| M16 | Any viewer of the link can answer a question, accept a result, or open a request again. The request shows who did it.                  | A team decides together, and each step shows a name.                                               |
| M17 | The questions, the options, the proof and the decision stay with the request after it is done.                                         | A person can find later why a part of the design is as it is.                                      |
| M18 | A request that waits for a long time shows that it may be outdated.                                                                    | A person can tell an old request from a new one at a glance.                                       |
| M13 | The viewer sees each question and each result.                                                                                         | Within 1 second, with no reload.                                                                   |

Decided:

- Requests have no priority. Oldest first (M1) is the only order.
- Loose ends are better than stuck work. When a person does not answer, the work goes on, and a
  person can open it again later (M14, M15, M18).

#### Design changes that E4.2 needs

| Req.     | Gap in the design now                                                                                           | Spec                          |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| M9, M12  | A comment has one reply. Threads are out of scope.                                                              | SPEC-queue                    |
| M10, M11 | A reply is plain text of 1 to 2000 characters.                                                                  | SPEC-queue, SPEC-mcp          |
| M9, M12  | A comment has two stored states, `open` and `done`. There is no state that waits for the viewer, and no accept. | SPEC-queue, queue-lease chart |
| M11, N8  | easel keeps no old version of a frame ("Frame history" is out of scope), so "before" cannot be shown.           | SPEC.md, SPEC-frames          |
| M1       | "Priorities" is in the deferred list. Remove it: the need is not there.                                         | SPEC-queue                    |
