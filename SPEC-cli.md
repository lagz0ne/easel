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

A team gets the CLI from its own easel, and an agent that runs in a new place each time (a GitHub
run, E4.5) signs in from the env (epics R2, A8). Prior art:

- Bun, Deno and flyctl install with `curl -fsSL <url> | sh`, from the binaries of a GitHub release.
- Coder serves the install script from each deployment, so the CLI is the build of that server.
- `gh` reads `GH_TOKEN` and `GH_HOST`, and Coder reads `CODER_SESSION_TOKEN` and `CODER_URL`, in
  place of their files. `gh auth token` prints a token for a secret.

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

### Get the command line

1. The team lead runs `curl -fsSL https://<easel>/install.sh | sh`. The easel answers the script
   with no sign-in. The script holds the address and the build of that easel.
2. The script finds the system: `darwin-arm64`, `linux-x64` or `linux-arm64`. It gets the binary of
   that build from the GitHub release `build-<BUILD>` of the repository, and checks its SHA-256
   against the `SHA256SUMS` file of the release. It puts the binary in `~/.local/bin/easel`, or in
   `$EASEL_BIN_DIR`, and prints the next step: `easel login https://<easel> --name <name>`.
3. On another system, or when the sum is wrong, the script installs nothing, and says why. A
   download that fails installs nothing too.
4. The deploy workflow builds the three binaries (`bun build --compile --target`) and the sums for
   each build, and puts them on the release before the image goes live. The server image does not
   carry them.

### Sign in with no file

1. The team lead runs `easel login https://<easel> --name github --print-token`. It asks for access
   as "Join a server" does ([access](SPEC-access.md#join-a-server)), but keeps nothing in
   `hosts.json`. When an owner approves, it prints the token one time, on stdout. A stopped
   `--print-token` cannot resume: the team lead asks again.
2. The team lead puts the token in a secret of GitHub Actions, `EASEL_TOKEN`, and the address in
   `EASEL_SERVER`. The run installs the CLI with the line of "Get the command line".
3. When `EASEL_TOKEN` is set, the CLI uses it with `EASEL_SERVER`, and does not read or write
   `hosts.json`. `EASEL_TOKEN` with no `EASEL_SERVER` exits 64, and says so. A `--server` that is
   not `EASEL_SERVER` exits 64 too.
4. With `EASEL_TOKEN`, `easel logout` changes nothing and exits 64: a run must not remove its own
   user. An owner stops it with `easel users revoke github`. `easel login` and `login --resume`
   exit 64 too, because they keep a token in `hosts.json`; `login --print-token` keeps nothing, so
   it works.
5. When the server refuses `EASEL_TOKEN`, the CLI exits 2 and says to get a new token with
   `--print-token`.

### Wait longer than one call

1. A server call waits at most 50 s ([SPEC.md](SPEC.md#rules-for-every-module)).
2. A command that waits longer, such as `easel next --wait 600` or `easel login`, calls again until
   it has an answer or its own time is up. Each call starts a new 50 s wait.

## Commands by module

Each module's spec holds its commands' journeys and answers, and is the source of its commands.
This table lists every command by its exact name, and must match those specs. When a module's spec
adds, renames or drops a command, this table changes in the same ship.

| Module                   | Commands                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cli                      | `serve`, `--help`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [access](SPEC-access.md) | `login` (`--setup`, `--no-wait`, `--resume`, `--print-token`), `whoami`, `logout`, `users`, `users approve` (`--owner`), `users deny`, `users revoke`                                                                                                                                                                                                                                                                                                                         |
| [ops](SPEC-ops.md)       | `status`, `errors ls` (`--open`, `--side`, `--since`), `errors show` (`--trace`), `errors resolve`, `errors hand-off`, `errors tick`                                                                                                                                                                                                                                                                                                                                          |
| [frames](SPEC-frames.md) | `canvas new`, `canvas ls`, `canvas rm`, `share` (`--password`, `--no-password`), `unshare`, `ls`, `get`, `put`, `mv`, `rm`, `shot`                                                                                                                                                                                                                                                                                                                                            |
| [queue](SPEC-queue.md)   | `next` (`--wait`, `--canvas`, `--n` with `--canvas`, `--lease`), `extend` (`--lease`), `release` and `decline` (`--reason`), `ask` (`--text`, `--html <file>`, `--option`, up to 6), `resolve` (`--text`, `--html <file>`), `requests` (`--canvas`, `--state`), `edit <canvas> <n>` (`--text`), `close <canvas> <n>` (`--text`), `deliveries <canvas> <n>`, `channel set <name> github` (`--repo`, `--label`, `--trigger`, `--token-file`), `channel ls`, `channel rm <name>` |
| [mcp](SPEC-mcp.md)       | `mcp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [fixer](SPEC-fixer.md)   | `errors claim`, `errors extend`, `errors note-issue`, `errors note-fix`, `errors resolve --claim` (`--wait`), `errors give-up`, `errors release`                                                                                                                                                                                                                                                                                                                              |

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
| the hosts file cannot be read                | 78   | `{ config: <path> }`     |
| stopped by Ctrl-C (a waiting login is kept)  | 130  | nothing                  |

Exit codes past 2 follow BSD `sysexits.h`: 64 usage, 65 data, 69 unavailable, 70 software, 76
protocol, 78 config; 130 is 128 + SIGINT. Each of Tinker's seven faults has a row: `decode` exits
70, as `encode` does. A call with no answer after 60 s (the server's 50 s, and a margin) is a
`link` fault: a socket that is open on one end only cannot hang a command.

A waiting command that prints a pending answer first takes its exit code from its last answer.

`empty` is a success kind of `request.next`: a poll that finds no work is a normal answer, as SQS
`ReceiveMessage` with no messages. So `easel next` exits 0 with `{ kind: "empty" }`
([queue](SPEC-queue.md)).

`GET /install.sh` (no sign-in) answers the script of "Get the command line", as
`text/x-shellscript`, with the `PUBLIC_ORIGIN` and the `BUILD` of the server in it.

## Rules

### Fact rules (the code graph decides)

1. The CLI cmd is the only place that reads `~/.config/easel` and its flags. It reaches the server
   only through the rpc client.
2. Only the cmds read the env; no operation reads `process.env`.
3. The exit code comes from the contract's success list. The CLI keeps no list of its own.

### Judged rules (need reading the code)

1. The exit code follows the table above, for every command.
2. `hosts.json` is written with mode 0600. The token is never printed, also not with `--json`,
   except one time on stdout by `login --print-token`.
3. A refusal says what to do next in its text: log in again, or ask an owner.
4. A waiting command never makes one server call that waits more than 50 s.
5. With `EASEL_TOKEN` set, no command reads or writes `hosts.json`.
6. The install script installs only a binary whose SHA-256 is the one in the `SHA256SUMS` of its
   build.

## Success Criteria

- A test drives each command against a server in the same process, and checks its exit code and
  its `--json` output.
- A test of `easel login` reads the pending answer from the first line before an owner approves.
- An agent with only a shell and this binary can run every agent journey in every module spec.
- On a clean machine of each of the three systems, the install line gives a CLI of the build of the
  easel, and its next step signs in.
- A run with only `EASEL_TOKEN` and `EASEL_SERVER` takes a request with `easel next`, and leaves no
  file.

## Out of Scope (Deferred)

- Shell completions.
- Windows, and other systems. Add one when a team needs it.
- A package manager (Homebrew, npm). Add it when a team asks for it.
