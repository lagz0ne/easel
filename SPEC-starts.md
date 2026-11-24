# Spec delta: `starts`, only the person starts the work of an agent

Status: implemented (f1561ca, 9ffcf17, b09e544; live on easel.vibea.dev since 2026-11-24, build
308). Approved by the requirements of 2026-11-24 (E4.5 D11, D12 and D13 in
[epics](docs/epics.md), and the user: "yes, work on this, do the routine. Dispatcher needed").
The user granted autonomy, so the decisions below are mine, with their reasons. They follow
D11 to D13 as written.

Depends on [queue](SPEC-queue.md) (the dispatcher and its channels),
[design-loop](SPEC-design-loop.md) (the NATS channel and the Paseo adapter) and
[single](SPEC-single.md) (one person). The model is [starts](docs/statecharts/starts.md).

## Objective

Round 1 is one person and one project (the user, 2026-11-24). Agents do all the work, and a
request starts an agent on the machine of the person. Three needs come from the walk of the
slice:

- **D11.** Only the person starts the work of an agent. A request from a share link waits until
  the person agrees to it. A request of the person starts an agent with no other step.
- **D12.** The person sets the limits: the count of agents at the same time, and in a day. Over a
  limit, a request waits, and the person sees that it waits for the limit.
- **D13.** On a request that waits for more than 2 minutes, the person sees the cause: a limit, a
  refusal, a failed start, or no agreement.

In this spec, "the person" is an owner of the easel. With `EASEL_AUTH=single`, it is the one
person. A member is an agent, and a viewer is a person with a share link. Neither is the person.

### Prior art

- **GitHub Actions, runs from a fork.** A pull request from an outside contributor makes a run
  that waits with the status `action_required`. A maintainer with write access reads the change,
  then clicks "Approve workflows to run". The reason that GitHub gives: anyone can fork a public
  repository, and a run uses the runners and secrets of the owner. Easel has the same risk: a
  viewer with a share link writes text that an agent with full rights reads.
- **Vercel, Git fork protection.** A preview of a pull request from a fork waits until a member
  of the team authorizes it. The step is skipped when the author is a member already. This is
  D11 as written: the request of the person needs no step.
- **Buildkite, job states.** A job that waits says why with its state: `blocked` (it waits for a
  person to unblock it), `limited` (it waits for a slot of its concurrency group), `waiting`
  (it waits for an earlier step). The API also tells which jobs are before it in the group. Easel
  copies this: one cause for each waiting request, with the numbers of the limit.
- **Kubernetes, a pod that is pending.** The pod stays `Pending` with a condition and a message
  that names the cause, for example `0/3 nodes are available: Insufficient cpu`. The scheduler
  writes the cause; the person reads it on the object that waits.
- **Linear, agent sessions.** An agent that cannot go on writes an `error` activity on the issue,
  so the person sees the cause where the work is.
- **CI runners (GitHub Actions, Buildkite agents).** The runner calls the server again and
  again. The server shows a runner as offline when the calls stop. Easel shows a starter that
  does not report in the same way.

Trade-offs that I took from them:

- Easel holds a request before the dispatcher, as GitHub and Vercel hold a run before it starts.
  A hold after the start (an agent that waits for a person) would keep a process and a model
  running, and the design agents are non-interactive (SPEC-design-loop, rule 5).
- An agreement is for the text that the person read. GitHub and Vercel approve one commit; a new
  commit of the fork needs a new approval. In easel, a new text of a viewer needs a new
  agreement.
- The limits stay where the agents start (the adapter knows the Paseo agents that run). Easel
  keeps the values that the person sets, and shows what the adapter reports, as Buildkite shows
  `limited`.

## Current behavior

- Each waiting request of `design-system` and `product` goes to NATS within 5 s. The adapter
  starts a Paseo agent for each message. Nothing asks who wrote the request. A viewer with a share
  link can start an agent.
- `easel next` gives each waiting request to any agent that asks.
- The limits (2 at the same time, 20 in a UTC day) are environment values of the adapter
  (`EASEL_PASEO_MAX_RUNNING`, `EASEL_PASEO_MAX_PER_DAY`). The person cannot set them without a
  change of the unit, and easel does not know them.
- Over a limit, the adapter writes `busy` or `day-limit` in its own log. A failed `paseo run`
  writes `start-failed` in the log. The person sees the request as "waiting", with no cause.
