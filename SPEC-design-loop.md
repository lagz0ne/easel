# Spec delta: `design-loop`, easel designs itself in easel

Status: approved (user, 2026-11-24: "Approved"), with `design-system` and `product`, at most 2 agents at the same time and 20 in a day, and the hub request hq-aob.

## Objective

The user, 2026-11-24: "We then need to create a loop on design easel itself, so we have screens
for easel, design system for easel and we can do continuous design and feedback".

This is the end goal of Round 1 (the user, 2026-11-23): move the design from Doop to easel, and
develop it further in easel. After this delta, the team does all design work for easel in easel.
Doop is not necessary for easel any more.

The loop has four steps, and each step happens in easel:

1. A person or an agent proposes a design: a frame on a canvas of easel.
2. A person gives feedback: a request on the frame.
3. An agent takes the request, changes the design or the code, and ships it.
4. The board shows what shipped beside what was proposed, and a check proves that they agree.

Prior art:

- **Storybook with Chromatic.** Each component and each state is a story of the real code. A
  review shows each change as a picture beside the last one, and a person approves it or comments.
- **Figma Dev Mode with Code Connect.** A design component links to its code, so the design and
  the code do not drift.
- **Linear feedback.** A comment becomes an issue that a person or an agent takes, and it closes
  when the change ships.

## Current behavior

- The canvas `design-system` has the 31 frames of the Doop library, at their Doop places, all in
  exploring (SPEC-pages, criterion 1). They are HTML copies. The viewer does not use them: its own
  controls are in `src/design` and `src/viewer`.
- SPEC-design names the Doop canvases as the source of the design system and of the screens.
- The screens of easel (Read me, E3, E4, E8) are only on the Doop canvas `easel · Product design`.
- `bun run design:proof` reads the Doop canvases.
- A request on a frame of easel goes to the queue. No agent claims the requests of easel's own
  canvases.
- Nothing shows the screens of easel as they are live.

## New behavior

### The canvases

1. The canvas `design-system` is the source of easel's design system. SPEC-design names it, not
   Doop.
2. A canvas `product` holds the screens of easel, one page for each epic (Read me, E3, E4, E8), at
   their places from Doop. The 3 open Doop comments become requests on it.
3. A page `Live` on `product` shows the screens of easel as they are live, as image frames
   (§ Images). After each deploy, a job opens easel on a fixed fixture canvas in a browser, takes
   each screen, and puts it again. Each screen of a proposal has its live screen with the same name, so a person sees both.
   The states, the sizes (phone 390×844, desktop 1440×900) and the themes (light, dark) are fixed,
   so two writes of the same build give the same pictures.

### The loop

4. The dispatcher of easel publishes each waiting request of `design-system` and `product` to
   NATS, as the hub's work queue uses it (the user, 2026-11-24: "Dispatcher in easel to push to an
   adapter on top of current paseo. Adapter will lead to spawning agent", then "We can use nats
   just like the work queue").
   - A new kind of channel, `nats`, names a subject. The dispatcher publishes one message for each
     waiting period of a request to `easel.requests.<canvas>`, in a JetStream stream with
     work-queue retention. The message holds the canvas, the number, the frame and the page of the
     request, not its text. The message id is the request and its period, so JetStream drops a
     repeat.
   - The NATS is the hub's own (`hub-nats`, JetStream). easel connects with its own nkey, `easel-dispatch`, which
     may only publish to `easel.requests.>`. The nkey seed is write-only, as the token of a GitHub
     channel.
   - A publish that fails is tried again as a GitHub delivery is (SPEC-queue § The dispatcher), and
     `easel deliveries` shows it. A channel can name canvases. It gets only the requests of those
     canvases.
5. **The Paseo adapter** is a small service on the machine, beside the Paseo daemon, with its own
   nkey that may only read `easel.requests.>`. It is a durable pull consumer of the stream. For
   each message, it starts an agent in the easel workspace with `paseo run`, then acks the message.
   The prompt of the agent names the canvas and the number of the request, and tells it to claim
   the request with `easel next`. So the claim, the lease and the result stay in easel.
   - The limit of agents at the same time is `max_ack_pending` of the consumer. A message over the
     limit waits in the stream.
   - A message that the adapter does not ack in time comes again (`ack_wait`). A request that no
     agent claims waits in easel, and its next waiting period publishes it again.
