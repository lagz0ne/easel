# Epics

This file is the story map of easel. It lists the epics in the order that a user meets them. Each
epic links to its journeys in the module specs. The journeys stay in the specs, so each journey has
one source. The words come from [glossary.md](glossary.md). The actors are in
[actors.md](actors.md).

## Method

| Step              | Source                                    | Action                                                                                   |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1. Write          | Patton, story mapping (2008)              | Give the epic one outcome sentence and its actors. Link its journeys.                    |
| 2. Check form     | Cockburn, use cases (2000); INVEST (2003) | Each journey has one actor, one goal, a trigger, a success end and its failure branches. |
| 3. Map examples   | Wynne, Example Mapping (2015)             | For each journey, list the rules, the examples of each rule, and the open questions.     |
| 4. Walk the slice | Patton                                    | Read the epic from left to right as one actor. Find the missing step.                    |
| 5. Prove          | SPEC.md, Success Criteria 1 and 8         | Each example becomes a test. Each rule with state becomes a statechart rule.             |

A journey is ready when it has no open question. A journey with many rules is too large: split it.
Write each journey in ASD-STE100, with the terms of the glossary only.

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

| ID   | Journey                          | Actor  | Source                                                                                       | Review |
| ---- | -------------------------------- | ------ | -------------------------------------------------------------------------------------------- | ------ |
| E4.1 | Attach a comment                 | viewer | [queue](../SPEC-queue.md#a-viewer-adds-a-comment), [viewer](../SPEC-viewer.md#pin-a-comment) | active |
| E4.2 | Do the change and reply          | agent  | [queue](../SPEC-queue.md#an-agent-works-the-queue)                                           | to do  |
| E4.3 | A comment that no agent finishes | agent  | [queue](../SPEC-queue.md#a-comment-no-agent-finishes)                                        | to do  |
| E4.4 | Follow the comments              | viewer | [viewer](../SPEC-viewer.md#follow-the-queue)                                                 | to do  |
