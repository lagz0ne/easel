# The Paseo adapter

The adapter is step 5 of the design loop (SPEC-design-loop.md, § The loop). It reads the design
requests that easel publishes to the hub's NATS, and starts one Paseo agent for each request. It
is not part of the easel server binary. Nothing in `src/` or `cmds/` imports it.

## What it does

1. It connects to `hub-nats` with the nkey `easel-paseo`, and binds to the durable pull consumer
   `paseo` of the stream `EASEL_REQUESTS`. The hub makes the consumer. The adapter never makes it.
2. Before each fetch, it reads the count of starts of this UTC day from
   `~/.local/state/easel-paseo-adapter/starts.json`, and asks Paseo for the agents with the label
   `easel-loop=design` that are `initializing` or `running` (`paseo ls -g --background`).
3. It reports this state to easel (SPEC-starts.md, rule 15):
   `easel channel report loop --running <n> --today <n> [--at running|day]`, as the user of
   `EASEL_PASEO_EASEL_CONFIG`. It sends it when a value changes, and every 30 s. The answer holds
   the limits that the person set with `easel channel limits loop`. A change of the limits logs
   `limits`. If easel cannot be reached, the adapter logs `report-failed` one time, keeps the
   last limits, and goes on; `report-ok` says that easel answers again. Before the first answer,
   the limits are `EASEL_PASEO_MAX_RUNNING` and `EASEL_PASEO_MAX_PER_DAY`.
4. At the day limit, it fetches nothing until the next UTC day, and logs `day-limit` one time.
   While the agents that run are at the running limit, it fetches nothing, and logs `busy` one
   time. The messages wait in the stream (max age 1 day), and easel shows "Waits for the limit"
   on their requests.
5. It fetches one message. A message that is not `{canvas, n, frame, page, period}` gets a term,
   and the log line `malformed`.
6. If an agent with the label `easel-request=<canvas>:<n>` still runs, the message is a repeat.
   The adapter acks it, starts no agent, and logs `repeat`.
7. Otherwise it starts an agent with `paseo run --no-wait` in the background workspace
   `easel design loop` of the easel folder. If no local background workspace has the folder, the
   adapter makes one with `paseo workspace create --isolation local --background`. The sidebar and
   the normal lists of Paseo do not show a background workspace or its agents. To see them, run
   `paseo ls -g --background --label easel-loop=design`. The title is `design <canvas>#<n>`. The prompt names the canvas, the number, the frame
   and the page, and tells the agent to claim the request with
   `easel next --canvas <canvas> --n <n>`. Then the adapter counts the start, acks the message,
   logs `started`, and reports it: `easel channel report loop --started <canvas>:<n>:<period>
--agent <id>`.
8. If `paseo run` fails, the adapter naks the message with a delay of 60 s, logs `start-failed`
   with the cause, and reports it: `--failed <canvas>:<n>:<period> --cause <text> --retry <ms>`.
   The message comes again after the delay, and easel shows "The agent did not start".
9. Each agent gets `EASEL_CONFIG_HOME=~/.config/easel-agent`, so its `easel` CLI acts as the
   member `vibea-claude`, as the easel MCP tools do (`.mcp.json`). The prompt tells it to check
   with `easel whoami` first, and to use only the MCP tools if the CLI is not `vibea-claude`.
10. The agents run in Claude's auto mode, and they are non-interactive. The unit of the hub sets
    `EASEL_PASEO_PROVIDER=easel-design`: a Paseo provider in `~/.paseo/config.json` that extends
    `claude` and removes `AskUserQuestion`, `ExitPlanMode` and `EnterPlanMode` (hq-rjx). So an
    agent has no tool that asks a person. While a design agent
    runs, the adapter reads `paseo permit ls --json` every 3 s. It denies each pending request of
    a design agent with `paseo permit deny`, and logs `denied` with the agent, the request id and
    the tool. A question to the user (`AskUserQuestion`) is a permission request too. The adapter
    never touches the requests of other agents, and never logs the text of a request.

