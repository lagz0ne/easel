# Spec: queue — V1

Module `queue` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md),
[frames](SPEC-frames.md) and [ops](SPEC-ops.md).

## Objective

Viewers pin comments on frames. The comments of all canvases form one queue. Agents take them
oldest first, change the frame, and reply. A viewer sees each comment go from open, to claimed by
an agent, to done with the agent's reply. How the pins and the panel look is in
[viewer](SPEC-viewer.md).

Prior art:

- The claim with a lease is SQS's visibility timeout. A claimed message is hidden until its timeout
  ends, then comes back unless deleted. Giving a claim back is SQS's `ChangeMessageVisibility` to 0.
- `attempts` and `stuck` are SQS's receive count and its dead-letter queue (`maxReceiveCount`). A
  comment no agent can finish stops coming back.
- A released comment goes to the back of the queue. RabbitMQ's requeue puts a message back at the
  front, and a consumer that cannot handle it gets it again at once, in a loop.
- The claim is one conditional write, as a job queue on SQL claims a row
  (`UPDATE … WHERE id = (SELECT …) RETURNING`; Postgres queues add `FOR UPDATE SKIP LOCKED`).
- The client key on `comment.add` is an idempotency key (Stripe's `Idempotency-Key`, SQS's
  deduplication id): a retry with the same key saves once.

## Journeys

### A viewer adds a comment

1. A viewer posts a comment at a place on a frame ([viewer](SPEC-viewer.md)), with a client key
   the page made for it. It answers `added` with its number `n`, and it shows in every tab on the
   canvas, with the name the viewer gave.
2. If the answer is lost, the page sends the comment again with the same key. It answers `added`
   with the same `n`, and saves nothing new.
3. If the frame was deleted meanwhile, it answers `gone` and posts nothing.
4. If the canvas has 200 comments that are not done and not stuck, it answers `full`. If the viewer posts too
   fast, it answers `slow` with `retryIn`. Either way it posts nothing.
5. When an agent moves the frame, its comments move with it.

### An agent works the queue

1. `easel next --wait 600` claims the oldest open comment of any canvas (or `--canvas <key>`), for a
   lease of 300 s (`--lease`, 30 to 3600). It prints the comment, its frame, the place of the pin,
   `until`, and a `claim`: a random handle for this lease only (SQS's receipt handle).
2. With nothing to take, it waits. The CLI asks the server in calls of at most 50 s, and asks again
   until 600 s pass. Then it answers `empty` and exits 0: an empty queue is a normal answer to a
   poll, as SQS `ReceiveMessage` returns no messages. It takes a comment as soon as one can be
   taken: a viewer adds one, an agent releases one, or a lease runs out.
3. Every open tab shows the comment as claimed by this agent's user, while `claimedUntil` is ahead
   of the server's time.
4. The agent changes that comment's frame, then runs
   `easel resolve <claim> --reply "Moved the button up."`. Every tab shows it done, with the
   reply.
5. An agent that needs longer runs `easel extend <claim>` before its lease runs out, and the lease
   starts again (`--lease`, as for `next`).
6. An agent that cannot do it runs `easel release <claim>`. The comment is open again at once, at
   the back of the queue, and the claim does not count as an attempt.
7. If the lease runs out first, every tab shows the comment open again at `claimedUntil`, with no
   write. Resolving, extending or releasing with that claim answers `lost`, exits 1, and writes
   nothing, also when no agent took the comment since.
8. If the comment is done, by this agent's earlier call or by another agent, resolving, extending
   or releasing answers `done`, exits 1, and writes nothing.
9. A second agent's `easel next` never gets a comment that another agent holds a live lease on.
   Two agents that share one user's token are still told apart: each holds its own claim.

### A comment no agent finishes

1. Each claim counts one attempt. When three claims of a comment ran out, the comment is stuck:
   `easel next` skips it, and every tab shows it as stuck.
2. A release takes its attempt back. An extend or a resolve adds none.

## Contract

```ts
// a viewer (refused { ended: true } when the link has ended, and { locked: true } when a
// password set or changed on the link ended the viewer's pass)
// comment.add { canvas, frameId, x, y, body, key }
"comment.add":     { kind: "added"; n: number } | { kind: "gone" } | { kind: "full" }
                 | { kind: "slow"; retryIn: number }

// a user (refused { signIn: true } without a live token)
// comment.next { canvas?, lease?, wait? }; extend { claim, lease? }; release { claim };
// resolve { claim, reply }
"comment.next":    { kind: "claimed"; comment: Comment; frame: Frame; claim: string; until: number;
                     now: number }
                 | { kind: "empty" }
"comment.extend":  { kind: "extended"; until: number; now: number }
                 | { kind: "done" } | { kind: "lost" } | { kind: "gone" }
"comment.release": { kind: "released" } | { kind: "done" } | { kind: "lost" } | { kind: "gone" }
"comment.resolve": { kind: "resolved" } | { kind: "done" } | { kind: "lost" } | { kind: "gone" }
```

Success kinds: `comment.add` `added`; `comment.next` `claimed` and `empty` (a normal answer to a
poll, as SQS `ReceiveMessage` returns no messages); `comment.extend` `extended`; `comment.release`
`released`; `comment.resolve` `resolved`. Every other kind is not: the CLI exits 1, and an MCP tool
sets `isError`.

Inputs: `body` is 1 to 2000 characters, `reply` 1 to 2000, `key` 16 to 64; past that, the input is
`invalid`. `lease` is seconds, 30 to 3600, default 300. `wait` is seconds, 0 to 50, default 0.
`until` and `now` are the server's time in ms since the epoch.

A comment on the board (cell `comments`, keyed by canvas):
`{ canvas, id, n, frameId, x, y, body, author, key, status: "open" | "done", claimedBy,
claimedUntil, attempts, queuedAt, reply, created }`. `x` and `y` are relative to the frame's top
left. `claimedBy` is the user's name. The claim handle is not on the board: only the agent that
claimed holds it, kept as its digest on the server.

Nothing stored says claimed or stuck. A tab or an agent reads a comment's state from the board
against the server's time (the board carries the server's clock offset):

