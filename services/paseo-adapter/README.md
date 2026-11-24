# The Paseo adapter

The adapter is step 5 of the design loop (SPEC-design-loop.md, § The loop). It reads the design
requests that easel publishes to the hub's NATS, and starts one Paseo agent for each request. It
is not part of the easel server binary. Nothing in `src/` or `cmds/` imports it.

## What it does

1. It connects to `hub-nats` with the nkey `easel-paseo`, and binds to the durable pull consumer
   `paseo` of the stream `EASEL_REQUESTS`. The hub makes the consumer. The adapter never makes it.
2. Before each fetch, it reads the count of starts of this UTC day from
   `~/.local/state/easel-paseo-adapter/starts.json`. At 20 starts, it fetches nothing until the
   next UTC day, and logs `day-limit` one time. The messages wait in the stream (max age 1 day).
3. Before each fetch, it asks Paseo for the agents with the label `easel-loop=design`. While 2 of
   them are `initializing` or `running`, it fetches nothing, and logs `busy` one time.
4. It fetches one message. A message that is not `{canvas, n, frame, page, period}` gets a term,
   and the log line `malformed`.
5. If an agent with the label `easel-request=<canvas>:<n>` still runs, the message is a repeat.
   The adapter acks it, starts no agent, and logs `repeat`.
6. Otherwise it starts an agent with `paseo run --no-wait` in the Paseo workspace of the easel
   folder. The title is `design <canvas>#<n>`. The prompt names the canvas, the number, the frame
   and the page, and tells the agent to claim the request with
   `easel next --canvas <canvas> --n <n>`. Then the adapter counts the start, acks the message
   and logs `started`.
7. If `paseo run` fails, the adapter naks the message with a delay of 60 s, and logs
   `start-failed` with the cause. The message comes again after the delay.
8. Each agent gets `EASEL_CONFIG_HOME=~/.config/easel-agent`, so its `easel` CLI acts as the
   member `vibea-claude`, as the easel MCP tools do (`.mcp.json`). The prompt tells it to check
   with `easel whoami` first, and to use only the MCP tools if the CLI is not `vibea-claude`.
9. The agents run in Claude's auto mode, and they are non-interactive. While a design agent
   runs, the adapter reads `paseo permit ls --json` every 3 s. It denies each pending request of
   a design agent with `paseo permit deny`, and logs `denied` with the agent, the request id and
   the tool. A question to the user (`AskUserQuestion`) is a permission request too. The adapter
   never touches the requests of other agents, and never logs the text of a request.

The consumer has `max_ack_pending` 2, but the adapter acks a message right after the start. So
the adapter also counts the running agents itself (step 3).

## Run it

```sh
bun run services/paseo-adapter/main.ts
```

The log is one JSON line for each event on stdout: `bound`, `started`, `repeat`, `busy`,
`day-limit`, `malformed`, `start-failed`, `denied`, `deny-failed`, `paseo-failed`, `step-failed`,
`permit-failed`, `closed`, `stopping` and `stopped`. The log never shows the seed.

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
| `EASEL_PASEO_PROVIDER`      | `claude`                                                 |
| `EASEL_PASEO_MODE`          | `auto`                                                   |
| `EASEL_PASEO_EASEL_CONFIG`  | `~/.config/easel-agent`: the agent's `EASEL_CONFIG_HOME` |
| `EASEL_PASEO_STATE_DIR`     | `~/.local/state/easel-paseo-adapter`                     |
| `EASEL_PASEO_MAX_RUNNING`   | `2`                                                      |
| `EASEL_PASEO_MAX_PER_DAY`   | `20`                                                     |
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