The consumer has `max_ack_pending` 2, but the adapter acks a message right after the start. So
the adapter also counts the running agents itself (step 2).

The adapter runs the easel CLI of its own commit (`bun cmds/easel.ts` of the export), so the
report and the server agree. `EASEL_PASEO_EASEL` names another binary.

## Run it

```sh
bun run services/paseo-adapter/main.ts
```

The log is one JSON line for each event on stdout: `bound`, `started`, `repeat`, `busy`,
`day-limit`, `limits`, `report-failed`, `report-ok`, `malformed`, `start-failed`, `denied`,
`deny-failed`, `paseo-failed`, `step-failed`, `permit-failed`, `closed`, `stopping` and `stopped`. The log never shows the seed.

## Environment

| Variable                    | Default                                                  |
| --------------------------- | -------------------------------------------------------- |
| `EASEL_PASEO_NATS_URL`      | `nats://127.0.0.1:4222`                                  |
| `EASEL_PASEO_SEED_FILE`     | `~/.config/secrets/hub-nats/easel-paseo.nk`              |
| `EASEL_PASEO_INBOX`         | `_INBOX_easel_paseo`                                     |
| `EASEL_PASEO_STREAM`        | `EASEL_REQUESTS`                                         |
| `EASEL_PASEO_CONSUMER`      | `paseo`                                                  |
| `EASEL_PASEO_BIN`           | `paseo`                                                  |
| `EASEL_PASEO_WORKSPACE_DIR` | `~/dev/easel`                                            |
| `EASEL_PASEO_PROVIDER`      | `claude`; the unit of the hub sets `easel-design`        |
| `EASEL_PASEO_MODE`          | `auto`                                                   |
| `EASEL_PASEO_EASEL_CONFIG`  | `~/.config/easel-agent`: the agent's `EASEL_CONFIG_HOME` |
| `EASEL_PASEO_STATE_DIR`     | `~/.local/state/easel-paseo-adapter`                     |
| `EASEL_PASEO_CHANNEL`       | `loop`: the NATS channel of easel that it reports for    |
| `EASEL_PASEO_EASEL`         | `bun cmds/easel.ts` of the same commit                   |
| `EASEL_PASEO_REPORT_MS`     | `30000`: a report of the same state again                |
| `EASEL_PASEO_MAX_RUNNING`   | `2`: the limit before the first answer of easel          |
| `EASEL_PASEO_MAX_PER_DAY`   | `20`: the limit before the first answer of easel         |
| `EASEL_PASEO_POLL_MS`       | `5000`: the wait over a limit, and the fetch             |
| `EASEL_PASEO_NAK_MS`        | `60000`: the delay after a failed `paseo run`            |
| `EASEL_PASEO_PERMIT_MS`     | `3000`: the permission check while agents run            |

## The user unit

The hub runs the adapter as the user unit `easel-paseo-adapter.service` (hq-io7). The hub keeps
the unit in `~/work/config/systemd/easel-paseo-adapter.service`.

- The unit runs a copy of `origin/main`, not the live checkout: uncommitted edits in the shared
  checkout never reach the adapter. Each start exports `origin/main` to
  `~/.cache/hub-exports/easel` and runs `bun install --frozen-lockfile --production` there.
- The design agents still work in `~/dev/easel` (`EASEL_PASEO_WORKSPACE_DIR`).
- To get a new version live, ship it to `main`, then run
  `systemctl --user restart easel-paseo-adapter`.
- To see the running version, run `readlink ~/.cache/hub-exports/easel/current`.
- To see the log, run `journalctl --user -u easel-paseo-adapter -o cat -f`.

## Tests

`tests/paseo-adapter.test.ts` starts a local `nats-server -js` with a stream and a consumer as the
hub has them, a fake `paseo` (`tests/support/fake-paseo.ts`), and the adapter as a process.
`bun run test` runs it.