6. The agent changes the frame (a new version), or the code, or both. It resolves the request only
   when `/api/version` shows the build with the change.
7. A change of the code that changes a screen writes its live screen again. The request says
   which build has it.
8. A change of the design system (a value of the look, or a component) shows on each frame that
   uses it (SPEC-pieces, rule 18).

### Images

9. A frame can be an image (the user, 2026-11-24: "We should have image upload feature, can take
   screenshot and analyze"). `easel put <canvas> shot.png` makes an image frame from a PNG, JPEG
   or WebP file of 10 MB at most, at the size of the image. MCP `put_frame` takes an image too. A
   person can drop or paste an image on the board of a member.
10. A request can carry one screenshot: a person pastes it into the request, or picks a part of
    the board to take one. The screenshot stays with the request, as its text does.
11. An agent gets the image of an image frame, the screenshot of a request, and the picture of
    any frame as MCP image content (`get_frame`, `next_request`, `shot_frame`), so it can look at
    it and analyze it. easel itself runs no model on an image.
12. An image frame has versions, requests and pages as each other frame. A put of a new image is a
    new version.

### The proof

13. `bun run design:proof` reads the canvases of easel, not Doop. It prints OK only if each rule of
    its check holds: the contrast table, each screen of a proposal has its live screen, and no live
    screen uses a value that is not in the design system.

## Success criteria

1. **No Doop.** For one week of design work on easel, nobody opens Doop for easel. SPEC-design and
   `docs/design-canvas.md` name only the canvases of easel.
2. **The screens.** `product` has the pages Read me, E3, E4 and E8, with each frame of Doop at its
   place, and the 3 Doop comments as open requests.
3. **Live beside proposed.** After a deploy that changes the dock, the `Live` page shows the new
   dock in phone and desktop, light and dark, within 10 minutes of the deploy.
4. **One loop.** A person writes a request on a frame of `product` ("make the dock smaller on a
   phone"). An agent claims it, ships the change, and resolves it with the build number. The
   `Live` page shows the change. No step happens outside easel and the repository.
5. **The proof.** `bun run design:proof` prints OK against the canvases of easel, and it fails if
   a live screen uses a color that is not in the design system.
6. **The adapter.** A request on `product` starts a Paseo agent within 1 minute of the
   publish. A repeat of the same waiting period starts no second agent. With the limit at 2 and 3
   requests, the third agent starts only when one of the first two ends.
7. **An image.** `easel put product shot.png` makes an image frame. A person pastes a screenshot
   into a request. The agent that claims it gets both images and says what it sees in its result.

## Boundaries

- Always: a write to the live easel by the loop goes through the CLI or MCP as the member
  `vibea-claude`, not as an owner.
- Always: a frame that a person marked ready changes only through a request.
- Ask first: a change of the look of the design system (it changes each frame of the team).
- Ask first: the hours when the design agent runs, and its cost limit.
- Ask first: the hub work (a hub request): easel's container must reach `hub-nats`, which listens
  on loopback only today, and the two nkeys (`easel-dispatch`, `easel-paseo`) and the stream.
- Never: the loop deletes a frame or a canvas.
- Never: `hub-nats` is open to the internet. Only the docker network of the machine reaches it.

## Out of scope (deferred)

- **The design system as code capsules** (SPEC-pieces: `design/` capsules, brands, the typecheck
  on each put). This delta works with the HTML frames of today. Add it with `pieces`.
- **A prototype that runs the screens in order.** Add it with the flows of screens.
- **An approval step before a change of code** (a person approves a proposal first). Add it when
  a change ships that the user did not want.

## Decisions

1. **The design agent** (the user, 2026-11-24): the dispatcher publishes to the hub's NATS, as the
   work queue does, and a Paseo adapter consumes it and starts the agent (§ The loop, rules 4-5).
   A webhook was the other way. NATS needs no public address and no signature, and its acks and
   redelivery do the retries.
2. **The live screens** (the user, 2026-11-24): image frames, put by a job after each deploy
   (§ Images).

## Open questions

1. **The canvas names.** I recommend `design-system` (it exists) and `product`. Doop had
   `easel · Design system` and `easel · Product design`.
2. **The limits of the design agents.** I recommend at most 2 at the same time
   (`max_ack_pending`) and at most 20 in a day. A message over a limit waits in the stream.
