# Spec: easel — V1

## Objective

easel is an endless canvas of frames, where each frame is one HTML document that an agent wrote.
People look and ask for changes. Agents do the rest.

- **Agent first.** One CLI, `easel`, does everything, as paseo's CLI does. Every command takes
  `--json`, and its exit codes say what happened, so an agent never needs a browser.
- **People look and ask.** A person opens a share link, pans and zooms, asks for changes at a
  place on a frame or on the canvas, and watches the frames and the requests change as agents
  work.
- **One queue.** Requests form one queue that agents take oldest first, with a lease. Each try
  ends with an outcome: a result with its proof, a question for a viewer, or a decline to a
  person. A viewer accepts a result, or opens the request again.
- **Server-authoritative, with optimistic concurrency.** Each write names the version it read. The
  first write on a version wins; a later write on the same version answers `stale`, and the writer
  reads again. This is HTTP `If-Match` with `412`, or CouchDB's `_rev`. There is no CRDT.
- **Access by approval.** A user is created on demand by a one-time code that an owner approves.
  Users share canvases by link, with an optional password. A viewer edits nothing.

Success: an agent signs in, makes a canvas, puts frames, and shares the link. A person asks for a
change on a frame. An agent takes that request, changes the frame, and resolves it with the frame
before and after. The person sees each step live at https://easel.vibea.dev, and accepts the
result.

## Capability map

| Module id | Responsibility                                                                                                    | Depends on                         |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| access    | Users, login codes, owner approval, tokens, the `user` and `owner` guards                                         | none                               |
| cli       | The `easel` shell, built with access: serve, hosts file, rpc client, `--json`, the exit table                     | access                             |
| ops       | Errors grouped for agents, issues (list, resolve, regressed), status, readiness, build, backups                   | access                             |
| kit       | The look and the kit of the easel: look values, pieces, kit versions, the make step, the check, `compose`         | access                             |
| frames    | Canvases and frames: documents, versions, boxes, pictures; share links, passwords, passes, `mayRead`              | access, ops, kit                   |
| queue     | Requests: a viewer asks; a dispatcher delivers to channels; agents claim (lease) and end each try; viewers decide | access, frames, ops, kit           |
| mcp       | The same calls as MCP tools: `/mcp` over HTTP, `easel mcp` on stdio                                               | access, frames, queue, ops, kit    |
| design    | easel's own design system: tokens, type, the few controls the page uses                                           | none                               |
| viewer    | The browser page: shells, live frames, pan and zoom, pins, the requests panel                                     | access, frames, queue, design, kit |
| fixer     | An agent that fixes production errors: claims a group, opens one issue, ships a fix, proves it                    | access, ops, cli                   |

The "Depends on" column is the one source of each module's dependencies. Each module spec's
header copies it, and changes with it in the same ship.

Build order: access → cli shell → ops → frames slice (canvas, frames, share without password) →
viewer canvas slice → pictures and passwords → queue → viewer pins and queue panel → mcp → fixer.

- The cli shell lands right after access, as its own unit, because `easel login` is access's first
  journey. Each later module adds its own commands to the shell.
- The frames and viewer canvas slices come before pictures, passwords and the queue: a walking
  skeleton, so a person sees the canvas early.
- ops comes second, so every module after it is watched from its first deploy. ops depends on no
  later module: frames and queue register their readiness checks and counters with it.
- Share lives in frames, because a link and its passes guard reads of a canvas (`mayRead`).
- kit (E8) comes after the queue in time, as Round 1 has it: it changes what frames, pictures and
  requests keep, so those specs change with it. Its own build order is in
  [the decision](docs/decisions/kit-on-tailwind.md).
- fixer comes last. It fixes errors in every other module, so it needs them built and sending
  errors.

