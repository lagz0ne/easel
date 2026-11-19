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
| E4.2 | Do the change and reply          | agent  | [queue](../SPEC-queue.md#an-agent-works-the-queue)                                           | to do  |
| E4.3 | A comment that no agent finishes | agent  | [queue](../SPEC-queue.md#a-comment-no-agent-finishes)                                        | to do  |
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
