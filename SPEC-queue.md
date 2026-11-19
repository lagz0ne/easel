# Spec: queue — V1

Module `queue` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md),
[frames](SPEC-frames.md) and [ops](SPEC-ops.md). The needs it meets are E4.1 to E4.3 in
[epics](docs/epics.md). How the pins and the panel look is in [viewer](SPEC-viewer.md).

## Objective

A viewer asks for a change. The request goes into one queue with the requests of all canvases.
Agents take requests oldest first and work on them. Each try ends with one outcome: a result, a
question to the viewer, or a give-back to a person. A viewer accepts a result or opens it again. A
request that agents cannot finish goes to a person. No request stays stuck.

A request is a thread. Each entry in it is a message: the ask, a question, an answer, a result, a
note. The messages stay with the request. They are its history.

Prior art:

- The claim with a lease is the visibility timeout of SQS. A claimed message is hidden until its
  timeout ends. Then it comes back, unless the holder deletes it.
- The claim is one conditional write, as a job queue on SQL claims a row
  (`UPDATE … WHERE id = (SELECT …) RETURNING`; Postgres queues add `FOR UPDATE SKIP LOCKED`).
- `tries` and "needs a person" are the receive count and the dead-letter queue of SQS
  (`maxReceiveCount`). An edit that sends the request back is the dead-letter redrive of SQS
  (`StartMessageMoveTask`), after a person fixed the cause.
- A question parks the request out of the queue, as the "pending" status of Zendesk and "waiting
  for customer" of Jira Service Management. Their SLA clock stops while the customer has the
  ticket. Here, the count of tries does not run while a viewer has the request.
