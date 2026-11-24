# Spec: ops — V1

Module `ops` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md). Every other module reports
its failures here, and registers its own readiness checks and counters. The agent that fixes the
errors is the [fixer](SPEC-fixer.md) module, built last.

## Objective

easel is run and fixed by agents. Every failure becomes a fact that an agent can read, reproduce
and fix, then prove fixed, with no person in the loop. A person sees the state, and is called only
when the agents give up or the fix is not a code change. ops holds the facts: the error groups,
their status, the build each one was fixed in, readiness and backups. The fixer acts on them.

In Round 1 ([epics](docs/epics.md#round-1-get-started)), the company runs one easel for each team,
and the fixer (E7) is deferred. So a person of the company acts on what ops shows (E6). Each check,
copy and alarm below is for one easel, and the company has one of each for each team.

Prior art:

- Sentry's issues: events are grouped by a fingerprint. An issue is resolved in a release, and
  marked "regressed" when it comes back in a later release.
- Kubernetes probes: liveness says the process should restart; readiness says it can take traffic.
- The Google SRE book: alert on symptoms, give each alert a runbook, and watch the watcher.
- Litestream: it streams each change of a SQLite database to S3 within seconds. It is a second
  process, and it takes control of the checkpoints of the database. A copy each 30 minutes, made
  with the `VACUUM INTO` that ops has, meets R5 (at most 1 hour lost) with no second process. Add
  Litestream when a team needs to lose less than 30 minutes.
- Backups that the source cannot delete: restic's append-only mode, and an S3 key that can only put
  objects. A lifecycle rule of the bucket, not the server, deletes old copies.

## Built on Tinker

Most of what ops needs is in the Tinker base already. ops adds one store and the calls that read
it. It adds no logging inside the operations.

| Exists in the base                                                                       | ops adds                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Every operation is a span (`tinker/components/telemetry`); a throw ends it in error      | An error sink: a reader of that record stream                 |
| A thrown call reaches the client as a `failed` fault with a trace id and an execution id | `easel errors show --trace <id>` finds the group from that id |
| Page errors arrive as browser records on `POST /api/telemetry`                           | The same sink groups them, with `side: "browser"`             |
| `observeServerPanics` closes the server on an unhandled rejection                        | It also covers `uncaughtException`, and writes to the store   |
| `tinker.health` answers `GET /api/health`                                                | `ops.ready` for `GET /api/ready`, and `ops.status`            |
| The `release` capsule knows the commit                                                   | The build number, and the builds each error was seen on       |
| Telemetry export over OTLP to the Victoria stack ([Telemetry export](#telemetry-export)) | A base change: export is off when its endpoints are not given |

Other modules register with ops; ops does not depend on them. A module adds a named readiness check
(frames: Chromium; the server: the database and free disk on `/data`) and its counters (queue:
depth, oldest waiting request, leases that ran out, requests that need a person). These are a list in a tag, as `routes` gathers
its table. The [fixer](SPEC-fixer.md) registers one more entry the same way: which group has a live
fixer lease, and which claim holds it. ops reads it, and still imports no other module.

## The build number

A commit sha cannot say whether one build comes after another. Every image carries `BUILD`, the
count of commits on main (`git rev-list --count HEAD`, full history). main is one straight line,
so a larger number is a later build that contains every earlier one. `/api/version` answers
`{ commit, build, client }`. `client` is the page script of the build, or null for a server run
from source. A tab compares it to see a new version of the page (SPEC-viewer.md § The page 4).

## Journeys

### An agent checks the server

1. `easel status --json` prints:
   - the commit and build number, and the uptime;
   - each readiness check, with its detail;
   - each module's counters;
   - the error counts for the last hour and the last day, how many are open, how many of those are
     unconfirmed (browser only), and how many new groups were dropped at the cap;
   - when the fixer's tick last ran (`fixerSeen`), and whether it is silent.
2. `GET /api/health` is liveness: it answers while the process can serve. `GET /api/ready` answers
   200 only when every readiness check passes, and 503 otherwise. It is public, so it names the
   failing checks and gives no detail.
3. `/api/ready` also carries `fixerSeen` and `fixerSilent`, with either status code. `fixerSilent`
   is true when more than 30 minutes have passed since the stored `fixerSeen`. Only when no
   `fixerSeen` is stored does it count from the server's start. A restart does not reset it. The
   server works it out on its own clock, so a reader needs no token and no clock of its own. A
   silent fixer does not make the server unready: it can still take traffic.
4. The fixer's tick stamps `fixerSeen` with `easel errors tick` on every run, whether or not there
   is work ([fixer](SPEC-fixer.md)). The stamp is kept in memory and in the store, so a full disk
   does not stop it.

### An error is recorded

1. An operation throws (its span ends in error), a record is logged at level error or above, the
   server panics, or a page reports an uncaught error through `POST /api/telemetry`.
2. The error sink records it under a fingerprint: the SHA-256, in hex, of the side, the span name
   (the operation's label), the error's name, and its message with numbers, ids, hex and quoted
   values taken out. The server ships minified, so a stack frame is not stable and is not part of
   it.
3. It keeps the first and last time seen, the count, the builds it was seen on (and the highest of
   them, `lastBuild`), the last trace id, and one sample message with secrets removed. The sample
   is for owners only.
4. An answer `kind` and a `refused` fault are not errors. They are the contract working.
5. `POST /api/telemetry` checks only the `Origin` header, which any client can forge. So a group
   seen only on the browser side is unconfirmed. It is counted and shown, but it never starts a
   fix and never opens an issue. The side is part of the fingerprint, so a browser group never
   turns into a server group: `confirmed` is `side === "server"`.

### An error group moves through its states

1. A new fingerprint opens a group: `open`.
2. `easel errors resolve <fingerprint> --build <n>` (`ops.resolveError`), where `n` is the build of
   the fix:
   - `notLive { live }` while the live build is older than `n`. Nothing changes. A newer push may
     cancel the fix's own deploy, so the proof is "live build ≥ n", not "live commit = the fix".
   - `failing { seen }` when the group was already seen on a build ≥ `n`: the fix is live and the
     error still happens. Nothing changes.
   - `resolved` otherwise: the status is `resolved` and `fixedIn` is `n`.
   - `held` while a fixer lease is live on the group. Nothing changes. The rpc call carries no
     claim, so it never moves a group a fixer holds. The fixer resolves under its claim, with
     `fixer.resolve`, which runs the same operation with the claim that holds the lease.

   The call answers at once; it never waits on the server (SPEC.md, Waits). The fixer's command
   loops on `notLive` ([fixer](SPEC-fixer.md)).

3. When a `resolved` group is seen again on a build ≥ `fixedIn`, it is `regressed`. `fixedIn`
   stays, so the reader sees which fix it beat. A sighting on an older build (an old tab, a stale
   page) changes nothing.
4. `easel errors hand-off <fingerprint> --reason <text>` (`ops.handOff`) sets `human`: a person
   takes it. While a fixer lease is live on the group, it answers `held` and changes nothing. The
   fixer hands off under its claim, with `fixer.giveUp`, when it gives up. A `human` group stays
   `human` when seen again; only `resolve` moves it on.
5. `open` and `regressed` groups are the work list (`easel errors ls --open`).

### A person sees the state

1. `easel status` and `easel errors ls` show each group and its status. The issues that the
   [fixer](SPEC-fixer.md) files (`prod-error`, `needs-human`, `prod-down`) show what was done.
2. On this host, the traces and logs are in Victoria (`obsq`, Grafana at obs.vibea.dev), found by
   the trace id on each group.

### The data is safe

1. Every 30 minutes, easel writes a copy of its database to `/data/backups` (`VACUUM INTO`). It
   keeps the copies of the last 24 hours and one copy for each of the last 7 days. It stops making
   copies when they would take more than a quarter of the free disk.
2. Before a migration runs at start, it writes one more copy.
3. After each copy, easel sends it off the host: gzip, then one put to an S3-compatible bucket on a
   second host, with Bun's `S3Client` (no new package). The object key is
   `<EASEL_NAME>/<UTC time>-<build>.db.gz`. `EASEL_NAME` is the name of the easel of the team. A
   put that fails is tried again after 1 and 5 minutes. After that, the next copy tries again.
4. The access key (`BACKUP_S3_*`) can only put objects under the prefix of its own easel. It cannot
   read, list or delete. A server that an attacker controls cannot delete its copies, and cannot
   read the copies of another team.
5. The bucket deletes each object 5 days after its put (a lifecycle rule). When a team leaves and
   its easel is deleted, no copy of its work is left after 7 days (R8), with no step for a person.
6. `/api/ready` carries `backupAt`, the time of the last good put, and `backupLate`. `backupLate`
   is true when more than 2 hours have passed since `backupAt`, or since the start when there is no
   `backupAt`. As `fixerSilent`, it does not make the server unready. With no `BACKUP_S3_*`, easel
   makes no put, so `backupLate` becomes true: an easel with no copy off the host is seen.
7. A check outside the host reads `/api/ready` of each easel each minute. It tells a person of the
   company when an easel answers 503, or does not answer for 5 minutes (H3), and when `backupLate`
   is true (H12). The hub runs it ([SPEC.md](SPEC.md#open-questions), question 4).
8. `docs/runbook.md` tells a person what to do for each readiness check and for `backupLate`, and
   how to restore an easel from a copy off the host. A person of the company does a restore with
   only these steps before the first team starts (R5, H13).

## Telemetry export

Decided on 2026-11-24, for the user's ask: "Keep track of performance tracing and logging there for
all interactions end to end". Prior art: the OpenTelemetry SDK environment variables and its batch
processor, which drops a batch that the exporter cannot send. The hub's OpenTelemetry Collector
(`otlp-ingest`) sends traces to VictoriaTraces and logs to VictoriaLogs.

### Why the traces stopped and the logs never came (root cause)

1. `VICTORIA_LOGS_URL` was `http://otlp-ingest:4318/v1/logs`, the OTLP logs path of the collector.
   The server sent VictoriaLogs JSON lines there, so the collector refused each log batch.
2. The export queue kept each refused record at its head. A batch takes the first 64 records, so
   the refused logs filled each next batch, and then the queue cap of 512. After that, the queue
   dropped each new span. Only the spans of the server start reached VictoriaTraces.

### The env contract

| Variable                             | Use                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `OTEL_SERVICE_NAME`                  | Required. The service name of the server (`easel`)                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | The base URL. Traces go to `<base>/v1/traces`, logs to `<base>/v1/logs` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | The full traces URL, in place of the one from the base                  |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`   | The full logs URL, in place of the one from the base                    |
| `OTEL_RESOURCE_ATTRIBUTES`           | `key=value` pairs with commas between them, on each span and log line   |
| `GIT_SHA`                            | The commit. It is `service.version` on each span and log line           |

A kind with no endpoint is not sent. The `VICTORIA_*` variables have no use now.

### Rules of the export

1. Both kinds go as OTLP/HTTP JSON, batched and sent from the telemetry worker thread.
2. The tab sends its spans and logs to `POST /api/telemetry`. The server sends them with the
   service name `<OTEL_SERVICE_NAME>-web` (`easel-web`) and its own version and resource attributes.
3. A tab call over `/rpc` carries a W3C `traceparent`, so the server spans of the call are in the
   trace of the tab span.
4. A log line carries the trace id and the span id of the span that was open when it was written.
   An uncaught error of the tab is a log line `tab error` at level error.
5. Each interaction on the server (a root operation span: an rpc call, a watch, a route, a push)
   gives one log line at level info: its name, `ms`, `outcome` and, when it has one, `exit` (the
   answer kind). Tinker writes one error line for each failed operation, so a failed interaction
   has that error line and no info line. A step inside an interaction gives no line. The
   `core.span` line of each span goes to stdout only.
6. A batch that the store refuses is dropped and counted in `dropped`. It does not stop the next
   batch, of the same kind or of the other kind.
7. Before a record leaves the server, a redaction step changes its text. It removes the value of
   an attribute whose name has `token`, `password`, `secret`, `key`, `authorization`, `cookie`,
   `pass` or `share` in it. In each other value, the log message and the error text, it removes a
   document (text from the first tag on), a bearer or basic credential, a `name=value` pair with
   such a name, and each run of 20 or more token letters with a digit in it. That run covers share
   link secrets, picture keys and tokens.
8. The picture draws (`pictures.route`, `pictures.draw`, `pictures.render`, `pictures.drawPage`)
   are spans with the answer kind in `tinker.exit`. A Chromium that does not answer shows as
   `late` or as a failed span.
9. A health call that ends well and in less than 250 ms gives no span and no log line. A health
   call is a span named in `telemetry.healthSpans` (default `tinker.health`, the answer of
   `GET /api/health`). A failed or slow health call is exported as each other call. Why: the Swarm
   health check calls `/api/health` each second (hq-2w6), and the site probe each 30 s, so the
   health calls were most of the records. Prior art: the filter processor of the OpenTelemetry
   Collector, and APMs that drop health-check spans by default.
10. A value of a log or span attribute is the plain value. A string has no quotes (`ok`, not
    `"ok"`). A number or a boolean is its text (`3`, `true`). An object or a list is its JSON.
11. In VictoriaLogs, the level of a line is in `severity_text` (`INFO`, `WARN`, `ERROR`) and
    `severity_number` (9, 13, 17). The trace id is in `trace_id`, the span id in `span_id`, the
    message in `_msg`, and the service in `service.name`.

## Contract

Each call lists its success kinds (SPEC.md, Success kinds). A call with no `kind` succeeds with its
one answer.

```ts
// routes, no sign-in
"GET /api/health":  tinker.health                          // exists
"GET /api/version": { commit: string; build: number }
"GET /api/ready":   200 { failing: []; fixerSeen: number | null; fixerSilent: boolean;
                          backupAt: number | null; backupLate: boolean }
                  | 503 { failing: string[]; fixerSeen: number | null; fixerSilent: boolean;
                          backupAt: number | null; backupLate: boolean }
// rpc, a user
"ops.status":       { commit; build; uptime; checks: Check[]; counters: Record<string, number>;
                      errors: { hour; day; open; unconfirmed; dropped };
                      fixerSeen: number | null; fixerSilent: boolean }
// rpc, an owner (refused { owner: true } otherwise)
"ops.errors":       { errors: ErrorGroup[] }               // --open, --side, --since
"ops.error":        { kind: "found"; error: ErrorGroup; samples: Sample[] } | { kind: "gone" }
                    // by fingerprint, or by the trace id of a `failed` fault.   success: found
"ops.resolveError": { kind: "resolved" } | { kind: "notLive"; live: number }
                  | { kind: "failing"; seen: number } | { kind: "held" } | { kind: "gone" }
                    // fingerprint, build.                                       success: resolved
"ops.handOff":      { kind: "handed" } | { kind: "held" } | { kind: "gone" }
                    // fingerprint, reason.                                      success: handed
"ops.fixerTick":    { kind: "stamped"; at: number }        //                    success: stamped
```

```ts
ErrorGroup = { fingerprint; side: "server" | "browser"; label; name; message; count; firstSeen;
  lastSeen; builds: number[]; lastBuild: number; traceId;
  status: "open" | "resolved" | "regressed" | "human"; fixedIn: number | null; reason: string | null }
Check = { name; ok; detail }
```

CLI: `easel status`, `easel errors ls`, `easel errors show`, `easel errors resolve`,
`easel errors hand-off`, `easel errors tick`.

## Rules

### Fact rules (the code graph decides)

1. The error sink is the only writer of an error group's sightings. It reads Tinker's telemetry
   records; no operation calls it, except the panic path (fact rule 5), which records the panic
   before it exits: a crash leaves no telemetry record for the sink to read.
2. Every `ops.*` rpc call runs the `user` guard. Every one but `ops.status` runs the `owner` guard
   next.
3. The sink and `ops.resolveError` take time from the run's `clock`, and the build from the
   `release` capsule.
4. The server starts without Victoria. Telemetry export is on only when its OTLP endpoints are given.
5. The panic path writes to the store before it calls `exit`.
6. ops imports no later module; it depends only on access. Modules reach ops only through the
   checks and counters tag.
7. No `ops.*` call waits on the server.
8. `ops.resolveError` and `ops.handOff` read the fixer lease entry first. While a lease is live on
   the group, and the run holds no claim that matches it, they answer `held` and write nothing.
   `held` is not a success: the CLI exits 1, and MCP sets `isError`.

### Judged rules (need reading the code)

1. A sample never holds a token, a password, a share pass, or a frame's document.
2. Recording is bounded: one write per group per second at most, and a capped message length. An
   error storm cannot fill the disk.
3. At most 1000 groups are kept. Past that, the oldest `resolved` group goes first, then the oldest
   unconfirmed one. A confirmed group that is `open`, `regressed` or `human` is never dropped; when
   no group can go, the new one is counted in `dropped` and not stored.
4. A dropped `resolved` group keeps its fingerprint and `fixedIn` (a retired list, at most 10 000,
   oldest out). When it is seen again on a build ≥ `fixedIn`, it comes back as `regressed`, not as a
   new group.
5. A fingerprint has no line numbers, ids, numbers or times in it, so it is the same across builds.
6. A group is marked `regressed` only when it is seen on a build ≥ its `fixedIn`.
7. A group is `resolved` with `fixedIn = n` only when the live build is ≥ `n` and it was never seen
   on a build ≥ `n`.
8. Shutdown drains: on SIGTERM, the server stops taking work, finishes the writes in flight, then
   exits.
9. If the store itself fails, the panic still reaches stderr.
10. A copy is whole: `VACUUM INTO` writes it, and a put sends a finished file only. A restore of any
    copy opens with no repair.
11. The backup key gives only a put under the prefix of its easel. No log, sample or status shows
    it.

## Statecharts

[docs/statecharts/ops-issues.md](docs/statecharts/ops-issues.md): one error group from its first
sighting to `resolved` or a person, with the fixer as one actor. [docs/statecharts/ops-issues-person.md](docs/statecharts/ops-issues-person.md):
the same group when an owner resolves it or hands it off, with no claim.

## Success Criteria

- An error thrown on purpose in production makes an `open` group with its build, trace id and
  sample.
- `resolve` answers `notLive` before the fix's build is live, `failing` when the error was seen on
  that build or later, and `resolved` otherwise.
- A regression on a build ≥ `fixedIn` marks the group `regressed`, also after the group was dropped
  at the cap. A sighting on an older build does not.
- A browser-only group, posted with a forged `Origin`, is counted as unconfirmed.
- `/api/ready` turns 503 when `/data` is not writable, and back to 200 when it is.
- `/api/ready` shows `fixerSilent` 30 minutes after the last `easel errors tick`, and not before,
  also when the server restarted in between. A server with no tick ever counts from its start.
- Restoring from the newest backup is tested, and the runbook's steps work.
- A copy reaches the bucket within 1 minute of its `VACUUM INTO`. A restore from the bucket gives
  each canvas, frame, share link and request as it was at the copy.
- With the bucket down for 2 hours, `/api/ready` shows `backupLate`, and the outside check tells a
  person. The next good put clears it.
- The backup key cannot read, list or delete an object, and cannot put under another prefix.

## Out of Scope (Deferred)

- Paging a person by phone. The outside check tells a person in the way that the hub has (step 7
  of "The data is safe").
- Litestream, and a loss of less than 30 minutes. Add it when a team needs it.
- Prometheus `/metrics`: counters are in `ops.status`; traces and logs go to Victoria.
- Grouping errors with AI, as Sentry does: the fingerprint is plain and stable.
- Mapping minified stacks back to source: the sourcemap is built, but not used for grouping.
