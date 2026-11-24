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

The consumer has `max_ack_pending` 2, but the adapter acks a message right after the start. So
the adapter also counts the running agents itself (step 3).

## Run it

```sh
bun run services/paseo-adapter/main.ts
```

The log is one JSON line for each event on stdout: `bound`, `started`, `repeat`, `busy`,
`day-limit`, `malformed`, `start-failed`, `paseo-failed`, `step-failed`, `closed`, `stopping`
and `stopped`. The log never shows the seed.

## Environment

| Variable                    | Default                                       |
| --------------------------- | --------------------------------------------- |
| `EASEL_PASEO_NATS_URL`      | `nats://127.0.0.1:4222`                       |
| `EASEL_PASEO_SEED_FILE`     | `~/.config/secrets/hub-nats/easel-paseo.nk`   |
| `EASEL_PASEO_INBOX`         | `_INBOX_easel_paseo`                          |
| `EASEL_PASEO_STREAM`        | `EASEL_REQUESTS`                              |
| `EASEL_PASEO_CONSUMER`      | `paseo`                                       |
| `EASEL_PASEO_BIN`           | `paseo`                                       |
| `EASEL_PASEO_WORKSPACE_DIR` | `~/dev/easel`                                 |
| `EASEL_PASEO_PROVIDER`      | `claude`                                      |
| `EASEL_PASEO_MODE`          | `bypassPermissions`                           |
| `EASEL_PASEO_STATE_DIR`     | `~/.local/state/easel-paseo-adapter`          |
| `EASEL_PASEO_MAX_RUNNING`   | `2`                                           |
| `EASEL_PASEO_MAX_PER_DAY`   | `20`                                          |
| `EASEL_PASEO_POLL_MS`       | `5000`: the wait over a limit, and the fetch  |
| `EASEL_PASEO_NAK_MS`        | `60000`: the delay after a failed `paseo run` |

## The user unit

`~/.config/systemd/user/easel-paseo-adapter.service`:

```ini
[Unit]
Description=easel Paseo adapter: a Paseo agent for each design request (EASEL_REQUESTS/paseo)
After=hub-nats.service paseo.service
Wants=hub-nats.service paseo.service

[Service]
Type=simple
WorkingDirectory=%h/dev/easel
Environment=PATH=%h/.local/bin:%h/.npm-global/bin:/usr/local/bin:/usr/bin:/bin
Environment=EASEL_PASEO_SEED_FILE=%h/.config/secrets/hub-nats/easel-paseo.nk
ExecStart=%h/.local/bin/bun run %h/dev/easel/services/paseo-adapter/main.ts
Restart=on-failure
RestartSec=10
SyslogIdentifier=easel-paseo-adapter

[Install]
WantedBy=default.target
```

See the log with `journalctl --user -u easel-paseo-adapter -f`.

## Tests

`tests/paseo-adapter.test.ts` starts a local `nats-server -js` with a stream and a consumer as the
hub has them, a fake `paseo` (`tests/support/fake-paseo.ts`), and the adapter as a process.
`bun run test` runs it.