Each module's journeys, contract and rules are in `SPEC-<module id>.md`: [access](SPEC-access.md),
[cli](SPEC-cli.md), [ops](SPEC-ops.md), [frames](SPEC-frames.md), [queue](SPEC-queue.md),
[mcp](SPEC-mcp.md), [design](SPEC-design.md), [viewer](SPEC-viewer.md), [fixer](SPEC-fixer.md),
[kit](SPEC-kit.md).
The CLI commands that belong to a module are in that module's spec. `SPEC-cli.md` holds the shell
and the list of commands by module.

## Rules for every module

1. **Success kinds.** Each contract call marks which of its answer kinds are a success, in one list
   beside the call in `contract.ts`. The CLI's exit code and MCP's `isError` both read that list.
   No other place decides what a success is.
2. **Waits.** A wait on the server lasts at most 50 s, under the socket's 60 s idle timeout. A
   client that wants to wait longer calls again: the CLI loops, and an MCP agent calls the tool
   again.
3. **Size.** The server sets `ws.maxPayload` itself, not by default. A `tooBig` answer is measured
   on the document's UTF-8 bytes, not its string length ([frames](SPEC-frames.md)). `maxPayload`
   sits above that limit, so a document a little too big gets `tooBig`, not a closed socket. It is
   16 MiB, so an image frame of 10 MiB in base64 fits (SPEC-frames § Image frames). Over HTTP, a
   route takes a body of 1 MiB at most, and `/mcp` takes 16 MiB, as the socket does
   ([mcp](SPEC-mcp.md)).
   `frame.shot` answers a picture URL, and the client
   fetches the picture over HTTP, so no picture crosses the socket.
4. **Rate limits.** A limit counts per client address. The address comes from `X-Forwarded-For`,
   read from the right past each trusted proxy (Traefik, Cloudflare): never an entry the client
   sent. A
   limit is never kept only per link or only for the whole server.

## Statecharts are the oracle

Each flow with state has a statechart: a TLA+ model, checked with TLC and drawn as Mermaid. They
are in [docs/statecharts](docs/statecharts/README.md).

- Each rule in a chart is a test target. The module's tests reach each rule, and the code must
  behave as the chart shows.
- A chart changes only with its spec, in the same ship.
- `scripts/statecharts.sh --check` must be clean: every chart is as committed, and every rule holds
  as its chart says. `scripts/ship.sh` runs it as a gate for a ship that changes a chart or a spec,
  on this host; CI does not.

## Built on Tinker

Tinker is the base of every module. A module adds features on Tinker's pieces, and does not build
a second set beside them.

| Need                        | Tinker piece                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A feature                   | A capsule (`src/<module>/index.ts`), filled with config only in a cmd                                          |
| An action                   | An operation: label, zod input, depends, run, and an answer `kind` union                                       |
| Server state, live          | A remote data board, served over the one socket (`/rpc`)                                                       |
| A call from the page or CLI | An rpc contract (`contract.ts`) with its server operations                                                     |
| Who may call                | Guards in `onStart`: `input.refuse(...)` ends the call as a `refused` fault                                    |
| A failure                   | Tinker's seven faults: `refused`, `failed` (with a trace id), `invalid`, `encode`, `decode`, `missing`, `link` |
| HTTP that is not rpc        | An entry in the server's `routes` table (`/api/*`, `/mcp`, picture URLs)                                       |
| Traces and logs             | The telemetry component: every operation is a span; pages send theirs                                          |
| Proof                       | `tinker check`: types, rules, tests, and every exit reached                                                    |

Where Tinker makes the right code hard to write, the module's ship notes it, for the Tinker
author.

## Tech Stack

- Bun 1.4.4: the only runtime. It runs both the server and the CLI, as one compiled binary.
- Tinker 0.30.1 (`@tinkered/core`, `@tinkered/react`, `@tinkered/bun`). Every function is an
  operation, every stateful page feature is a capsule, and rpc runs over one socket.