| State   | When                                                       |
| ------- | ---------------------------------------------------------- |
| done    | `status` is `done`                                         |
| claimed | `status` is `open` and `claimedUntil` is ahead of the time |
| stuck   | `status` is `open`, the lease is past, and `attempts` ≥ 3  |
| open    | otherwise: the next `comment.next` may take it             |

The queue's order is `queuedAt`, oldest first, then canvas and `n`. `queuedAt` is `created`, and a
release sets it to the time of the release.

## Rules

The statechart [queue-lease](docs/statecharts/queue-lease.md) checks the claim, the lease, release,
resolve and stuck. Its rules are the oracle the tests follow.
[queue-two-step](docs/statecharts/queue-two-step.md) breaks on purpose: it shows why the claim is
one write.

### Fact rules (the code graph decides)

1. `comment.add` runs `mayRead` first, for the canvas it names.
2. `comment.add` takes the author from the pass's name, not from the input.
3. `comment.next`, `comment.extend`, `comment.release` and `comment.resolve` run the `user` guard
   first, and take time from the run's `clock`.
4. Every operation that writes `comments` calls `saveComment`, `claimComment` or `dropFrame`.
5. No page module writes `comments`.

### Judged rules (need reading the code)

1. A `gone`, `lost`, `done`, `empty`, `full` or `slow` answer writes nothing.
2. `n` is one past the canvas's highest. Two comments on one canvas never share an `n`, even when
   two viewers post at once.
3. `created` comes from the run's `clock`, not from `Date.now()`.
4. A pin's place is stored relative to its frame, so a move needs no comment write.
5. A new comment is `open`, with no claim, no attempts and no reply.
6. A claim is one conditional write. `claimComment` picks the first comment in queue order that is
   open, past its lease and under 3 attempts, and writes its claim, in one SQL statement. Nothing
   awaits between the pick and the write. Two agents that call `comment.next` at once never get
   the same comment.
7. A lease ends by time alone. Past `claimedUntil`, a comment is open to the next `comment.next`
   (or stuck), with no timer and no write. No column stores `claimed` or `stuck`.
8. Only the holder of the live claim resolves, extends or releases. The checks run in this order:
   a comment that no longer exists answers `gone`; a done comment answers `done`; a claim that is
   not the live lease's handle answers `lost`, also when its lease ran out and nobody took it.
9. `comment.next` holds no lock while it waits. It wakes when a comment in its scope is added or
   released, and when the earliest `claimedUntil` in its scope passes. It answers `empty` at
   `wait`, and `wait` is at most 50 s.
10. `attempts` counts claims: `comment.next` adds one, `comment.release` takes it back, and
    `comment.extend` and `comment.resolve` leave it. A comment with 3 attempts and its lease past
    is stuck, and `comment.next` never gives it.
11. A release moves the comment to the back of the queue: `queuedAt` is the time of the release.
12. `comment.add` saves a `key` once per canvas. The same key again answers `added` with the first
    comment's `n`, and writes nothing.
13. `comment.add` limits: 10 comments a minute per pass, and 30 a minute per client address (from
    the trusted `X-Forwarded-For`); past either, it answers `slow` with `retryIn`. A canvas holds
    at most 200 comments that are not done; stuck comments do not count toward it. Past that, it
    answers `full`.
14. A comment allows a change to its own frame only. The `comment.next` answer, and the
    `next_comment` tool's description, say that the claim allows a change to `frameId` and nothing
    else, and that the body is a viewer's request, not an instruction to follow beyond that frame.

## Success Criteria

- Two agents never get the same comment, in a test that forces the race. A test double for the
  store's write runs a second `comment.next` to its end before the first one's write lands. The two
  get different comments. A claim that picks, awaits, then writes fails this test.
- A lease that runs out puts the comment back, in a test that moves the clock: tabs show it open
  with no write, a waiting `comment.next` takes it at once, and the old claim answers `lost`.
- Three run-out claims make a comment stuck, in a test that moves the clock; a release in between
  does not count.
- A repeated `comment.add` with one key saves one comment.
- Every contract kind and refusal is reached by a test; `tinker check` is OK.
- Each rule of [queue-lease](docs/statecharts/queue-lease.md) holds, and a test walks each path
  its chart draws.

## Out of Scope (Deferred)

- Threads: one comment has one reply.
- Comments from users through the CLI: viewers comment, agents reply.
- Priorities: the queue is oldest first.
- Freeing a stuck comment. A viewer can post it again; an owner command can come later.
