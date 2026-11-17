# Spec: cli — V1

Module `cli` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md). The shell is built with
access; each later module adds its own commands to it.

## Objective

Agents do the work through one CLI, `easel`. Each command a person could want, an agent can run.
It is the same binary as the server (`easel serve`). It talks to the server with the same calls the
page uses (rpc over the socket), sending the user's token.

This spec holds the shell that every command shares: the hosts file, the rpc client, the flags,
`--json`, the output and the exit table. Each command's journeys and answers are in the spec of the
module that owns it (see [Commands by module](#commands-by-module)).

It is made for an agent first, as paseo's CLI is:

- Every command takes `--json`. Without `--json`, it prints a short text for a person.
- A command that waits for a person (`login`) prints its pending answer at once, as its first line
  or first JSON line, then waits. Its last line is the final answer.
- A command that waits for work (`next --wait`) prints only its final answer.
- A document goes in from a file or stdin, and a picture goes out to a file, so an agent never
  pastes HTML into a flag.

## Journeys

### Sign in and out

1. `easel login <server> --name <name>` ([access](SPEC-access.md)) prints the pending answer (the
   code and when it expires) at once, then waits for an owner. It keeps the token per server in
   `~/.config/easel/hosts.json`. The first server becomes the default; `--server` picks another.
2. `easel login --no-wait` prints the pending answer and exits. `easel login --resume` waits again
   for that pending login.
3. `easel whoami` ([access](SPEC-access.md), `users.me`) prints the name, the role and the
   server.
4. `easel logout` ([access](SPEC-access.md), `login.end`) revokes the token on the server, then
   deletes it from `hosts.json`.

### Run a server

1. `easel serve` starts the server, with `PORT`, `PUBLIC_ORIGIN`, `EASEL_AUTH` and the data
   directory (`EASEL_DATA`, default `./data`) from the env.
2. `easel --help` and `easel <command> --help` list the commands and their flags.

### Wait longer than one call

1. A server call waits at most 50 s ([SPEC.md](SPEC.md#rules-for-every-module)).
2. A command that waits longer, such as `easel next --wait 600` or `easel login`, calls again until
   it has an answer or its own time is up. Each call starts a new 50 s wait.

## Commands by module

Each module's spec holds its commands' journeys and answers, and is the source of its commands.
This table lists every command by its exact name, and must match those specs. When a module's spec
adds, renames or drops a command, this table changes in the same ship.

| Module                   | Commands                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| cli                      | `serve`, `--help`                                                                                                                                |
| [access](SPEC-access.md) | `login` (`--setup`, `--no-wait`, `--resume`), `whoami`, `logout`, `users`, `users approve` (`--owner`), `users deny`, `users revoke`             |
| [ops](SPEC-ops.md)       | `status`, `errors ls` (`--open`, `--side`, `--since`), `errors show` (`--trace`), `errors resolve`, `errors hand-off`, `errors tick`             |
| [frames](SPEC-frames.md) | `canvas new`, `canvas ls`, `canvas rm`, `share` (`--password`, `--no-password`), `unshare`, `ls`, `get`, `put`, `mv`, `rm`, `shot`               |
| [queue](SPEC-queue.md)   | `next` (`--wait`, `--canvas`, `--lease`), `extend` (`--lease`), `release`, `resolve`                                                             |
| [mcp](SPEC-mcp.md)       | `mcp`                                                                                                                                            |
| [fixer](SPEC-fixer.md)   | `errors claim`, `errors extend`, `errors note-issue`, `errors note-fix`, `errors resolve --claim` (`--wait`), `errors give-up`, `errors release` |

`errors resolve` is ops' command; with `--claim` it is the fixer's (`fixer.resolve`).

## Contract

The exit code reads the call's success kinds: the one list that its contract marks
([SPEC.md](SPEC.md#rules-for-every-module)). MCP's `isError` reads the same list.

| Answer                                       | Exit | Prints with `--json`     |
| -------------------------------------------- | ---- | ------------------------ |
| a kind on the call's success list            | 0    | the answer               |
| any other kind (`gone`, `stale`, ...)        | 1    | the answer               |
| a refusal (`signIn`, `owner`)                | 2    | `{ refused: <payload> }` |
| bad flags or arguments                       | 64   | `{ usage: <text> }`      |
| the server found the input wrong (`invalid`) | 65   | `{ invalid: <issues> }`  |
| the server cannot be reached (`link`)        | 69   | `{ unreachable: <url> }` |
| the server threw (`failed`, `encode`)        | 70   | `{ failed: <traceId> }`  |
| the server lacks the call (`missing`)        | 76   | `{ missing: <call> }`    |

Exit codes past 2 follow BSD `sysexits.h`: 64 usage, 65 data, 69 unavailable, 70 software, 76
protocol. Each of Tinker's seven faults has a row: `decode` exits 70, as `encode` does.

A waiting command that prints a pending answer first takes its exit code from its last answer.

`empty` is a success kind of `comment.next`: a poll that finds no work is a normal answer, as SQS
`ReceiveMessage` with no messages. So `easel next` exits 0 with `{ kind: "empty" }`
([queue](SPEC-queue.md)).

## Rules

### Fact rules (the code graph decides)

1. The CLI cmd is the only place that reads `~/.config/easel` and its flags. It reaches the server
   only through the rpc client.
2. Only the cmds read the env; no operation reads `process.env`.
3. The exit code comes from the contract's success list. The CLI keeps no list of its own.

### Judged rules (need reading the code)

1. The exit code follows the table above, for every command.
2. `hosts.json` is written with mode 0600, and the token is never printed except by
   `easel login --json`.
3. A refusal says what to do next in its text: log in again, or ask an owner.
4. A waiting command never makes one server call that waits more than 50 s.

## Success Criteria

- A test drives each command against a server in the same process, and checks its exit code and
  its `--json` output.
- A test of `easel login` reads the pending answer from the first line before an owner approves.
- An agent with only a shell and this binary can run every agent journey in every module spec.

## Out of Scope (Deferred)

- Shell completions.
