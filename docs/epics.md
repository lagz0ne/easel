# Epics

This file is the story map of easel. It lists the epics in the order that a user meets them. Each
epic links to its journeys in the module specs. The journeys stay in the specs, so each journey has
one source. The words come from [glossary.md](glossary.md). The actors are in
[actors.md](actors.md).

## Method

The method is in [method.md](method.md): the goal of a round (a minimum viable business), the
parts of an offer, the rules for a requirement, the forms, the steps, and the design proof. Apply
it with the skill `writing-requirements`.

## Story map

The main story is E1, E2, E3, then E4. E8 makes each frame fast to make and like the others, from
the first day. E5 gives the same actions through MCP. E6 and E7 keep the easel of each team healthy. E9 does for the
words what E8 does for the look.
E10 lets a person see each state of a frame with no agent. Round 1 (below) holds E1, E2, E3,
E4, E5.1, E5.2, E6, E8, part of E9, and E10. E7 is deferred.

| ID  | Epic                      | Outcome                                                                                     | Actors                  | Journeys                                                                                                                              | Status                                                                                                                  | Review |
| --- | ------------------------- | ------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| E1  | Get in                    | A person or an agent gets a token when an owner approves it.                                | team lead, owner, agent | [access](../SPEC-access.md#journeys), [cli](../SPEC-cli.md#journeys)                                                                  | Built                                                                                                                   | ready  |
| E2  | Make frames               | An agent puts HTML frames on a canvas and changes them safely.                              | agent                   | [frames](../SPEC-frames.md#make-a-canvas): make a canvas, make and change frames                                                      | Built, except `frame.move`                                                                                              | ready  |
| E3  | Share and look            | A person opens a link and sees the frames change at once.                                   | agent, viewer           | [frames](../SPEC-frames.md#share-a-canvas): share, open; [viewer](../SPEC-viewer.md#journeys) 7; [design](../SPEC-design.md#journeys) | Built                                                                                                                   | ready  |
| E4  | Comment and get a change  | A viewer asks for a change. An agent makes it and replies.                                  | viewer, agent           | [queue](../SPEC-queue.md#journeys) 3; [viewer](../SPEC-viewer.md#ask-for-a-change): ask for a change, follow the requests             | Built; a GitHub run can get the CLI and sign in ([cli](../SPEC-cli.md#sign-in-with-no-file)), but no real run is proven | active |
| E5  | Work through MCP          | An agent with no shell does all of E2, E3 and E4.                                           | agent                   | [mcp](../SPEC-mcp.md#journeys) 3                                                                                                      | Specified; no MCP server yet                                                                                            | active |
| E6  | Watch production          | The company sees the health, the errors and the copies of each easel.                       | company                 | [ops](../SPEC-ops.md#journeys) 5                                                                                                      | Built, except backups                                                                                                   | ready  |
| E7  | Fix errors with no person | An agent fixes a production error and proves the fix.                                       | fixer, tick, probe      | [fixer](../SPEC-fixer.md#journeys) 5                                                                                                  | Not built                                                                                                               | to do  |
| E8  | One look, fast            | Agents make frames fast, and all frames of a team look like one product.                    | agent, user             | [kit](../SPEC-kit.md#journeys) 3                                                                                                      | Built: the look, the kit, its pieces and capsules; not all fit criteria are proven                                      | to do  |
| E9  | One voice                 | All frames of a team say one thing in one way, and one change of a text reaches each frame. | agent, user, person     | [kit](../SPEC-kit.md)                                                                                                                 | Each frame keeps its own texts; nothing keeps the texts of a team                                                       | to do  |
| E10 | See each state of a frame | A person sees a frame in each state of its design, with no agent.                           | viewer, user            | [kit](../SPEC-kit.md#the-capsules): controls, panes                                                                                   | Built; no test names X1 to X5                                                                                           | to do  |

## Round 1: Show the design

- **Outcome:** a team shows its design on a canvas. People see it, change its states and comment
  on it, and agents make and change the design through MCP. Each requirement, decision and
  deferred item of the round is matched against this outcome.
- **Offer:** a hosted easel for one team, at no cost, while the company learns.
- **Customer:** the team of the company and a small number of invited teams. No team pays in this
  round.
- **Base:** none.

| Part  | Mark                                                                             | Epics or reason                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Value | in the round                                                                     | E1, E2, E3, E4.1 to E4.4, E4.5 (an agent that asks), E5.1, E5.2, E8, E9 (L1, L3, L5, L12) and E10. The outcome needs each of them: see, change the states, comment, and drive the design through MCP. |
| Get   | by hand: the company starts the easel of each team (R1), with written steps (R2) | The teams come from the contacts of the company.                                                                                                                                                      |
| Pay   | deferred: no team pays in this round (R3)                                        | Add it when the first team pays.                                                                                                                                                                      |
| Help  | by hand: the company answers at one address (R4)                                 | A share link from the team lets the company see what the team sees.                                                                                                                                   |
| Run   | in the round: E6, except backups; by hand: updates (R6)                          | Deferred: a copy off the host (R5). Add it when the first team pays, or a team keeps work on easel that it cannot make again.                                                                         |
| Trust | by hand: one easel for each team (R1), a short note (R7), a delete (R8)          | The note says who sees the work, where it is kept, and how to delete it. Terms that a lawyer checked come with Pay.                                                                                   |
| Learn | by hand: the company talks with each team each month (R9)                        | A talk with a small number of teams teaches more than numbers.                                                                                                                                        |

### What works at once

The user named, on 2026-11-23, what must work on a new easel with no setup:

| Need                                       | Requirements                    |
| ------------------------------------------ | ------------------------------- |
| A person comments on the design.           | E4.1 (N), E4.2, E4.4            |
| A person sees the content.                 | E3 (S1 to S15)                  |
| The design system and its components work. | E8 (K1 to K14)                  |
| The texts of the frames are in one place.  | E9: L1, L3, L5, L12             |
| The controls of a frame work.              | E10: X1 to X5                   |
| An agent drives the design through MCP.    | E5.1, E5.2 (C1 to C3, W1 to W6) |
| The critical path is fast, and stays fast. | Q1 to Q3 (below)                |

### The quality of the round

| ID  | Requirement                                                     | Fit criterion                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | The critical path is fast.                                      | On the reference laptop (written in `docs/canvas-speed.md`): a share link shows the frames in view within 2 seconds. A change by an agent shows within 1 second (S9). A comment shows to each other person on the canvas within 1 second. |
| Q2  | The critical path stays fast when the work grows.               | With 200 frames on a canvas, Q1 and S11 are still true. A change of easel that makes a step of Q1 slower than its budget is live for 10 minutes at most; then easel goes back to the last build that met it.                              |
| Q3  | The critical path does only the work that the person waits for. | The first view of a canvas comes as fast (within 10%) with each part that it does not show turned off. Work that the person does not wait for never makes a step of Q1 slower.                                                            |

### The business of the round

| ID  | Requirement                                                    | Fit criterion                                                                                                                                                                                                 | Round 1               |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| R1  | A new team gets an easel that holds only its own work.         | Within 1 working day of the request, the team lead has the address of the easel of the team and its setup code. A person of another team cannot see its canvases, except by a share link.                     | by hand               |
| R2  | A new team gets the first value with no help from the company. | With only the written start steps, the team lead and one agent have a first frame on a shared canvas within 30 minutes after the setup code.                                                                  | in the round          |
| R3  | The team lead pays the agreed price.                           | Each month, the team lead gets an invoice for the price agreed before the start.                                                                                                                              | deferred              |
| R4  | A team gets help when easel does not do what it needs.         | The team knows one address for help. A person of the company answers within 1 working day, and can see the problem from a share link that the team sends.                                                     | by hand               |
| R5  | A team keeps its work when the server or its host is lost.     | After a restore, the team has each canvas, frame, share link and request as it was at most 1 hour before the loss. A person of the company did a restore with the written steps before the first team starts. | deferred              |
| R6  | A team gets fixes with no loss.                                | On the day of an update, each easel of each team has the update. Its canvases, share links and requests work as before.                                                                                       | by hand               |
| R7  | A team knows the terms, and how the company uses its data.     | The team lead accepts the terms and the privacy text before the company gives the setup code. The texts say who can see the work of the team, where it is kept, and how to delete it.                         | by hand: a short note |
| R8  | A team that leaves gets its work deleted.                      | Within 7 days of the request, the easel of the team and its data, backups included, are deleted. The team lead gets a note that says so.                                                                      | by hand               |
| R9  | The company learns what the teams need.                        | Each month, there is a note for each team that says what the team needs and what stopped it.                                                                                                                  | by hand               |

Open questions: none.

Decided:

- On 2026-11-23, the user gave Round 1 its outcome: "use the canvas to show off the design, making
  comment, use MCP to drive the design". Each slice of easel has one outcome, and its decisions
  and deferred items are matched against it.
- On 2026-11-23, the user chose the customer: the team of the company and invited teams, at no
  cost. So Pay (R3), a copy off the host (R5) and terms that a lawyer checked (R7) are not
  necessary for the outcome.
- On 2026-11-23, E5.1 and E5.2 moved into the round, for a local agent and an agent in the Claude
  web app. C1 holds for these two in this round.
- On 2026-11-23, part of E9 moved into the round: the texts of the frames, each in one place by its
  key, so that a second language needs no change to a frame (L1, L3, L5, L12).
- On 2026-11-23, E10 came into the round: the controls of a frame, built on 2026-11-22 and
  2026-11-23 with no requirement before them.
- "Well laid" (Q3) is from the user: "get non essential out of hotpath".
- The company runs one easel for each team (R1). A shared server would show the canvases of each
  team to the other teams.
- On 2026-11-21, the user moved E8 into Round 1: easel is agent first, so frames must be fast to
  make and alike from the first day.
- Deferred: a way to get requests to agents other than an agent that asks (E4.5: D6, D7, D9 and
  D10, GitHub). Add it when a team works from GitHub, or requests wait for a person to start an
  agent.
- Deferred: E5.3, work from a chat or a phone (D4, D5), and a cloud agent from a phone (C1). Add it
  when a person of a team wants the requests done with no computer.
- Deferred: the rest of E9 (L2, L4, L6 to L11). Add it when the frames of a team name one thing in
  two ways, or a person reviews or translates the words.
- Deferred: a control for all frames at one time, other than the language (a theme, a data set).
  Add it when a review needs one state on each frame at the same time.
- Deferred: E7, fix errors with no person. Add it when the errors of all teams take a person of the
  company more than 1 hour a day.
- Deferred: moving a frame (E2). Add it when a team asks for it.
- Deferred: a page that tells people the company does not know what easel is. Add it when the
  company looks for teams outside its contacts.
- Deferred: sign-up and payment with no person of the company. Add them when the invoices and the
  new easels of a month take a person more than 1 day.
- Deferred: one server for many teams. Add it when the cost of one easel for each team is too high.
- Deferred: an export of the work of a team. Add it when a team asks to leave with its work.

#### Design changes that Round 1 needs

| Req.            | Gap in the design now                                                                                          | Spec or file                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| C1, C2          | `/mcp` takes a fixed token only. The Claude web app needs each person to sign in with their own easel account. | [SPEC-mcp-auth](../SPEC-mcp-auth.md) (approved) |
| L1, L3, L5, L12 | Each frame keeps its own texts. Nothing keeps the texts of the team in one place.                              | SPEC-kit                                        |
| Q3              | No measure shows which work is on the critical path and which is not.                                          | docs/canvas-speed.md                            |
| R7              | The terms and the privacy text are drafts. Round 1 needs only the short note.                                  | docs/legal                                      |

Closed before: R2 (`c79d841`, `6a5a0ec`: the install script and [the start steps](start.md); MCP in them on 2026-11-23), C3 and W1 to W6 (SPEC-mcp, built), R5
and R8 (`8d452f6`: the design of the backups and the delete).

### Round 1 walk of the slice

On 2026-11-20, Round 1 was read as a team lead and as the company. That walk added R1 to R9.

On 2026-11-23, Round 1 was read again against its new outcome, as one person of an invited team:
get the easel and the setup code, connect an agent in the Claude web app, ask it for a screen, see
the frame in the look of the kit with the team's texts, open the share link, change the data and
the language of the frame with its controls, comment, see the agent take the request through MCP,
change the frame and reply. Then it was read as the company: start the easel, watch it, update it,
answer, talk with the team. The walk added Q1 to Q3 and X1 to X5, and found the gap of R2: the
start steps have no MCP.

## E1: Get in

| ID   | Journey                     | Actor     | Design                                                                           | Review |
| ---- | --------------------------- | --------- | -------------------------------------------------------------------------------- | ------ |
| E1.1 | Take charge of a new easel  | team lead | [access](../SPEC-access.md#become-the-first-owner)                               | ready  |
| E1.2 | Let an agent or a person in | agent     | [access](../SPEC-access.md#join-a-server), [cli](../SPEC-cli.md#sign-in-and-out) | ready  |
| E1.3 | Stop the access of a user   | owner     | [access](../SPEC-access.md#revoke-a-user), [access](../SPEC-access.md#sign-out)  | ready  |

### E1.1 Take charge of a new easel

- **Actor:** team lead.
- **Need:** become the first owner of the new easel of the team, so that no other person can.
- **Trigger:** the team lead gets the address of the easel and its setup code from the company
  (R1).
- **Success end:** the team lead is an owner, and can let the agents and the people of the team in.
- **Failure end:** the code was used, or is old. Nothing changes on the easel. The team lead gets a
  new code from the company (R4).

| ID  | Requirement                                                  | Fit criterion                                                                   |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| A1  | Only the person with the setup code becomes the first owner. | The code works one time. A second use is refused, and changes nothing.          |
| A2  | A team lead whose code does not work can still take charge.  | The company gives a new code within 1 working day, and the easel loses no work. |

### E1.2 Let an agent or a person in

- **Actor:** agent, or a person of the team who uses the command line. An owner decides.
- **Need:** get access to the easel of the team, but only when an owner agrees.
- **Trigger:** the agent asks for access with a name.
- **Success end:** the agent has access with its name, and keeps it from one run to the next.
- **Failure end:** the owner says no, or no owner answers in time. The agent has no access, knows
  why, and can ask again.

| ID  | Requirement                                                                                            | Fit criterion                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| A3  | The owner knows who asks before agreeing.                                                              | The owner sees the name, when it asked, and a short code that the agent also shows.                        |
| A4  | The agent need not stay connected while it waits for the owner.                                        | An agent that stops and asks again later has access at once if the owner agreed meanwhile.                 |
| A5  | A request for access that no owner answers does not stay open.                                         | After 10 minutes, it ends, and the agent is told.                                                          |
| A6  | Each name is one user of the easel.                                                                    | A name in use is refused at once, and the agent is told to choose another.                                 |
| A7  | An owner can make another owner.                                                                       | The new owner can let users in and stop them.                                                              |
| A8  | An agent that starts new on each run, such as a run on GitHub (E4.5), gets in with no owner each time. | The team lead sets it up one time. Each later run has access with no person, until an owner stops it (A9). |

### E1.3 Stop the access of a user

- **Actor:** owner. A user can also stop their own access.
- **Need:** stop a user or an agent that must not work on the easel any more: it left the team, or
  its access was lost.
- **Trigger:** the owner decides, or the user signs out.
- **Success end:** the user can do nothing on the easel. Its name is free again.
- **Failure end:** the user is the last owner. Nothing changes, so the easel always has an owner.

| ID  | Requirement                                   | Fit criterion                                                                     |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| A9  | A stopped user can do nothing from that time. | Its next action is refused, and it is told to ask for access again.               |
| A10 | The easel always has an owner.                | Stopping or signing out the last owner is refused, and nothing changes.           |
| A11 | A user can sign out.                          | After sign out, the computer of the user keeps no access. The name is free again. |

Decided:

- A viewer needs no access. A viewer uses a share link (E3).
- There are two roles: owner and user. Deferred: more roles. Add them when a team asks that some
  users cannot delete a canvas.

#### Design changes that E1 needs

| Req. | Gap in the design now                                                                       | Spec                 |
| ---- | ------------------------------------------------------------------------------------------- | -------------------- |
| A8   | The command line reads its access only from its own file. A run on GitHub has no such file. | SPEC-cli, SPEC-queue |

SPEC-cli closes A8 with `login --print-token` and `EASEL_TOKEN` (`c79d841`).

## E2: Make frames

| ID   | Journey                | Actor | Design                                             | Review |
| ---- | ---------------------- | ----- | -------------------------------------------------- | ------ |
| E2.1 | Make a canvas          | agent | [frames](../SPEC-frames.md#make-a-canvas)          | ready  |
| E2.2 | Make and change frames | agent | [frames](../SPEC-frames.md#make-and-change-frames) | ready  |

### E2.1 Make a canvas

- **Actor:** agent.
- **Need:** a place for the frames of one piece of work, with a name that people know.
- **Trigger:** the agent starts a new piece of work.
- **Success end:** the canvas is in the list of the easel, with its name and a short key.
- **Failure end:** the name is in use, or has no letter or digit. Nothing is made, and the agent
  knows why.

| ID  | Requirement                                                                | Fit criterion                                                                    |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| B1  | The agent names a canvas, and refers to it with a short key from its name. | A person reads the key as the name: "Checkout flow" has the key `checkout-flow`. |
| B2  | The agent sees all canvases of the easel.                                  | One list shows each canvas with its name, its date, and if it is shared.         |
| B3  | The agent can delete a canvas with all that it holds.                      | After the delete, the canvas, its frames, its requests and its link are gone.    |

### E2.2 Make and change frames

- **Actor:** agent.
- **Need:** put HTML pages on a canvas and change them, and lose no change of another agent.
- **Trigger:** the agent has a page to show, or a change to make.
- **Success end:** each person who looks sees the new page.
- **Failure end:** another agent changed the frame first. Nothing is written. The agent gets the
  newest page, and makes its change on it.

| ID  | Requirement                                                             | Fit criterion                                                                                         |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| B4  | The agent adds a frame of a size that it chooses, next to the others.   | A new frame shows next to the other frames, not on them.                                              |
| B5  | The agent gets the page of a frame, to change it.                       | The agent gets the same page that the people see.                                                     |
| B6  | A change made on an old page does not remove a newer change.            | When two agents change one frame at the same time, the second is refused and told. No change is lost. |
| B7  | A page that is the same as the stored page makes no new version.        | The version stays the same.                                                                           |
| B8  | The agent sees a frame as a person sees it, with no browser of its own. | A picture of the frame looks as it does in a browser, at the scale that the agent asks for.           |
| B9  | The agent can delete a frame. Its requests stay.                        | After the delete, each request of the frame is still there, marked "may be outdated" (N8).            |

Decided:

- Deferred: moving a frame (Round 1). Add it when a team asks for it.

## E3: Share and look

| ID   | Journey            | Actor  | Design                                                                                                                    | Review |
| ---- | ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| E3.1 | Share a canvas     | user   | [frames](../SPEC-frames.md#share-a-canvas)                                                                                | ready  |
| E3.2 | Look at the frames | viewer | [frames](../SPEC-frames.md#open-a-share-link), [viewer](../SPEC-viewer.md#journeys), [design](../SPEC-design.md#journeys) | ready  |

The design of each state that a user or a viewer sees is on the Doop canvas
[easel · Product design](https://doop.vibea.dev/c/xFJSTXA-v5), page `Work · E3 Share and look`:
the sheet `E3.00`, then one state sheet and its click paths for each journey. Each state shows the
IDs below that it meets. Decided on 2026-11-21: the viewer gives a name at the first request, not
when the link opens (S7).

Decided on 2026-11-23: the viewer finds a frame by its name only (S15). Deferred: a find in the text
that a frame shows. Add it when a viewer cannot find a frame by its name.
Decided on 2026-11-23: the design of S15 is option A, Find in the dock: a button `Find` and the key
`/` open a small list of frame names over the dock, as Miro and Excalidraw do. The user chose it on
the easel canvas `s15-find-a-frame` (request #9), over a palette (B) and a Frames panel (C).

### E3.1 Share a canvas

- **Actor:** user (an agent or a person of the team).
- **Need:** show a canvas to people who have no access to the easel, and stop it when necessary.
- **Trigger:** the work is ready to show.
- **Success end:** the user has a link. Each person with the link can look, and ask for changes
  (E4).
- **Failure end:** the canvas is not there. No link is made, and the user knows why.

| ID  | Requirement                                                    | Fit criterion                                                                      |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| S1  | A link opens the canvas with no access to the easel.           | A person with the link sees the canvas in a browser, with no sign-in.              |
| S2  | The user can protect the link with a password.                 | With a password, the link shows nothing of the canvas until the password is given. |
| S3  | Nobody can find the password by many tries.                    | After 5 wrong tries in 1 minute, the link takes no password for 1 minute.          |
| S4  | A new password stops at once each person who has the old one.  | Within 1 second, each open tab asks for the new password.                          |
| S5  | The user can stop the link at once.                            | Within 1 second, each open tab shows that the link has ended, and nothing more.    |
| S6  | A new link or a new password keeps the requests of the canvas. | After the change, each request is still there.                                     |

### E3.2 Look at the frames

- **Actor:** viewer.
- **Need:** see the frames as they are now, and see them change, with no reload.
- **Trigger:** the viewer opens the link.
- **Success end:** the viewer sees each frame as a browser shows it, and sees each change at once.
- **Failure end:** the link ended, or is wrong. The viewer sees a page that says so, and nothing of
  the canvas. If the connection is lost, the viewer sees that the page may be behind. When it is
  back, the page shows what changed.

| ID  | Requirement                                                                                        | Fit criterion                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7  | The viewer gives a name one time.                                                                  | The same browser does not ask again.                                                                                                                                                               |
| S8  | Each frame looks as the page does in a browser.                                                    | The viewer never sees an empty white box where a frame is.                                                                                                                                         |
| S9  | A change by an agent shows at once.                                                                | Within 1 second, with no reload and no white flash.                                                                                                                                                |
| S10 | The viewer pans and zooms as in other design tools.                                                | Drag, scroll, pinch, the zoom buttons and "fit" work as in Figma.                                                                                                                                  |
| S11 | A large canvas stays fast.                                                                         | With 200 frames, pan and zoom do not stop or jump.                                                                                                                                                 |
| S12 | The viewer knows when the page may be behind.                                                      | A mark shows while the connection is lost. It goes only when the page shows the changes again.                                                                                                     |
| S13 | A viewer cannot change a frame.                                                                    | The page has no control that changes a frame.                                                                                                                                                      |
| S14 | Each person can use the page: in a light or dark theme, with only a keyboard, or with less motion. | Each control can be reached with the keyboard, and shows where the focus is. Text has WCAG AA contrast in both themes. A person who asks for less motion sees no movement that they did not start. |
| S15 | The viewer finds a frame among many.                                                               | On a canvas of 200 frames, a viewer who knows the name of a frame has it in view within 10 seconds, with no pan and no zoom.                                                                       |

## E4: Comment and get a change

| ID   | Journey                             | Actor     | Design                                                                                                                         | Review |
| ---- | ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| E4.1 | Ask for a change                    | viewer    | [queue](../SPEC-queue.md#a-viewer-asks-for-a-change), [viewer](../SPEC-viewer.md#ask-for-a-change)                             | ready  |
| E4.2 | Do the change and reply             | agent     | [queue](../SPEC-queue.md#an-agent-works-the-queue)                                                                             | ready  |
| E4.3 | A request no agent finishes         | agent     | [queue](../SPEC-queue.md#a-request-no-agent-finishes)                                                                          | ready  |
| E4.4 | Follow the requests                 | viewer    | [viewer](../SPEC-viewer.md#follow-the-requests)                                                                                | ready  |
| E4.5 | Work reaches the agents of the team | team lead | [queue](../SPEC-queue.md#the-dispatcher-gets-a-request-to-the-agents), [queue](../SPEC-queue.md#a-team-lead-sets-the-channels) | ready  |

The design of each state that a viewer sees is on the Doop canvas
[easel · Product design](https://doop.vibea.dev/c/xFJSTXA-v5), page
`Work · E4 Comment and get a change`: one sheet for each journey (E4.1 to E4.4). Each state shows the IDs below that it meets.

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
| M6  | An agent that must stop for a cause outside the request gives it back.                                                                 | Another agent can take it at once.                                                                                      |
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
- **Failure end:** no person acts. The request stays with the people, no agent takes it again, and
  people see it on the canvas (P3) until a person acts.

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
- **Failure end:** the connection is lost. The viewer sees that the states may be behind. When the
  connection is back, each state is correct again, and the marks of F6 show what changed.

| ID  | Requirement                                                                                                                                                                                                                   | Fit criterion                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| F1  | The viewer sees all requests on the canvas and the state of each: waiting, in work (with the agent name), question for a viewer, result to check, done, needs a person, may be outdated, closed (by a person, or taken back). | Each state looks different. No reading is needed to tell them apart.         |
| F2  | The viewer finds at a glance the requests that wait for a viewer: questions, results to check, and requests that need a person (P4).                                                                                          | The count of these requests is always visible.                               |
| F3  | From a request, the viewer goes to its place on the canvas. From a place on the canvas, the viewer opens its request.                                                                                                         | One action in each direction.                                                |
| F4  | A change of state shows at once.                                                                                                                                                                                              | Within 1 second, with no reload.                                             |
| F5  | Done requests do not get in the way of open ones. A person can still find them (M17).                                                                                                                                         | Open work shows first. Old decisions are one step away.                      |
| F6  | A viewer who comes back sees what changed while they were away.                                                                                                                                                               | A mark shows each request that changed since the last visit of that browser. |

Decided:

- A viewer gets no notice outside the browser (mail, chat). A viewer has no address, and nothing
  blocks while a viewer is away. F6 covers the return.
- A viewer sees the requests of one canvas only. An owner who needs all canvases uses the CLI.
- The list and an open request show in one card, docked at the right edge of the view, over the
  canvas. The card does not move when the canvas pans, and the canvas does not move when the card
  opens. A press on a pin or a row opens its request in the card. The user decided it on
  2026-11-23 (requests #4 and #11 on the canvas `s15-find-a-frame`): the drawer moved the canvas,
  and the popover by the pin moved with each pan. Prior art: the comments panel of Miro.

### E4.5 Work reaches the agents of the team

- **Actor:** team lead. The agents of the team get the work.
- **Need:** each request gets to an agent of the team in the way that the team works: an agent
  that asks for work, an agent that is not running yet, or an agent that works from the GitHub of
  the team. If not, requests wait until a person starts an agent.
- **Trigger:** a request is waiting.
- **Success end:** an agent of the team has the request.
- **Failure end:** no way gets the request to an agent. The request waits in the queue, people see
  that it waits (F1), and the team lead sees why (D9).

| ID  | Requirement                                                                                               | Fit criterion                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | All requests wait in one queue until an agent takes them.                                                 | A request made when no agent is connected waits, and an agent that comes later gets it in the order of M1.                               |
| D2  | An agent that asks for work gets it.                                                                      | M7 is true.                                                                                                                              |
| D6  | A request gets to an agent that is not running, with no person to start it.                               | With no agent running and no person acting, an agent has a new request within 2 minutes.                                                 |
| D7  | The team lead chooses the ways that requests get to the agents of the team: one way, or more at one time. | The team lead changes the ways, and the next request goes the new ways, with no new version of easel.                                    |
| D8  | Each request is done one time only, also when it goes more than one way.                                  | With two ways on, each of 20 requests ends with one outcome, not two.                                                                    |
| D9  | The team lead sees how each request got to an agent, and why one did not.                                 | On each request, a person sees the way that it went and when. When a way fails, the cause shows within 1 minute.                         |
| D10 | A team whose agents work from GitHub gets each request there, and sees there when it ends.                | Within 1 minute of a new request, it shows in the GitHub repository that the team chose. When it ends in easel, it shows as ended there. |

Decided:

- There is one queue. A way only takes a request to an agent. The order (M1) and "one time only"
  (D8) are the same for each way.
- Round 1 has two ways: an agent that asks for work (built, D2), and GitHub (D10). GitHub meets D6
  with no service of the team: an agent that starts from a GitHub issue does the work.
- Easel runs no agent of its own. The agents and their model costs stay with the team.
- Deferred: a call to a service of the team when a request waits. Add it when a team has its own
  service that starts agents.
- Deferred: an agent in a chat or with no shell (E5). Add it with E5.
- On 2026-11-23, Round 1 keeps one way: an agent that asks for work (D1, D2, D8), also through
  MCP. GitHub and the other ways (D6, D7, D9, D10) are deferred: see Round 1.
- Deferred: a different way for each canvas. Add it when a team asks for it.

#### Design changes that E4.5 needs

| Req.   | Gap in the design now                                                     | Spec       |
| ------ | ------------------------------------------------------------------------- | ---------- |
| D6, D7 | Agents get work only when they ask. There is no other way, and no choice. | SPEC-queue |
| D9     | Nothing records how a request got to an agent.                            | SPEC-queue |
| D10    | Easel does not put requests on GitHub.                                    | SPEC-queue |

SPEC-queue closes D6, D7, D9 and D10 with the dispatcher and the channels, and the statechart
[queue-dispatch](statecharts/queue-dispatch.md) (2026-11-20).

### E4 walk of the slice

On 2026-11-19, E4 was read from left to right as one viewer: open the link, ask, follow, answer,
accept. The walk changed N9 and N10, and added M19 and M20. The state sheets of the design (same
day) added closed to F1, needs a person to F2 as SPEC-viewer has it, and removed the count from F6.

All rows below are closed in the specs (2026-11-20, with the E4 design): SPEC-queue, SPEC-viewer,
and the charts request-life and viewer-queue.

| Req. | Gap in the design now                                                                                | Spec                     |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------ |
| N9   | No viewer takes back a request while an agent holds it.                                              | SPEC-queue, request-life |
| N10  | Only the text of a new request is kept when easel does not accept it.                                | SPEC-viewer              |
| M19  | An answer puts the request at the back of the queue.                                                 | SPEC-queue               |
| M20  | The design does not say what a viewer sees when another viewer acted first.                          | SPEC-viewer              |
| F6   | `Requests` also shows how many requests changed. The F6 fit has no count: one number (F2) is enough. | SPEC-viewer              |

## E5: Work through MCP

| ID   | Journey            | Actor | Design                                                                                          | Review |
| ---- | ------------------ | ----- | ----------------------------------------------------------------------------------------------- | ------ |
| E5.1 | Connect an agent   | user  | [mcp](../SPEC-mcp.md#a-local-agent-adds-easel), [mcp](../SPEC-mcp.md#a-remote-agent-adds-easel) | ready  |
| E5.2 | Work with no shell | agent | [mcp](../SPEC-mcp.md#an-agent-works-through-mcp)                                                | ready  |
| E5.3 | Work from a chat   | agent | [queue](../SPEC-queue.md#an-agent-works-the-queue)                                              | ready  |

Decided:

- E5 serves agents that run on a machine, and hosted agents with no shell: an agent in the Claude
  web app, and a cloud agent that a person starts from a phone.
- On 2026-11-23, Round 1 takes E5.1 and E5.2 for a local agent and an agent in the Claude web app.
  E5.3 and a cloud agent from a phone are deferred: see Round 1.
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

| ID  | Requirement                                                                        | Fit criterion                                                                                 |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| W1  | All actions of an agent in E2, E3 and E4 are possible with no shell.               | An agent does the full E4.2 loop through MCP only.                                            |
| W2  | The agent learns from easel alone what each action does and when to use it.        | An agent that does not know easel does a request, with the list of actions as its only guide. |
| W3  | The agent sees a frame as a viewer sees it.                                        | An agent with no tool other than easel sees the picture of a frame.                           |
| W4  | Each failure tells the agent what happened and what to do next.                    | After each failure, the next action of the agent is correct, with no person.                  |
| W5  | Text in a request or a frame never makes an agent do more than the request allows. | A frame or a request that tells the agent to act on another canvas changes nothing there.     |
| W6  | No access is given because of text in a request or a frame.                        | Each access that easel gives comes from a person who decided it.                              |

Decided:

- Deferred: easel notices agent work that looks wrong and acts first. Add it when a real case
  comes.

### E5.3 Work from a chat

- **Actor:** agent. A person starts the work in a chat.
- **Need:** a person who works with an agent in a chat, also from a phone, gets the open requests
  done.
- **Trigger:** a person tells the agent to do the open requests.
- **Success end:** each open request on the canvas ends with an outcome.
- **Failure end:** the agent cannot connect. The requests wait in the queue, and people see that
  they wait (F1).

| ID  | Requirement                                                                            | Fit criterion                                                                            |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| D4  | When a person tells it to, an agent in a chat does all requests that wait on a canvas. | A person says "do the open requests on canvas X", and each of them ends with an outcome. |
| D5  | A person starts work on the requests from a phone.                                     | From a phone only, a person gets the open requests on a canvas done.                     |

Decided:

- On 2026-11-20, D1 and D2 moved to E4.5. An agent that asks through MCP is one of the ways of
  E4.5. Easel runs no agent of its own.

## E6: Watch production

In Round 1, the company runs one easel for each team (R1). So the actor of E6 is the company: a
person of the company, or an agent of the company. The team lead is not an actor here.

| ID   | Journey                    | Actor   | Design                                                                                                    | Review |
| ---- | -------------------------- | ------- | --------------------------------------------------------------------------------------------------------- | ------ |
| E6.1 | See that each easel works  | company | [ops](../SPEC-ops.md#an-agent-checks-the-server), [ops](../SPEC-ops.md#a-person-sees-the-state)           | ready  |
| E6.2 | See the errors of a team   | company | [ops](../SPEC-ops.md#an-error-is-recorded), [ops](../SPEC-ops.md#an-error-group-moves-through-its-states) | ready  |
| E6.3 | Keep the work of each team | company | [ops](../SPEC-ops.md#the-data-is-safe)                                                                    | ready  |

### E6.1 See that each easel works

- **Actor:** company.
- **Need:** know that the easel of each team works, before a team says that it does not.
- **Trigger:** a check at fixed times, or a team asks for help (R4).
- **Success end:** the company sees, for each easel, that it works, its build, and its errors.
- **Failure end:** an easel does not answer. A person of the company is told, and starts the
  written steps for a failure.

| ID  | Requirement                                                          | Fit criterion                                                                                          |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| H1  | The company sees if an easel can serve, and what fails if it cannot. | One check with no access answers "ready", or names each part that fails.                               |
| H2  | The company sees the build of each easel.                            | One look shows the build, so the company sees that an update is on each easel (R6).                    |
| H3  | The company learns of a stopped easel before the team does.          | Within 5 minutes after an easel stops, a person of the company is told, with no team telling it.       |
| H4  | Each failure has written steps.                                      | For each part that a check names, the steps say what to do. A person of the company did them one time. |

### E6.2 See the errors of a team

- **Actor:** company.
- **Need:** see each error that a team meets, so that the company fixes it before the team asks
  for help.
- **Trigger:** an error occurs on the easel, or in the browser of a viewer.
- **Success end:** the company sees the error one time for each kind, with how often it occurs and
  on which build.
- **Failure end:** too many new kinds of error occur. The easel keeps working, and the company sees
  how many kinds were not kept.

| ID  | Requirement                                                            | Fit criterion                                                                        |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| H5  | Errors of one kind show as one item, with a count.                     | The same error 100 times shows as one item with the count 100.                       |
| H6  | The company marks an error as fixed only when the fix is on the easel. | A mark before the fix is on the easel is refused, and says why.                      |
| H7  | The company sees when a fixed error comes back.                        | An error that occurs again after its fix shows as "came back", with the fix it beat. |
| H8  | A false report from a browser does not make the company act.           | Errors that only browsers report show apart from the errors of the easel.            |
| H9  | No secret of a team shows in an error.                                 | No error text holds an access token, a password or a key.                            |

### E6.3 Keep the work of each team

- **Actor:** company.
- **Need:** the work of a team stays when its easel, its disk or its host is lost, or when an
  update goes wrong.
- **Trigger:** each hour, and before each update.
- **Success end:** a copy of the work, at most 1 hour old, is on a second host, and a restore of it
  works.
- **Failure end:** a copy fails. A person of the company is told, and the last good copy stays.

| ID  | Requirement                                              | Fit criterion                                                                                 |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| H10 | A copy of the work, at most 1 hour old, is off the host. | After the host is lost, a restore gives back the work as it was at most 1 hour before (R5).   |
| H11 | An update that goes wrong loses no work.                 | Before each update, a copy is made. A restore of it gives back each canvas as it was.         |
| H12 | The company learns of a copy that fails.                 | Within 2 hours after the last good copy, a person of the company is told.                     |
| H13 | A restore works with only the written steps.             | A person of the company did a restore with only the steps, before the first team starts (R5). |
| H14 | The copies of a team that leaves are deleted.            | Within 7 days of the request, no copy of the work of the team is on any host (R8).            |

Decided:

- E7 is deferred, so a person of the company acts on what E6 shows. The fixer does not.
- Deferred: a page that shows the state of each easel to the teams. Add it when a team asks for
  it more than one time.

#### Design changes that E6 needs

| Req.     | Gap in the design now                                                                                               | Spec            |
| -------- | ------------------------------------------------------------------------------------------------------------------- | --------------- |
| H3       | No check from outside the host tells a person. The probe is in SPEC-fixer (E7, deferred).                           | SPEC-ops        |
| H10, H12 | The copy off the host is the fixer's (E7, deferred), and runs one time a day. Its alarm comes after 48 hours.       | SPEC-ops        |
| H4, H13  | SPEC-ops names `docs/runbook.md`, but the file does not exist. No restore was done.                                 | docs/runbook.md |
| H14      | Nothing deletes the copies of one team.                                                                             | SPEC-ops        |
| H1–H14   | The design talks of one server. The company runs one easel for each team, so each check and copy is for each easel. | SPEC-ops        |

SPEC-ops closes H3, H10, H12, H14 and the row for each easel (`8d452f6`). The bucket and the check
from outside the host wait on the hub (hq-a6w, hq-kbl). H4 and H13 stay open: the runbook needs the
bucket first.

## E8: One look, fast

easel is agent first. An agent that writes each frame from nothing is slow, and its frames do not
look like the frames of the other agents. So each easel has one look and one kit from the first
day, and each agent of the team makes its frames from them.

| ID   | Journey                   | Actor | Design                                              | Review |
| ---- | ------------------------- | ----- | --------------------------------------------------- | ------ |
| E8.1 | Make a frame from the kit | agent | [kit](../SPEC-kit.md#make-a-frame-from-the-kit-e81) | to do  |
| E8.2 | Change the look           | user  | [kit](../SPEC-kit.md#change-the-look-e82)           | to do  |
| E8.3 | Add to the kit            | agent | [kit](../SPEC-kit.md#add-to-the-kit-e83)            | to do  |

Decided:

- On 2026-11-21, the user moved E8 into Round 1: easel is agent first, so frames must be fast to
  make and alike from the first day.
- A new easel has a complete look and kit. The team changes them. It does not start from nothing.
- One look and one kit for each easel. The company runs one easel for each team (R1).
- The look and the kit are for the frames of the team. The look of the easel page itself is
  [design](../SPEC-design.md), and the team does not change it.
- Prior art for the need: the design systems of Figma (libraries) and Doop (look values and
  components), and the generators v0, Lovable and Claude artifacts, which write screens from one
  known kit to be fast and alike. Doop is AGPL-3.0: easel takes only the need, and designs its own
  answer (`docs/canvas-speed.md`, "Clean room").
- On 2026-11-21, the user picked a kit on Tailwind (A+T): easel's kit classes for the common
  pieces, Tailwind utilities for all the rest, and the look as the Tailwind theme. "It'll take
  forever to cover everything, and we don't want generic look." The measure and the other
  variations are in [the decision](decisions/kit-on-tailwind.md).
- The defaults of that decision: a frame with findings is saved and told; a piece with findings is
  refused. Tailwind's palette, arbitrary colors and arbitrary font sizes are off and are findings;
  arbitrary layout values are allowed. The look's CSS names are shadcn's color names
  (`--primary`) and Tailwind's names for the rest (`--text-sm`, `--radius-md`); the theme maps the
  Tailwind classes to them. A frame may turn the kit off. easel keeps each kit version. A change of the
  look does not make a request "may be outdated". The seed must not look generic.
- The engine: Tailwind v4 `compile()` in Bun, pinned exactly to 4.3.5, with a new compiler for
  each make. A new Tailwind version is a new pin, and easel never makes again the CSS that it keeps.
- Deferred: a look for each canvas. Add it when a team makes two products on one easel.
- Deferred: frames in a light and a dark theme. Add it when a team asks for a dark theme of its
  product.
- Deferred: take the look from a web site or a design file. Add it when the brand of a team takes
  more than 10 minutes to set.
- Deferred: a page that shows the kit to people. Add it when a team asks to see the kit apart from
  its frames.
- Deferred: images, icons and a team's own fonts kept in easel. easel holds only the fonts of the
  seed look (the user, 2026-11-22). Add it when a frame cannot load what it needs.
- Deferred: a way to take a frame into an app of the team. A frame can be a full React and Tinker
  app ([frame-apps](decisions/frame-apps.md)), so its code can go into an app, but easel gives no
  export. Add it when a team asks to turn a frame into app code.
- Deferred: prototypes, that is, a flow of frames that share state, or a viewer who leads a review
  while the others follow. Add it when a team asks to click through a flow of frames, or to lead a
  review of a prototype. The planned answer is in [frame-apps](decisions/frame-apps.md): shared
  state at scope in the easel page, reached by rpc on each frame's port.

### E8.1 Make a frame from the kit

- **Actor:** agent.
- **Need:** make a frame fast, in the look of the team, so that the frames of all agents look like
  one product.
- **Trigger:** the agent has a screen to show.
- **Success end:** the frame shows on the canvas in the look of the team, made from the kit.
- **Failure end:** the frame does not follow the look. The agent knows at once where and how to fix
  it.

| ID  | Requirement                                                                          | Fit criterion                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | On a new easel, an agent makes frames in a complete look, with no design work first. | The first frame on a new easel has the same colors, type, spacing and controls as a finished product. A person of the team accepts its look with no change. Its text passes K8.                                                                                                                                                                |
| K2  | The agent learns the kit and its rules from easel alone.                             | An agent that never used easel makes a correct frame from the kit on its first try, with the guide of easel as its only help.                                                                                                                                                                                                                  |
| K3  | A frame from the kit is fast to make.                                                | With the reference agent (Claude Sonnet), for each of the 3 reference screens (a form, a list, a dashboard; their briefs are kept in the repo), the median of 3 runs writes the frame within 20 seconds, and in less than half the time of the same screen with the no-kit guide. The put shows the frame on the canvas within 1 second after. |
| K4  | The frames of several agents look alike.                                             | On a canvas of 10 frames from 3 agents, a person finds no two controls of one kind that differ in color, type, size or spacing.                                                                                                                                                                                                                |
| K5  | The agent knows at once when a frame does not follow the look.                       | A frame with a color, a font size, a space or a radius that is not a look value, a class or a piece that is not in the kit or the look, or a frame rule that sets a look value, is found when the agent writes it. The agent is told the line, what is there, and the fix.                                                                     |
| K6  | The kit does not make the canvas slower.                                             | With 200 frames from the kit, S8, S9 and S11 are still true.                                                                                                                                                                                                                                                                                   |

### E8.2 Change the look

- **Actor:** user (an agent or a person of the team).
- **Need:** give all frames the brand of the team with one change, and lose nothing that people
  saw before.
- **Trigger:** the team has a brand, or a viewer asks for a change of the look (E4).
- **Success end:** each frame of the easel shows the new look, and no agent changed a frame.
- **Failure end:** the change makes text hard to read. Nothing changes, and the user knows which
  part fails.

| ID  | Requirement                                                             | Fit criterion                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K7  | One change of the look reaches each frame.                              | After one change of the main color, each live document in each open tab shows the new color within 1 second, with no reload. Each other frame in view shows it within 10 seconds on a canvas with 20 frames in view, and shows its last picture until then, never a white box. No agent changed a frame. |
| K8  | A change of the look keeps text readable.                               | A change that makes a text of the kit fail WCAG 2.2 1.4.3 (4.5:1), or a field edge or the focus ring fail 1.4.11 (3:1), is refused. The user is told which pair, its ratio, and where the kit uses it.                                                                                                   |
| K9  | The user can go back to the look before.                                | One step gives each frame the look that it had before the last change. The step is a change too, so a second step gives the look back.                                                                                                                                                                   |
| K10 | A change of the look does not change what a viewer saw when they asked. | After the change, the Before of each result, and the When asked picture of each request, show the frame in the look that the viewer saw (E4).                                                                                                                                                            |
| K11 | An update of easel does not change the look or the kit of a team.       | After an update (R6), the look, the kit and the document that each frame shows are the same, byte for byte.                                                                                                                                                                                              |

### E8.3 Add to the kit

- **Actor:** agent.
- **Need:** a piece of screen that the kit does not have is made one time, and each agent then
  uses the same one.
- **Trigger:** the agent needs a piece that is not in the kit, or a viewer asks for a change to a
  piece that many frames use.
- **Success end:** the piece is in the kit, and each frame that uses it shows the same piece.
- **Failure end:** another agent changed the piece first. Nothing is written. The agent gets the
  newest piece, and makes its change on it.

| ID  | Requirement                                                              | Fit criterion                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K12 | An agent adds a piece to the kit one time, and each agent then uses it.  | After one agent adds a pricing card, a second agent makes a frame with that card, in the same look, and does not copy it.                                                                           |
| K13 | A change to a piece of the kit reaches each frame that uses it.          | After a change to the button, each live document shows the new button within 1 second, and each other frame in view within 10 seconds on a canvas with 20 frames in view. No agent changed a frame. |
| K14 | A change to the kit made on an old piece does not remove a newer change. | When two agents change one piece at the same time, the second is refused and told. No change is lost (as B6).                                                                                       |

### E8 walk of the slice

On 2026-11-21, E8 was read from left to right as a team lead: get the easel, connect an agent, see
the first frame in the look of easel, set the brand, see each frame change, ask for a change to the
buttons, see each frame change, get an update of easel. Then it was read as an agent: learn the
kit, make a frame, be told of a color outside the look, add a missing piece, change a piece that
another agent changed first. The walk added K10 (the Before of a result after a change of the
look) and K11 (an update of easel).

#### Design changes that E8 needs

| Req.    | Gap in the design now                                                                              | Spec                 |
| ------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| K1–K14  | No spec holds the look and the kit of a team.                                                      | a new module spec    |
| K2      | The CLI help and the agent guide do not name a kit.                                                | SPEC-cli, SPEC-mcp   |
| K7, K13 | A frame is one document that holds all that it shows. Nothing in it changes when the look changes. | SPEC-frames          |
| K10     | Easel keeps old versions of a frame, but not the look that a frame had at that version.            | SPEC-frames          |
| K6      | The speed measures in `docs/canvas-speed.md` do not cover a frame that uses the kit.               | docs/canvas-speed.md |

The specs close each gap: [kit](../SPEC-kit.md) (K1 to K14), the kit commands and tools in
[cli](../SPEC-cli.md) and [mcp](../SPEC-mcp.md) (K2), made CSS and kit versions in picture
addresses in [frames](../SPEC-frames.md) (K7, K10, K13), the kit version of a request in
[queue](../SPEC-queue.md) (K10), and section 18 of [canvas-speed](canvas-speed.md) (K6).

## E9: One voice

The kit governs how the frames of a team look (E8). The words in the frames need the same: each
agent writes its own words, so two frames name one action in two ways, and a change of a name
means a change to each frame. So each easel keeps the words of the team in one place, next to the
look, and each agent makes its frames from them. The same place is where a person of the team
reviews the words, and, later, where they are translated.

| ID   | Journey                          | Actor  | Design        | Review |
| ---- | -------------------------------- | ------ | ------------- | ------ |
| E9.1 | Make a frame in the team's words | agent  | not specified | to do  |
| E9.2 | Change the words                 | user   | not specified | to do  |
| E9.3 | Review the words                 | person | not specified | to do  |

Decided:

- On 2026-11-22, the user asked for the kit to govern the words and the look at the same time:
  "centralized copy later can be reviewed and translated for i18n".
- One set of words for each easel, as one look (E8).
- The words come after E8's app frames ([frame-apps](decisions/frame-apps.md)): text that is only
  in fixed places of a frame is what makes the words of a frame possible to find and to check.
- Prior art for the need: Ditto and Frontitude (the words of a product in one place, shared by
  design and code, each with a name), the content guides of GOV.UK and Shopify Polaris (the rules
  of the words are part of the design system), and Vale (a check of written rules: banned terms,
  capitals).
- On 2026-11-23, the user set the smallest form for Round 1: "same text should be in same place,
  driven by key and will be sufficient to derive the i18n". Round 1 takes L1, L3, L5 and L12.
- Deferred: a second language for the team. Add it when a team asks for its frames in a second
  language. L12 keeps it possible with no change to a frame.
- Deferred: rules of tone beyond a list of terms (for example "no passive voice"). Add it when a
  team writes a voice rule that a list of terms cannot hold.
- Deferred: take the words from a design file or a strings file. Add it when the words of a team
  take more than 10 minutes to set.

### E9.1 Make a frame in the team's words

- **Actor:** agent.
- **Need:** write the text of a frame fast, in the words of the team, so that the frames of all
  agents say one thing in one way.
- **Trigger:** the agent has a screen to show.
- **Success end:** the frame shows on the canvas, and each text in it comes from the words of the
  team.
- **Failure end:** the frame has a text that is not in the words of the team, or that breaks a
  rule of the team. The agent knows at once where and how to fix it.

| ID  | Requirement                                                                | Fit criterion                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | The frames of several agents use the same words for the same thing.        | On a canvas of 10 frames from 3 agents, a person finds no action or thing that has two different names.                                                                                                                                                  |
| L2  | The agent knows at once when a text does not follow the words of the team. | A frame with a visible text that is not in the words of the team, a term that the team banned, or a term in a form that the team does not use (its capitals), is found when the agent writes it. The agent is told the line, what is there, and the fix. |
| L3  | A new text is added one time, and each agent then uses it.                 | After one agent adds "Start free trial", a second agent makes a frame with that action and uses the same text, with no new one.                                                                                                                          |
| L12 | Each text has a key, so a second language needs no change to a frame.      | From the list of keys and texts only, a person gives a text in a second language for each key. Each frame then shows that language, and no frame changed.                                                                                                |
| L4  | The words do not make a frame slower to make.                              | With the reference agent and the 3 reference screens of K3, the median time to write a frame is at most 10% more than with the kit alone.                                                                                                                |

### E9.2 Change the words

- **Actor:** user (an agent or a person of the team).
- **Need:** change a name or a text in all frames with one change, and lose nothing that people
  saw before.
- **Trigger:** the team renames a thing, or a viewer asks for a change of words (E4).
- **Success end:** each frame of the easel shows the new words, and no agent changed a frame.
- **Failure end:** another user changed the same text first. Nothing is written, and the user gets
  the newest text.

| ID  | Requirement                                                              | Fit criterion                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L5  | One change of a text reaches each frame.                                 | After one change of a text, each live document in each open tab shows the new text within 1 second, with no reload. Each other frame in view shows it within 10 seconds on a canvas with 20 frames in view. No agent changed a frame. |
| L6  | The user can go back to the words before.                                | One step gives each frame the words that it had before the last change. The step is a change too, so a second step gives the words back.                                                                                              |
| L7  | A change of the words does not change what a viewer saw when they asked. | After the change, the Before of each result, and the When asked picture of each request, show the frame with the words that the viewer saw (E4).                                                                                      |
| L8  | A change made on an old text does not remove a newer change.             | When two users change one text at the same time, the second is refused and told. No change is lost (as K14).                                                                                                                          |

### E9.3 Review the words

- **Actor:** person of the team (a writer, a reviewer, or the team lead).
- **Need:** read and correct all the words of the product in one place, for example before a
  release or a translation.
- **Trigger:** the team prepares a release, a translation, or a change of its voice.
- **Success end:** the person has read each text, has seen where each is used, and has changed
  the texts that were wrong (E9.2).
- **Failure end:** a text is used in no frame. The person sees it, and can remove it.

| ID  | Requirement                                           | Fit criterion                                                                                                   |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| L9  | A person sees all the words of the team in one place. | A person of the team, with easel only, sees each visible text of each frame in one place, with no text missing. |
| L10 | A person sees where a text is used.                   | For a text there, the person opens each frame that shows it within 1 minute.                                    |
| L11 | A person sees the texts that no frame uses.           | A text that no frame shows is marked as not used where the person reviews the words.                            |

### E9 walk of the slice

On 2026-11-22, E9 was read as a team lead: get the easel, see the first frames in the words of the
seed, set the name of the product and the names of its main actions, see each frame change, ask a
writer to review all the words, rename one action, see each frame change, open an old request and
see the words that the viewer saw. Then it was read as an agent: make a frame, be told of a text
that is not in the words of the team, add a new text, change a text that another user changed
first. The walk added L4 (the words must not make frames slow to make, or agents work around
them), L7 (the Before of a result after a change of the words) and L11 (texts that no frame uses,
which a review must find before a translation).

#### Design changes that E9 needs

| Req.   | Gap in the design now                                                          | Spec                  |
| ------ | ------------------------------------------------------------------------------ | --------------------- |
| L1–L11 | No spec keeps the words of a team.                                             | SPEC-kit              |
| L2     | The kit check reads the classes of a frame, not its visible text.              | SPEC-kit              |
| L5     | The port of a live document carries a new look only.                           | SPEC-viewer           |
| L7     | A request and a result keep the kit version that the viewer saw, but no words. | SPEC-queue            |
| L9–L11 | No page or command shows the words of a team.                                  | SPEC-viewer, SPEC-cli |

## E10: See each state of a frame

A frame shows one state at a time: one data set, one language, one mode. A review needs each
state, and a person must not ask an agent for each one. So a frame comes with its controls, and a
person changes the state of the frame with them, in place.

| ID    | Journey                     | Actor  | Design                                                                                         | Review |
| ----- | --------------------------- | ------ | ---------------------------------------------------------------------------------------------- | ------ |
| E10.1 | Change the state of a frame | viewer | [kit](../SPEC-kit.md#the-capsules): "The controls in the viewer", "A control in its own scope" | to do  |

Decided:

- On 2026-11-22 and 2026-11-23, the user asked for the controls, their places (above the frame,
  at its sides, in a panel), and controls that are full React components with state and icons.
- Prior art: the controls and the toolbars of Storybook (a person changes the state of a component
  beside it), and the variants of Figma.
- Deferred: see Round 1 for a control for all frames at one time.

### E10.1 Change the state of a frame

- **Actor:** viewer (also a user who reviews).
- **Need:** see the frame in each state of its design, with no agent, to review it.
- **Trigger:** the viewer reviews a frame.
- **Success end:** the viewer saw each state that the frame offers.
- **Failure end:** a state does not show. The viewer sees why, and the frame stays as it was.

| ID  | Requirement                                                 | Fit criterion                                                                                                                                    |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| X1  | The viewer sees each state of a frame with no agent.        | On a frame with controls, the viewer gets to each state that it offers in 2 clicks or fewer. The frame shows it within 1 second, with no reload. |
| X2  | A control shows the state that the frame has now.           | After the frame changes by itself, its controls show the new state within 1 second.                                                              |
| X3  | A control can be a full tool, with its own state and icons. | A toolbar with a text field and buttons with icons works beside the frame as it does in a frame.                                                 |
| X4  | A control does only what the frame lets it do.              | A control changes the frame only by the actions that the frame offers. A change that the frame refuses changes nothing, and says why.            |
| X5  | The frame puts each control where it helps the review.      | Each control shows at the place that the frame gives it (above the frame, at one side, or in the panel), at the same size at each zoom.          |
