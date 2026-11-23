# Capability map: Round 1, the rest

Round 1 has one outcome ([epics.md](docs/epics.md#round-1-show-the-design)): a team shows its
design on a canvas. People see it, change its states and comment on it, and agents make and change
the design through MCP. This map lists the modules that are not built yet, and the order to build
them in. The user approved it on 2026-11-23. Each module gets its spec, then its plan, then its
build, with a review at each step.

| Module id  | What it does                                                                                                                              | Depends on                 | Requirements      | Spec                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------- | ----------------------------------------------- |
| `mcp`      | The tools, from the rpc contract, over stdio and HTTP, with the bearer token: Claude Code, local and remote.                              | access, frames, queue, kit | C3, W1 to W6      | [SPEC-mcp.md](SPEC-mcp.md)                      |
| `speed`    | A budget for each step of the critical path, a check that stops a slower change, and only the necessary work on the critical path.        | viewer, frames             | Q1 to Q3, S9, S11 | [SPEC-speed.md](SPEC-speed.md)                  |
| `mcp-auth` | OAuth 2.1 for the Claude web app: each person signs in with their own easel account, and one agent can be stopped.                        | access, `mcp`              | C1, C2            | [SPEC-mcp-auth.md](SPEC-mcp-auth.md) (approved) |
| `copy`     | The texts of the frames by key, in one place, live, and enough for a second language. Its calls get tools in `mcp` with no work in `mcp`. | kit, frames                | L1, L3, L5, L12   | to write: a section of SPEC-kit.md              |

Build order: `mcp` and `speed` at the same time, then `mcp-auth` and `copy`.

Tasks that are not modules:

- Name X1 to X5 in the tests of the controls (E10). Done: the titles in
  `tests/browser/viewer-kit.test.tsx` name them, with a check for X4 (a refusal changes nothing) and
  X5 (the same size at each zoom).
- Add MCP to the start steps (R2), after `mcp`.
- Write the short note on data (R7).

Why OAuth is in Round 1: in the Claude web app, a fixed token goes in "Request headers", which is in
beta for some organizations only. On a Team plan, the Owner adds the connector one time, so each
person shares one header. Claude's docs say to use OAuth when each person signs in with their own
account, and C2 needs that. Claude Code takes the bearer token as it is.