- React 19 and TanStack Router for the viewer page, bundled by Vite (vite-plus).
- SQLite (`bun:sqlite`, WAL, `synchronous=FULL`: a lost write of a revoke or a frame costs more
  than the fsync) through drizzle-orm, in one file under `/data`.
- puppeteer-core (Apache-2.0) with an existing Chromium, for pictures. With no Chromium, pictures
  are off.
- `@modelcontextprotocol/sdk` (MIT), already in `package.json`, for `/mcp` and `easel mcp`.
- zod for every input.
- For the kit (E8, [kit](SPEC-kit.md)): `tailwindcss` 4.3.5 (MIT), pinned exactly, for the make step;
  Lightning CSS (MPL-2.0, used as it is, with no change to its files) for the check. Each is a new
  dependency, approved with the decision [kit-on-tailwind](docs/decisions/kit-on-tailwind.md).

## Commands

```
Dev:        bun run dev
Check:      bun run check:plain     # tinker check: types, rules, tests, exits. Only "OK" is done.
Style:      bun run check:style     # format and lint
All:        bun run check           # types, tests, build
Smoke:      bun run smoke           # the built binary in a real browser
Charts:     scripts/statecharts.sh --check   # every chart as committed, every rule as it says
Ship:       scripts/ship.sh -m "<type>(<scope>): <msg>" -- <paths>
Skill:      bunx --no-install --package @tanstack/intent intent load @tinkered/core#<skill>
```

## Project Structure

```
src/<module>/       a feature: index.ts (the capsule), contract.ts, *.server.ts (operations)
cmds/               the cmds: server.ts (serve), easel.ts (the CLI), dev.ts
tinker/             template base (health, telemetry, requests); change it only with a reason
tests/              server tests (bun); tests/browser/ page tests (Chromium)
docs/decisions/     one file per decision, with its prior art and why
docs/statecharts/   the statecharts (the oracle): one page per chart, models/<module>/ for TLA+
scripts/            ship.sh, smoke.sh, statecharts.sh, sync scripts
SPEC*.md            this spec and the module specs
```

## Code Style

```ts
// src/frames/put.server.ts: an operation names its deps, parses its input, answers a kind.
// A sketch; the answers are in SPEC-frames.md: created, updated, unchanged, stale, gone, tooBig.
// The input is SPEC-frames.md's: { canvas, html, name?, size?, id?, base? }.
const doc = {
  canvas: z.string(),
  html: z.string(),
  name: z.string().optional(),
  size: z.strictObject({ w: z.number(), h: z.number() }).optional(),
};

export const putFrame = operation({
  label: "frame.put",
  // id and base come together or not at all; one without the other is `invalid`.
  input: z.union([
    z.strictObject(doc),
    z.strictObject({ ...doc, id: z.string(), base: z.number() }),
  ]),
  depends: { frames: frames.controller },
  run: ({ frames }, { input }) => {
    // Measured on the document's UTF-8 bytes, before anything is written.
    if (Buffer.byteLength(input.html) > maxBytes) return { kind: "tooBig", maxBytes } as const;

    // No id: a new frame at version 1, answered `created`.
    if (!("id" in input)) return frames.create(input);

    // One conditional write checks the base, compares the document and raises the version.
    // When it changes no row, the same transaction reads the row to answer which:
    // `updated`, `unchanged`, `stale` or `gone`.
    return frames.putIf(input);
  },
});
```

- There are no casts: no `as` except `as const`, no `!`, no `any`. A `switch` on `kind` has one
  case per kind and no `default`.
- No useState, useEffect, useReducer or raw fetch in the page.
- Import a file by its own path. There are no barrels (`tinker/barrel`).
- Blank lines separate the steps of a body (`tinker/body-steps`). Complexity is at most 8.

## Testing Strategy

- A test reaches every exit of every operation, and `tinker check` proves it: each `kind`, each
  refusal, each plain return.
- Server tests (`tests/*.test.ts`) run on Bun, with `exits({ file: process.env.TINKER_EXITS })`
  first in each scope.