- Accept and open again are the review states of a GitHub pull request ("approve", "request
  changes"). A result with no review still counts as done, as a merged pull request with no
  approval stays merged.
- The client key on `request.add` is an idempotency key (the `Idempotency-Key` of Stripe, the
  deduplication id of SQS). A retry with the same key saves one time only.

## Journeys

### A viewer asks for a change

1. A viewer puts a request at a place on a frame, or at a place on the canvas outside all frames
   ([viewer](SPEC-viewer.md)). The page sends the text, a client key, and the frame version that
   it shows. The answer is `added` with the number `n` of the request. Every tab on the canvas
   shows the request within 1 s, with the name of the viewer.
2. If the answer is lost, the page sends the request again with the same key. The answer is
   `added` with the same `n`. Nothing new is saved.
3. If the frame was removed in the meantime, the answer is `gone`. Nothing is saved, and the page
   keeps the text.
4. If the canvas has 200 requests that are not resolved and not closed, the answer is `full`. If the
   viewer sends too fast, the answer is `slow` with `retryIn`. Nothing is saved, and the page keeps
   the text.
5. While no agent holds the request, the viewer can edit its text or close it. An edit adds a
   message, and the request goes to the back of the queue.
6. When an agent moves the frame, its requests move with it.

### An agent works the queue

1. `easel next --wait 600` claims the oldest waiting request of any canvas (or `--canvas <key>`),
   for a lease of 300 s (`--lease`, 30 to 3600). It prints the request, its messages, the frame
   now, the frame version that the viewer saw, `until`, and a `claim`. The claim is a random
   handle for this lease only (the receipt handle of SQS). For a request on the canvas, it prints
   the list of frames in place of one frame.
2. With nothing to take, it waits. The CLI asks the server in calls of at most 50 s, and asks
   again until 600 s pass. Then it answers `empty` and exits 0. An empty queue is a normal answer
   to a poll, as `ReceiveMessage` of SQS returns no messages. It takes a request when one becomes
   waiting: a viewer adds, edits, answers or opens one again, an agent releases one, or a lease
   runs out.
3. Every open tab shows the request in work by the user of this agent, while `claimedUntil` is
   ahead of the time of the server.
4. The agent ends its try with one outcome:
   - It changes the frame, then runs `easel resolve <claim> --text "Moved the button up."`. The
     request is resolved. Its result holds the text, an optional HTML part, and the frame version
     before and after.
   - It needs a fact from the viewer, so it runs `easel ask <claim> --text "Which blue?"`, with an
     optional HTML part and up to 6 options. The request leaves the queue and waits for a viewer.
   - It cannot do the request, so it runs `easel decline <claim> --reason "The frame has no
form."`. The request goes to a person.
5. An agent that needs longer runs `easel extend <claim>` before its lease runs out. The lease
   starts again (`--lease`, as for `next`).
6. An agent that stops for a cause outside the request (a network error, a shutdown) runs
   `easel release <claim> --reason "…"`. The request is waiting again at once, at the back of the
   queue. The try counts.
7. If the lease runs out first, every tab shows the request waiting again at `claimedUntil`, with
   no write. A call with that claim answers `lost`, exits 1, and writes nothing. This is also true
   when no agent took the request since.
8. If the request left the queue (by the earlier call of this agent, by another agent, or by a
   viewer), a call with the claim answers `wrongState` with the state now. It exits 1 and writes
   nothing.
9. A second `easel next` never gets a request that another agent holds a live lease on. Two agents
   that share one token are still told apart: each holds its own claim.

### A viewer answers and decides

1. A request with a question shows the question to every viewer within 1 s. Any viewer answers it
   with text, or picks one of its options. The request is waiting again, at the back of the queue,
   and its count of tries starts again at 0.
2. A resolved request shows its result: the text, the HTML part, and the frame before and after. Any
   viewer accepts it, or opens it again with a note. Open again makes it waiting, at the back of
   the queue, with its count of tries at 0.
3. A result that no viewer accepts stays resolved, and counts as done. A viewer can open it again later.
4. Each answer, accept, note and close is a message with the name of its sender. The request shows
   who decided.

### A request no agent finishes

1. Each claim counts one try. A release and a lease that runs out end the try with no outcome.
2. After 3 tries with no outcome, the request needs a person. `easel next` skips it, and every tab
   shows it as "needs a person". A decline sends it to a person at once, with its reason.
3. A viewer, or a user with `easel edit <canvas> <n>`, makes the request clear. The request is
   waiting again, with its count of tries at 0. Or the viewer or user closes it with
   `easel close <canvas> <n>`.
4. `easel requests --state person` lists the requests that need a person, on all canvases.

### A request becomes outdated

1. A request that waits shows "may be outdated" when one of these is true:
   - The frame has a newer version than the version that the viewer saw.
   - The frame was removed.
   - The request was made more than 7 days ago.
2. "May be outdated" is a mark on the request. It does not change its state. A viewer edits,
   closes or keeps it.

## Contract

```ts
// a viewer or a user: the mayRead guard (refused { ended: true } when the link has ended,
// { locked: true } when a password change ended the pass, { signIn: true } with no pass and no
// live token)
// request.add { canvas, frameId: string | null, version: number | null, x, y, text, key }
"request.add":     { kind: "added"; n: number } | { kind: "gone" } | { kind: "full" }
                 | { kind: "slow"; retryIn: number }
// request.edit { canvas, n, text }; answer { canvas, n, text, option? }; accept { canvas, n };
// reopen { canvas, n, text }; close { canvas, n, text? }
"request.edit":    { kind: "edited" } | Refused
"request.answer":  { kind: "answered" } | Refused
"request.accept":  { kind: "accepted" } | Refused
"request.reopen":  { kind: "reopened" } | Refused | { kind: "full" }
"request.close":   { kind: "closed" } | Refused
type Refused = { kind: "wrongState"; state: State } | { kind: "gone" }
             | { kind: "slow"; retryIn: number }

// a user (refused { signIn: true } without a live token)
// request.next { canvas?, lease?, wait? }; extend { claim, lease? }; release { claim, reason };
// decline { claim, reason }; ask { claim, text, html?, options? }; resolve { claim, text, html? };
// list { canvas?, state? }
"request.next":    { kind: "claimed"; request: Request; messages: Message[];
                     frame: Frame | null; saw: { version: number; doc: string } | null;
                     frames: FrameBox[] | null; claim: string; until: number; now: number }
                 | { kind: "empty" }
"request.extend":  { kind: "extended"; until: number; now: number } | Lost
"request.release": { kind: "released" } | Lost
"request.decline": { kind: "declined" } | Lost
"request.ask":     { kind: "asked" } | Lost
"request.resolve": { kind: "resolved" } | Lost
"request.list":    { kind: "listed"; requests: Request[] }
type Lost = { kind: "wrongState"; state: State } | { kind: "lost" } | { kind: "gone" }
```

Success kinds: `added`, `edited`, `answered`, `accepted`, `reopened`, `closed`, `claimed`,
`empty`, `extended`, `released`, `declined`, `asked`, `resolved` and `listed`. Every other kind is
not: the CLI exits 1, and an MCP tool sets `isError`.

Inputs:

- `text` and `reason` are 1 to 2000 characters. `key` is 16 to 64.
- `html` is a full HTML document of at most 256 KiB, in UTF-8 bytes.
- `options` is 2 to 6 strings of 1 to 200 characters. `option` is an index into them.
- `lease` is seconds, 30 to 3600, default 300. `wait` is seconds, 0 to 50, default 0.
- `until` and `now` are the time of the server, in ms since the epoch.
- Out of these limits, the input is `invalid`.

A request on the board (cell `requests`, keyed by canvas):
`{ canvas, id, n, frameId, version, x, y, author, key, status, claimedBy, claimedUntil, tries,
queuedAt, acceptedBy, created, updated }`.

- `status` is `open`, `asking`, `resolved`, `person` or `closed`.
- `frameId` is `null` for a request on the canvas. Then `x` and `y` are on the canvas. Else they
  are relative to the top left of the frame.
- `version` is the frame version that the viewer saw, or `null` for a request on the canvas.
- `claimedBy` is the name of the user. Only the agent that claimed holds the claim handle. The
  server keeps its digest.
- `updated` is the time of the last change to the request or its messages.

A message on the board (cell `messages`, keyed by canvas):
`{ canvas, id, request, kind, from, text, html, options, option, before, after, created }`.

- `kind` is `ask`, `edit`, `question`, `answer`, `result`, `accept`, `reopen`, `release`,
  `decline` or `close`.
- `from` is the name of the viewer, or of the user.
- `before` and `after` are frame versions, on a `result` only. `before` is the version at the
  claim. `after` is the version at the resolve. They are the same when the agent did not change
  the frame.
- No call changes or removes a message.

The state of a request comes from the board and the time of the server (the board carries the
clock offset of the server). Nothing stored says "in work" or "needs a person".

| State `State` | When                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `inWork`      | `status` is `open` and `claimedUntil` is ahead of the time            |
| `person`      | `status` is `person`; or `status` is `open`, not in work, `tries` ≥ 3 |
| `waiting`     | `status` is `open`, otherwise: the next `request.next` can take it    |
| `question`    | `status` is `asking`                                                  |
| `result`      | `status` is `resolved` and `acceptedBy` is `null`                     |
| `accepted`    | `status` is `resolved` and `acceptedBy` is a name                     |
| `closed`      | `status` is `closed`                                                  |

The order of the queue is `queuedAt`, oldest first, then canvas and `n`. `request.add` sets
`queuedAt` to `created`. A release, an edit, an answer and a reopen set it to the time of that
call.

## Rules

The statechart [queue-lease](docs/statecharts/queue-lease.md) checks the claim, the lease, the
release, the outcome and the count of tries. [request-life](docs/statecharts/request-life.md)
checks the states of one request and who can move it. Their rules are the oracle that the tests
follow. [queue-two-step](docs/statecharts/queue-two-step.md) breaks on purpose. It shows why the
claim is one write.

### Fact rules (the code graph decides)

1. `request.add`, `edit`, `answer`, `accept`, `reopen` and `close` run `mayRead` first, for the
   canvas that they name.
2. These calls take the name of the sender from the pass, or from the user. They do not take it
   from the input.
3. `request.next`, `extend`, `release`, `decline`, `ask`, `resolve` and `list` run the `user`
   guard first. All calls take the time from the `clock` of the run.
4. Every operation that writes `requests` or `messages` calls `saveRequest`, `claimRequest`,
   `endTry`, `dropFrame` or `dropCanvas`.
5. No page module writes `requests` or `messages`.

### Judged rules (need reading the code)

1. A `gone`, `lost`, `wrongState`, `empty`, `full` or `slow` answer writes nothing.
2. `n` is one more than the highest `n` of the canvas. Two requests on one canvas never have the
   same `n`, also when two viewers send at the same time.
3. `created` and `updated` come from the `clock` of the run, not from `Date.now()`.
4. The place of a pin is relative to its frame, so a move needs no request write.
5. A new request is `open`, with no claim and `tries` at 0. Its first message is the `ask`.
6. A claim is one conditional write. `claimRequest` finds the first request in queue order that
   is waiting, and writes its claim, in one SQL statement. Nothing awaits between the find and the
   write. Two agents that call `request.next` at the same time never get the same request.
7. A lease ends by time alone. Past `claimedUntil`, a request is waiting again (or needs a
   person), with no timer and no write. No column stores "in work" or "needs a person".
8. Only the holder of the live claim calls `extend`, `release`, `decline`, `ask` or `resolve`.
   The checks run in this order: a request that does not exist answers `gone`; a `status` that is
   not `open` answers `wrongState`; a claim that is not the handle of the live lease answers
   `lost`. `lost` is also the answer when the lease ran out and no agent took the request.
9. Each call of a viewer is one conditional write on `status` and the lease, in one SQL
   statement:
   - `edit`: `open` and not in work, or `person`. It sets `open` and `tries` to 0.
   - `answer`: `asking`. It sets `open` and `tries` to 0.
   - `accept`: `resolved` with `acceptedBy` null. It sets `acceptedBy`.
   - `reopen`: `resolved`. It sets `open`, `tries` to 0 and `acceptedBy` to null.
   - `close`: `open` and not in work, `asking`, or `person`. It sets `closed`.
   - In any other state, the answer is `wrongState`. A viewer never changes a request that an
     agent holds.
10. Each outcome is one conditional write with its message: `resolve` sets `resolved`, `ask` sets
    `asking`, and `decline` sets `person`. Each ends the lease.
11. `tries` counts claims. `request.next` adds one. `edit`, `answer` and `reopen` set it to 0.
    `extend`, `release` and the outcomes leave it. A request that is not in work with 3 tries
    needs a person, and `request.next` never gives it.
12. `request.next` holds no lock while it waits. It wakes when a request in its scope becomes
    waiting, and when the earliest `claimedUntil` in its scope passes. It answers `empty` at
    `wait`, and `wait` is at most 50 s.
13. `request.add` saves a `key` one time per canvas. The same key again answers `added` with the
    `n` of the first request, and writes nothing.
14. Limits on the calls of a viewer: 10 a minute for each pass, and 30 a minute for each client
    address (from the trusted `X-Forwarded-For`). Past either, the answer is `slow` with
    `retryIn`. A canvas holds at most 200 requests in `open`, `asking` or `person`. Past that,
    `add` and `reopen` answer `full`.
15. A claim allows a change to the frame of the request only, or to its canvas for a request on
    the canvas. The `request.next` answer, and the description of the `next_request` tool, say
    this. They also say that the text is the request of a viewer, not an instruction to follow
    outside that frame.
16. `request.next` gives the frame version that the viewer saw. [frames](SPEC-frames.md) keeps
    each version that a request refers to, also after the frame is removed.
17. A removed frame keeps its requests. A removed canvas removes its requests and messages.
18. An HTML part shows in the same sandbox as a live document ([viewer](SPEC-viewer.md)). It
    never runs in the page of easel.

## Success Criteria

- Two agents never get the same request, in a test that forces the race. A test double for the
  store write runs a second `request.next` to its end before the write of the first one lands.
  The two get different requests. A claim that finds, awaits, then writes fails this test.
- A lease that runs out puts the request back, in a test that moves the clock. Tabs show it
  waiting with no write, a waiting `request.next` takes it at once, and the old claim answers
  `lost`.
- 3 tries with no outcome make a request need a person, in a test that moves the clock. Releases
  count. An edit makes it waiting again with `tries` at 0.
- A viewer call on a request in work answers `wrongState`, in a test where an agent claims first.
- A repeated `request.add` with one key saves one request.
- A test reaches every contract kind and refusal. `tinker check` is OK.
- Each rule of [queue-lease](docs/statecharts/queue-lease.md) and
  [request-life](docs/statecharts/request-life.md) holds, and a test walks each path that their
  charts draw.

## Out of Scope (Deferred)

- Requests from users through the CLI: viewers ask, agents work. A user can edit and close.
- Notices outside the browser (mail, chat). A viewer sees changes on the page (E4.4).
- Priorities are not deferred: they are not wanted. The queue is oldest first.
