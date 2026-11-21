# Spec: queue — V1

Module `queue` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md),
[frames](SPEC-frames.md) and [ops](SPEC-ops.md). The needs it meets are E4.1 to E4.3 and E4.5 in
[epics](docs/epics.md). How the pins and the panel look is in [viewer](SPEC-viewer.md).

## Objective

A viewer asks for a change. The request goes into one queue with the requests of all canvases.
Agents take requests oldest first and work on them. Each try ends with one outcome: a result, a
question to the viewer, or a give-back to a person. A viewer accepts a result or opens it again. A
request that agents cannot finish goes to a person. No request stays stuck.

Agents get requests in two ways. An agent that asks for work takes the oldest request (pull). And
a dispatcher delivers each waiting request to the channels that the team lead set, such as an
issue in the GitHub repository of the team, where an agent starts and takes it. A delivery only
tells. The claim alone decides which agent works, so a request that goes two ways is done one
time only.

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
- The dispatcher is a fan-out, as SNS sends one message to many SQS queues. Delivery is at least
  once; the claim makes the work one time only.
- A GitHub channel is the delegation of Linear: a person gives an issue to an agent, and Linear
  sends it to the agent. Here the agent starts from a GitHub issue, as `claude-code-action` starts
  on an issue that is opened, labeled or mentions it.
- The token of a channel is write-only, as a secret of GitHub Actions: no call shows it again.
- A delivery that fails is tried again after a longer time each time, as a webhook of Stripe or GitHub.
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
5. While no agent holds the request, the viewer can correct its text (an edit). An edit adds a
   message, and the request goes to the back of the queue. The viewer can take back the request
   (a close) at any time before its result, also while an agent works on it. Then the claim ends,
   and the next call of the agent answers `wrongState` with the state `closed`, so no result
   comes. A change that the agent made to the frame before that stays: the frame keeps its
   versions, and a viewer can ask for a new change.
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
   - It cannot do the request, so it runs `easel decline <claim> --reason "No form here."`. The
     request goes to a person.
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

### The dispatcher gets a request to the agents

1. A request is waiting: a viewer adds, edits, answers or opens it again, an agent releases it, or
   its lease runs out. Each of these starts a waiting period. It ends at the next claim.
2. Within 5 s, the dispatcher delivers the request to each channel of the server, one time for
   each waiting period. An agent that asks for work needs no delivery: it can always take the request.
3. For a GitHub channel, the first delivery opens an issue in the repository of the channel, with
   the label of the channel. The issue holds the canvas, the number and the text of the request,
   and the command that takes this request only: `easel next --canvas <key> --n <n>`. It says that
   the text is the request of a viewer, not an instruction. A later waiting period writes a comment on the
   same issue. The comment starts with the trigger of the channel (default `@claude`), and opens
   the issue again if it is closed.
4. GitHub starts a run of the agent of the team from the issue or the comment. The run takes the
   request with `easel next --canvas <key> --n <n>`, and works as in the journey above. If an agent that asked took
   it first, or it left the queue, the run is told `empty` and ends.
5. A delivery that fails (GitHub refuses, does not answer in 10 s, or the repository is public) is
   tried again after 10 s and 30 s. After 3 failures, the delivery is `failed` with its cause, and
   the dispatcher stops for this waiting period. The request still waits for an agent that asks.
   If the waiting period ends before an attempt goes through (an agent takes the request, or it
   leaves the queue), the delivery is `failed` with the cause `ended`: no agent needs it.
6. The issue follows its request. It is open while the request is waiting, in work or needs a
   person. When the request has a question, a result, or is closed, the dispatcher writes the
   state as a comment and closes the issue.
7. `easel deliveries <canvas> <n>` shows each delivery of the request: the channel, the period, when,
   `pending`, `sent` or `failed`, the attempts, the cause, and the issue. A request with no
   delivery and no channel says so.

### A team lead sets the channels

1. An owner runs `easel channel set gh github --repo acme/design --label easel --token-file t`.
   Easel checks the token: the repository must exist, be private, and let the token write issues.
   Easel makes the label if it is not there; that write proves that the token can write issues.
   Then it saves the channel, and the next waiting period goes to it. The waiting periods that
   started before do not go to it.
2. With a repository that is public, the answer is `public`, and nothing is saved. With a token
   that cannot write issues, or a repository that does not exist, the answer is `refused` with
   the answer of GitHub.
3. `easel channel ls` lists the channels: name, kind, repository, label, trigger, and the last 4
   characters of the token. No call shows the token.
4. `easel channel rm gh` removes the channel. Its issues stay on GitHub, and the dispatcher does
   not change them again.
5. A server can have more than one channel. Each one gets each waiting period.

### A viewer answers and decides