- `easel deliveries` shows the publish to NATS (`sent` or `failed`), but not the start of the
  agent.

## New behavior

### Agreement (D11)

1. A request has an agreement, or none. The agreement keeps the time and the name of the person
   who agreed.
2. A request that the person adds is agreed at once. A request of a viewer or of a member has no
   agreement. A request that easel adds itself (author `easel`, as the build request of
   [E11](docs/epics.md) after the accept of the person) is agreed at once: the accept of the
   person is the agreement.
3. A write that makes a request wait again (an edit, an answer, a note, a reopen) changes the
   agreement:
   - A write of the person agrees to the request.
   - A write of another sender ends the agreement. The request waits for the person again, as
     the text that the agent reads changed.
   - A release by an agent and a lease that runs out keep the agreement.
4. A note of another sender to a request in work ends the agreement too. The agent keeps its
   claim, but `easel extend` gives it only the notes that are older than the last agreement. The
   person agrees again, and the agent gets the note at its next extend.
5. The person agrees with the button `Agree` on the request card, or with
   `easel agree <canvas> <n>`. The answer is `agreed`, `wrongState` (the request is not waiting
   and not in work), `gone`, or `notPerson` (the caller is not an owner). An agree of a request
   that is agreed changes nothing, and answers `agreed`.
6. An agree starts a new waiting period, so the dispatcher publishes the request within 5 s.
7. The dispatcher publishes only a request with an agreement. `easel next`, with or without
   `--n`, never gives a request with no agreement: the answer is `empty`. So an agent that a
   message of an earlier waiting period started cannot work on a text that the person did not
   agree to.
8. The requests that are in the database before this change keep their state: each is agreed at
   its time of creation, by its author. The dispatcher published them before this change.

### Limits (D12)

9. A NATS channel has two limits: `running`, the count of agents at the same time (1 to 20,
   default 2), and `perDay`, the count of starts in a UTC day (1 to 500, default 20).
10. The person sets them with `easel channel limits <name> [--running <n>] [--per-day <n>]`.
    The answer is `saved` with the two values, `gone`, or `notNats` (a GitHub channel has no
    starter). `easel channel ls` shows the limits of a NATS channel.
11. The starter of the channel (the Paseo adapter) reads the limits from easel in the answer of
    each report (rule 15). A new limit holds within 30 s. If easel cannot be reached, the
    adapter keeps the last limits that it read; before its first read, it uses its environment
    values.
12. Over a limit, the adapter fetches no message. The message waits in the stream, and the
    adapter reports the limit to easel.

### Causes (D13)

13. Easel keeps one hold for each waiting request that has no agent yet. A hold is the cause
    that the request does not start an agent:
    - `agreement`: the request has no agreement (rule 2).
    - `limit`: the starter of a channel that has the request is at a limit. The hold says which
      limit, the count and the limit: "2 of 2 agents run", or "20 of 20 starts today".
    - `failed`: the start of the agent failed for this waiting period. The hold says when the
      starter tries again.
    - `refused`: a delivery of this waiting period is `failed` (NATS or GitHub refused it 3
      times).
    - `silent`: a delivery is sent to a NATS channel, and its starter has not reported for 60 s.
14. The board of each tab gets the hold within 2 s, also by a share link. The cause as text (an
    error of `paseo run`, an answer of NATS) is not on the board, as it can name paths and hosts
    of the machine. `easel deliveries <canvas> <n>` shows it to a user.

### The reports of the starter

15. A user (owner or member) reports for a NATS channel with `easel channel report <name>`:
    - `--running <n> --today <n> [--at running|day]`: the state of the starter. The adapter sends
      it when a value changes, and every 30 s.
    - `--started <canvas>:<n>:<period> --agent <id>`: a start of an agent.
    - `--failed <canvas>:<n>:<period> --cause <text> --retry <ms>`: a failed start. The cause is
      cut to 300 characters.

    The answer is `noted` with the limits of the channel, or `gone` (no such channel). A report
    for a request or a period that easel does not know is `noted` and changes nothing.

16. `easel deliveries <canvas> <n>` shows, for a NATS delivery, the start: `started` with the
    agent and the time, or `failed` with the cause and the time.
17. The adapter counts the starts of the UTC day in its state file, as before, and sends the count
    in its report. It reports each start and each failed start.

### What the person sees