- Page tests (`tests/browser/`) run in Chromium, with `exits({ store: localStorage })` first, and
  find controls by role and name.
- A bug gets a failing test first (agent-skills `test-driven-development`).
- The browser smoke holds the critical paths only. When the canvas lands, its one flow is: open a
  board, frames show, pan and zoom.

## Boundaries

- **Always:**
  - Land work through `scripts/ship.sh`, in small green ships.
  - Run `tinker check` until it says OK.
  - Check a dependency's license before adding it.
  - Keep machine-specific values in git-ignored files.
- **Ask first:**
  - Adding a dependency.
  - A schema change after V1 ships.
  - An exception in `tinker.json`.
  - Changing CI or deploy.
  - Adding a smoke flow.
- **Never:**
  - Open, copy, adapt or paraphrase doop's source, CSS, tokens, tests, identifiers or patches.
    doop is AGPL-3.0; easel is a clean room (see `docs/canvas-speed.md`). Ideas and measurements
    are fine.
  - Add a copyleft dependency (GPL, AGPL, SSPL, BUSL).
  - Add a LICENSE file: the human decides (recommended: MIT).
  - Commit secrets.
  - Edit vendored skills.
  - Use a branch, a PR, or a hand-made commit.

## Success Criteria

1. Every user journey in every module spec has a test that runs it end to end. An agent's journey
   runs through the CLI alone, with `--json`; a person's journey runs in a page test.
2. Every contract kind and refusal in the module specs is reached by a test, and `tinker check`
   prints OK.
3. Each fact rule holds in the code graph; each judged rule is judged OK with a file:line.
4. On a board of 200 frames, the viewer meets `docs/canvas-speed.md`. In a screencast of a pan and
   a zoom across the board, no captured frame shows a blank white box where a frame should be, and
   only frames in view are live.
5. Every commit that is green on main is live at https://easel.vibea.dev, and `/api/version` names
   that commit.
6. An error in production is fixed by an agent with no person involved, and proven fixed
   ([ops](SPEC-ops.md), [fixer](SPEC-fixer.md)).
7. An agent with MCP and no shell can run the queue loop ([mcp](SPEC-mcp.md)).
8. Each statechart's rules are reached by its module's tests, and `scripts/statecharts.sh --check`
   is clean ([docs/statecharts](docs/statecharts/README.md)).

## Out of Scope (Deferred)

- Editing in the browser: viewers look and ask only.
- Accounts with passwords, OAuth, and SSO: a user is a name and a token.
- Real-time co-presence (cursors, who is looking).
- Frame history and undo. easel keeps only the versions that requests refer to
  ([frames](SPEC-frames.md)), to show what a viewer saw and the frame before and after a change.
- Many servers: one process and one SQLite file.

## Open Questions

1. The LICENSE: the human decides (recommended: MIT, as the dependencies are MIT and Apache-2.0).
2. Production data: easel.vibea.dev needs a `/data` volume before ops stores errors. It is
   requested from the hub when ops lands, the second module.
3. Where the fixer runs. Recommended: a paseo schedule on this host. A tick every 5 minutes uses no
   model and starts an agent only when there is work. The host has the repo, `ship.sh` and `gh`
   already. The other choice, a GitHub Action, would need a model key in CI and a second way to
   land code.
4. An off-host target for backup copies. The design is in
   [SPEC-ops, "The data is safe"](SPEC-ops.md#the-data-is-safe): an S3-compatible bucket on a second host, with a
   key that can only add copies. The hub has the request (hq-a6w). It stays open until the bucket
   exists.
5. `ship.sh --fixer` and the `BUILD` number change `scripts/ship.sh`, the Dockerfile and
   `deploy.yml`, and add a probe workflow. These are "Ask first" changes; approving this spec
   approves them. `ship.sh` is shared with the other agent on this checkout, who is told before it
   changes.