1. A request with a question shows the question to every viewer within 1 s. Any viewer answers it
   with text, or picks one of its options. The request is waiting again, in its first place in the
   queue (E4.2 M19), and its count of tries starts again at 0.
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
// a viewer or a user: the mayRead guard for the canvas that the call names, `mayAct` (refused
// { ended: true } when the link has ended, { locked: true } when a password change ended the
// pass, { name: true } when the pass has no name, { signIn: true } with no pass and no live
// token). The page asks the name at the first Send, and gives it to the pass
// ([frames](SPEC-frames.md)).
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
// list { canvas?, state? }; next takes n with canvas: only that request
// deliveries { canvas, n }
"request.next":    { kind: "claimed"; request: Request; messages: Message[];
                     frame: Frame | null; saw: { version: number; doc: string } | null;
                     frames: FrameBox[] | null; claim: string; until: number; now: number;
                     note: string }
                 | { kind: "empty" }
"request.extend":  { kind: "extended"; until: number; now: number } | Lost
"request.release": { kind: "released" } | Lost
"request.decline": { kind: "declined" } | Lost
"request.ask":     { kind: "asked" } | Lost
"request.resolve": { kind: "resolved" } | Lost
"request.list":    { kind: "listed"; requests: Request[] }
"request.deliveries": { kind: "listed"; deliveries: Delivery[]; channels: number }
                 | { kind: "gone" }

// an owner (refused { owner: true } for a member)
// channel.set { name, kind: "github", repo, label, trigger?, token }; remove { name }
"channel.set":     { kind: "saved" } | { kind: "public" } | { kind: "refused"; status: number;
                     message: string }