18. The request card shows the hold under its head, in the tone of a warning:
    - `agreement`, to the person: "Waits for you to agree", and the button `Agree`. To a viewer
      or a member: "Waits for the owner to agree".
    - `limit`: "Waits for the limit: 2 of 2 agents run" (or "20 of 20 starts today").
    - `failed`: "The agent did not start. Easel tries again at 08:42."
    - `refused`: "The channel refused the request. See easel deliveries."
    - `silent`: "The agent starter does not answer since 08:40."
19. The list of requests shows a mark on each request with a hold, with the same words in short:
    "Agree?" (to the person) or "Owner" (to a viewer or a member), "Limit", "Not started",
    "Refused", "No starter".
20. The rule of agreement is the switch `EASEL_AGREEMENT` of the server. It is on unless the value
    is `off`. The first deploy keeps it off, and a second deploy turns it on after the person is
    the one owner (SPEC-single). At its first start, the new version agrees each request that is
    there, as its author made it, so no open request of before waits.

## Model

The model comes first, as the hold changes who can start an agent. It is
[starts](docs/statecharts/starts.md) (`docs/statecharts/models/starts/Starts.tla`). TLC checks
these rules on all 206 states, and each one holds:

| Rule                                  | In plain words                                                              |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `AnAgentWorksOnlyOnAnAgreedRequest`   | An agent works on a request only when the person agreed to it as it is now. |
| `ARequestOfThePersonIsAgreed`         | A request of the person needs no other step.                                |
| `ARequestThatWaitsForThePersonSaysSo` | A request with no agreement shows `agreement`.                              |
| `OnlyAnAgreedRequestIsPublished`      | The dispatcher publishes only a request with an agreement.                  |
| `NoStartOverALimit`                   | No agent starts while the starter is at a limit.                            |
| `AShownLimitIsTrue`                   | Easel shows a limit only when the starter reported it.                      |
| `AShownFailureIsTrue`                 | Easel shows a failed start only when the start failed.                      |
| `AShownRefusalIsTrue`                 | Easel shows a refusal only when the delivery failed.                        |
| `AnAgreedRequestIsPublished`          | An agreed request goes to the starter with no other step.                   |
| `AWaitingRequestStartsOrShowsWhy`     | A request that waits gets an agent, or shows its cause.                     |
| `AnAgentThatCannotWorkEnds`           | An agent that a message started for a request that is out ends.             |

Its twin, [starts-no-agreement](docs/statecharts/starts-no-agreement.md), is the behavior before
this spec. It breaks: a viewer posts, the dispatcher publishes, an agent starts and claims.

## Success criteria

1. **No agent from a share link (D11).** A viewer adds a request on `product` by its share link.
   For 3 minutes, no Paseo agent starts for it, and `easel deliveries` shows no delivery. The card
   of the person shows "Waits for you to agree" within 2 s. After `Agree`, an agent starts within
   1 minute.
2. **No step for the person (D11).** The person adds a request on `product`. An agent starts
   within 1 minute, with no other step.
3. **A new text needs a new agreement (D11).** A viewer edits an agreed request before an agent
   claims it. The request waits for the person again, and `easel next --n` answers `empty`.
4. **The limit (D12).** With `--running 2`, the person adds 3 requests. Two agents start. The
   third card shows "Waits for the limit: 2 of 2 agents run" within 2 minutes, and its agent
   starts after one of the first two ends.
5. **The person sets the limits (D12).** `easel channel limits design-loop --per-day 1` holds within
   30 s: after one start, the next request shows "1 of 1 starts today".
6. **A failed start (D13).** A `paseo run` that fails shows "The agent did not start" on the card
   within 2 minutes, and `easel deliveries` shows its cause.
7. **No starter (D13).** With the adapter stopped, a published request shows "The agent starter
   does not answer" within 2 minutes.
8. **The checks.** `scripts/statecharts.sh --check` passes. `bun run check:plain` prints
   `tinker check: OK`, and a test reaches each exit of `request.agree`, `channel.limits` and
   `channel.report`.

## Boundaries

- Always: a request of a viewer or a member waits for the person before the dispatcher.
- Always: the text of a cause stays off the board. Only a user sees it.
- Never: a member agrees, or sets a limit. These are owner calls.
- Never: easel starts an agent itself. The starter of a channel starts it.

## Out of scope (deferred)

- **A control in the viewer to set the limits.** The CLI sets them now. Add it when the person
  wants to change a limit from a phone.