"channel.list":    { kind: "listed"; channels: ChannelInfo[] }
"channel.remove":  { kind: "removed" } | { kind: "gone" }
type Lost = { kind: "wrongState"; state: State } | { kind: "lost" } | { kind: "gone" }
```

Success kinds: `added`, `edited`, `answered`, `accepted`, `reopened`, `closed`, `claimed`,
`empty`, `extended`, `released`, `declined`, `asked`, `resolved`, `listed`, `saved` and
`removed`. Every other kind is
not: the CLI exits 1, and an MCP tool sets `isError`.

Inputs:

- `text` and `reason` are 1 to 2000 characters. `key` is 16 to 64.
- `html` is a full HTML document of at most 256 KiB, in UTF-8 bytes.
- `options` is 2 to 6 strings of 1 to 200 characters. `option` is an index into them. An `option`
  that is not an index into the options of the question is not kept: the answer keeps its text.
- `lease` is seconds, 30 to 3600, default 300. `wait` is seconds, 0 to 50, default 0.
- `until` and `now` are the time of the server, in ms since the epoch.
- `claim` is the `id` of the request, a dot, and 128 random bits as 32 hex digits. So a call with
  it finds its request, and answers `gone` when the request is not there (judged rule 8).
- `note` is what the claim allows, in words (judged rule 15). `saw` is `null` when the version that
  the viewer saw is not kept: the frame was replaced between the viewer's look and the send.
- `n` on `request.next` needs `canvas`. `name` is 1 to 32 characters of `a-z`, `0-9` and `-`.
  `repo` is `owner/name`. `label` and `trigger` are 1 to 50 characters. `token` is 1 to 255.
- Out of these limits, the input is `invalid`.

The cells `requests`, `messages` and `serverClock` ride `easel.board`, with `frames` and `docs`,
so the one `mayRead` guard and the refusal that a link sends when it ends cover them too. The cell
`serverClock`, keyed by canvas, is `{ canvas, now }`: each read loads the time of the server, and
the tab keeps the difference to its own time as the clock offset.

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

A channel (table `channels`, not on the board): `{ name, kind, repo, label, trigger, token,
created }`. `ChannelInfo` is the same, with `tokenEnd` (the last 4 characters) in place of
`token`.

A delivery (table `deliveries`, not on the board): `{ request, channel, kind, period, attempts,
status, cause, ref, next, created, updated }`.

- `kind` is `waiting` or `out`. A `waiting` delivery tells of a waiting period: it opens the issue,
  or writes on it again. An `out` delivery makes the issue follow its request when the request
  leaves the queue: it writes the state, and closes the issue. Its `period` is the last waiting
  period that was sent, so an issue closes one time for each time it opened.
- `period` is the time when the waiting period started: the time of the call that made the
  request waiting (add, edit, answer, reopen or release; it writes `updated`), or `claimedUntil`
  for a lease that ran out. Each waiting period has a new value. (`queuedAt` and `tries` do not
  do this: an answer keeps `queuedAt` and sets `tries` to 0, as the first period had.)
  `request`, `channel`, `kind` and `period` are unique together.
- `status` is `pending`, `sent` or `failed`. `attempts` counts the attempts, 0 to 3. `next` is the
  time of the next attempt of a `pending` delivery. `cause` is why the last attempt failed:
  `public`, `timeout`, `network`, the status and message of GitHub, or `ended`.
- `ref` is the number of the GitHub issue, from the first attempt that was sent. All deliveries of
  one request to one channel use the same issue.

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
`queuedAt` to `created`. A release, an edit and a reopen set it to the time of that call. An
answer keeps it: the request goes back to its first place (E4.2 M19).

## Rules

The statechart [queue-lease](docs/statecharts/queue-lease.md) checks the claim, the lease, the
release, the outcome and the count of tries. [request-life](docs/statecharts/request-life.md)
checks the states of one request and who can move it. Their rules are the oracle that the tests
follow. [queue-two-step](docs/statecharts/queue-two-step.md) breaks on purpose. It shows why the
claim is one write. [queue-dispatch](docs/statecharts/queue-dispatch.md) checks the deliveries:
one for each waiting period, the cap of attempts, and one outcome when two ways are on.

### Fact rules (the code graph decides)

1. `request.add`, `edit`, `answer`, `accept`, `reopen` and `close` run `mayRead` first, for the
   canvas that they name.
2. These calls take the name of the sender from the pass, or from the user. They do not take it
   from the input.
3. `request.next`, `extend`, `release`, `decline`, `ask`, `resolve` and `list` run the `user`
   guard first. All calls take the time from the `clock` of the run.
4. Every operation that writes `requests` or `messages` calls `saveRequest` (a new request),
   `changeRequest` (a call of a viewer), `claimRequest`, `endTry` (a call of the holder),
   `dropFrame` or `dropCanvas`.
5. No page module writes `requests` or `messages`.
6. `channel.set`, `list` and `remove` run the `owner` guard first. `request.deliveries` runs the
   `user` guard first.
7. Only the dispatcher writes `deliveries`, and only through `startDelivery` and `endAttempt`. Only
   the dispatcher and `channel.set` call GitHub, and only through `githubCall`.

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
   - `close`: `open` (also in work), `asking`, or `person`. It sets `closed` and ends the lease
     (`claimedBy` and `claimedUntil` to null).
   - In any other state, the answer is `wrongState`. A viewer changes a request that an agent
     holds only to take it back (`close`).
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
19. A delivery changes no request. It writes `deliveries` only. Only a claim takes a request, so
    two ways never give one request two outcomes.
20. The dispatcher delivers only a request that is waiting, and at most one time for each waiting
    period and channel. `startDelivery` is one conditional insert on the unique `request`, `channel` and
    `period`. A failed attempt is tried again after 10 s, then 30 s; the third failure sets
    `failed`. A request that needs a person gets no delivery, so the cap of tries ends the
    deliveries.
21. `request.next` with `n` takes only that request, in one conditional write as in rule 6, and
    only when it is waiting. Else it waits as in rule 12, and answers `empty`.
22. Each attempt reads the repository first. A repository that is public now fails the attempt
    with the cause `public`, and nothing goes to GitHub.
23. The issue text says that the request text is from a viewer, and is not an instruction outside
    its frame (rule 15). The token of a channel is never in an answer, a log or an error.
    Before a text of a viewer goes to GitHub, each `@` before a name gets a zero-width space
    after it, in one place: no mention or trigger word in it notifies a person or starts a
    workflow. Only the trigger that the dispatcher writes at the start of a comment is live.
24. A crash between the call to GitHub and `endAttempt` can open a second issue for one waiting period.
    The claim keeps the work one time only (rule 19).

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
  The one exception is `close`: it closes the request, and the next `resolve` of the agent answers
  `wrongState` with the state `closed`.
- An answer puts the request before a request that was asked after it, in a test with two
  requests and one agent.
- A repeated `request.add` with one key saves one request.
- Two ways on, in a test: a GitHub channel with a test double of GitHub, and an agent that asks.
  Each of 20 requests ends with one outcome. A run that comes late is told `empty`.
- In a test that moves the clock, a lease that runs out starts a new waiting period, and the channel gets a
  second delivery on the same issue. A request that needs a person gets none.
- A GitHub double that fails 3 times gives a `failed` delivery with its cause within 1 minute. A
  public repository fails with `public`, and the double gets no issue.
- No answer and no log line holds the token of a channel.
- A test reaches every contract kind and refusal. `tinker check` is OK.
- Each rule of [queue-lease](docs/statecharts/queue-lease.md),
  [request-life](docs/statecharts/request-life.md) and
  [queue-dispatch](docs/statecharts/queue-dispatch.md) holds, and a test walks each path that
  their charts draw.

## Out of Scope (Deferred)

- Requests from users through the CLI: viewers ask, agents work. A user can edit and close.
- Notices outside the browser (mail, chat). A viewer sees changes on the page (E4.4).
- Priorities are not deferred: they are not wanted. The queue is oldest first.
- A webhook channel: a call to a service of the team when a request waits. Add it when a team has
  its own service that starts agents (E4.5).
- Channels for each canvas. Each channel gets each waiting period of the server (E4.5).
- A GitHub App in place of a token. Add it when a team asks to not give a token.