- **Limits and causes for a GitHub channel.** GitHub (D7, D10) is deferred in Round 1.
- **A cost limit.** The limits count agents, not money. Add it when the cost of a day is a
  problem.
- **An agreement for each part of a thread.** One agreement covers the request as it is now.

## Decisions

1. **The hold is before the dispatcher** (GitHub `action_required`, Vercel fork protection): a
   request with no agreement gets no delivery, so no agent starts and no model runs for it.
2. **The person is an owner.** In single mode, it is the one person. An agent is a member, so an
   agent cannot agree to the request of a viewer.
3. **A new text of a viewer ends the agreement** (rule 3), as a new commit of a fork needs a new
   approval.
4. **The limits live on the channel in easel, and the adapter applies them**, as the adapter
   alone knows the Paseo agents that run. The adapter reads them in the answer of its report, so
   it needs no second call.
5. **The adapter reports with the easel CLI of its own commit**, as the member of
   `EASEL_PASEO_EASEL_CONFIG` (`vibea-claude`). It needs no new key and no new NATS subject.

## Design

The page `E4.5 dispatch` of `product` holds the design, made as `vibea-claude`. Each screen proves
these IDs:

| Frame          | Screen                                    | IDs      |
| -------------- | ----------------------------------------- | -------- |
| `406a5ab3f085` | The person: "Waits for you to agree"      | D11, D13 |
| `1e645843b77d` | The viewer: "Waits for the owner"         | D11      |
| `67e02628bebe` | Agreed: an agent starts                   | D11      |
| `0413a78c9597` | "Waits for the limit: 2 of 2 agents run"  | D12, D13 |
| `fae7c821cc84` | "Waits for the limit: 20 of 20 starts..." | D12, D13 |
| `59eeb0e133ee` | "The agent did not start"                 | D13      |
| `1f6012cb15ce` | "The channel refused the request"         | D13      |
| `bce6c1c565ed` | "The agent starter does not answer"       | D13      |

`bun run design:proof` reads Doop only. It cannot read a design on easel yet, so it says that
D11 to D13 show on no state. The table above is the proof until it reads easel (E11 V7).

## Tasks

| ID   | Task                                                                                       | State |
| ---- | ------------------------------------------------------------------------------------------ | ----- |
| ST-1 | This spec, the model `starts` and its twin.                                                | done  |
| ST-2 | The design: the states of the card and the list on the page `E4.5 dispatch` of `product`.  | done  |
| ST-3 | The server: agreement, `request.agree`, the gate of the dispatcher and of `easel next`.    | done  |
| ST-4 | The server: `channel.limits`, `channel.report`, the holds, and the starts in `deliveries`. | done  |
| ST-5 | The viewer: the hold on the card and in the list, and `Agree`.                             | done  |
| ST-6 | The adapter: the limits from easel, the reports.                                           | done  |
| ST-7 | Live proof (success criteria 1, 2 and 4), then this spec is implemented.                   | done  |

ST-3 and ST-4 shipped in f1561ca, and ST-5 in 9ffcf17, with the rule of agreement off. b09e544
turned it on, after `lagz0ne` became the one owner. The live NATS channel is `design-loop`; the
adapter reads it from `EASEL_PASEO_CHANNEL` (hq-8uk).

Live proof on `product`, 2026-11-24 (UTC), with the limits 2 running and 20 a day:

1. Criterion 1. A viewer of the share link sent `product#11` at 11:48:49. Its card said "Waits
   for the owner" and "Waits for the owner to agree" at 11:48:59. The card of the person said
   "Waits for you to agree", with `Agree`. Until 11:53:20, `paseo ls` showed no `design product#11`,
   and `easel deliveries` said "no delivery yet". `easel agree product 11` ran at 11:53:23. The
   delivery was sent at 11:53:24, and the agent started at 11:53:28.
2. Criterion 2. The person sent `product#12` at 11:59:51 with no other step. The delivery was
   sent at 11:59:52, and the agent started at 12:00:09.
3. Criterion 4. With 2 agents in the state running (`product#13` and `#14`), the person sent
   `product#15` at 12:00:51. At 12:03:46 its card said "Waits for the limit: 2 of 2 agents run",
   and no agent ran for it. An earlier read of the card did not work, so the first time of the
   notice is not known. The agent of `#13` ended at 12:03:57, and the agent of `#15` started at
   12:04:06.

All test requests (`product#11` to `#15`) are closed, and their agents are archived.
