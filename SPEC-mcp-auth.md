# Spec Delta: mcp-auth

Status: approved (2026-11-23). A functional subset is built first; see [Built first](#built-first).

A delta of [SPEC-mcp](SPEC-mcp.md) and [SPEC-access](SPEC-access.md). Module `mcp-auth` of
[MAP-round-1](MAP-round-1.md). It implements C1 and C2 of
[epics.md](docs/epics.md), and the first item of SPEC-mcp "Out of Scope (Deferred)".

## Objective

A person adds easel to the Claude web app as a custom connector, and signs in with their own easel
user. Then the Claude web app, Claude Desktop and the Claude mobile app can use the easel tools.
An owner stops one connector at once with `easel users revoke`, and the other users keep working.

Why: today `/mcp` takes only the token of `easel login`. The Claude web app takes a fixed token
only as "Request headers", a beta for some organizations, and one header is shared by each person
of the organization. Claude's docs say to use OAuth when each person signs in with their own
account. C2 needs one user for each connector.

Prior art:

- The MCP authorization spec, revision 2026-07-28 (the same server rules as 2025-11-25, plus the
  `iss` of RFC 9207). A server is an OAuth 2.1 resource server. It names its authorization server
  in Protected Resource Metadata (RFC 9728). Clients use PKCE S256 and resource indicators (RFC
  8707). The preferred client registration is a Client ID Metadata Document (CIMD). Dynamic Client
  Registration (RFC 7591) is deprecated, and kept for old clients.
- Claude's connector docs: Claude's default is CIMD ("Use Claude's published identity"), with the
  client id `https://claude.ai/oauth/mcp-oauth-client-metadata` and the redirect
  `https://claude.ai/api/mcp/auth_callback`. Claude refreshes a token on a 401, and up to 5 minutes
  before it expires. It waits 10 s for a discovery or a token call.
- Cloudflare's `workers-oauth-provider`, which Sentry's MCP server uses: the app owns the sign-in
  and the consent page; the library keeps only the hash of each token. It runs on Workers KV, so
  easel copies its design, not its code.
- The sign-in uses a password that an owner makes before it, as Tailscale's auth keys (a key that
  an admin makes, that works one time and runs out) and Jenkins' initial admin password. The user
  decided this on 2026-11-23: a password first, and the code with an owner's approval later
  (Deferred). The sign-in does not wait for a person, so the sign-in window of Claude cannot close first.

## Current Behavior

- `/mcp` takes `Authorization: Bearer <token>`, where the token comes from `easel login`
  ([SPEC-mcp](SPEC-mcp.md#a-remote-agent-adds-easel)). A missing or bad token answers 401 with
  `WWW-Authenticate: Bearer realm="easel"`. That header names no metadata, so the Claude web app
  cannot start a sign-in.
- The CLI makes each token and sends only its digest. No answer carries a token
  ([access](SPEC-access.md), judged rule 1). A token has no expiry.
- A new user comes only from a login code that an owner approves. easel has no passwords.

## New Behavior

### An owner makes a password for a connector

1. An owner runs `easel users add ann-claude` (or the `add_user` tool of an agent that an owner
   signed in). With `--owner`, the connector becomes an owner.
2. easel prints the password one time, for example `KDFX-8QWP-MN4T-RZ7C-HJ2W`, and when it runs
   out. The owner gives the name and the password to the person, for example in a direct message.
3. `easel users` lists `ann-claude` as waiting for its sign-in. The name is in use from now on.
4. The password works one time, and runs out after 24 hours. `easel users revoke ann-claude`
   ends it before that.

### A person adds easel to the Claude web app

1. In Claude, the person adds a custom connector with the address `https://<server>/mcp`, and
   keeps the default "Use Claude's published identity".
2. Claude calls `/mcp` and gets a 401 that names the metadata of easel. Claude reads it and opens
   the sign-in page of easel in a new window.
3. The page says that Claude (`claude.ai`) asks for the easel tools. It asks the name and the
   password. The person writes them and selects `Sign in`.
4. The page goes back to Claude at once. Claude says that easel is connected.
5. In each Claude app of the person (web, desktop, mobile), an agent can use the easel tools as
   the user `ann-claude`.

### The sign-in fails

- A wrong name or password: the page says "The name or the password is wrong." It does not say
  which, and the person can try again.
- A used password, or one that ran out: the page says "This password does not work now. Ask an
  owner for a new one."
- A client that easel does not know, or a redirect address that its document does not list: the
  page says "easel does not know this app." It never redirects to that address.
- Too many tries from one address: the page says when to try again (the limits of `login.setup`).

### An owner stops a connector

1. `easel users` lists `ann-claude`, with its client (`Claude`).
2. `easel users revoke ann-claude` stops it. Its next tool call answers 401, and its refresh
   answers `invalid_grant`. Claude says that the connector needs a new sign-in.
3. The other users, and the other connectors, keep working.

### The tokens of a connector

1. easel makes the tokens of a connector, not the client. It gives each token one time, in the
   answer of the token endpoint, and keeps only its SHA-256 digest.
2. An access token works for 1 hour, and only at `https://<server>/mcp`.
3. A refresh token gives a new access token and a new refresh token. The refresh token that was
   used last still works until the new one is used, so a lost answer does not stop the connector
   (as `workers-oauth-provider`; the chart
   [access-connector-strict](docs/statecharts/access-connector-strict.md) shows why). An older
   refresh token stops the connector, as a revoke does (the reuse rule of OAuth 2.1, section
   4.3.1).
4. A token of `easel login` works at `/mcp` as before, with no expiry.

## Contract

One rpc call is new. It is an owner call, with a CLI command and an MCP tool:

| Call        | Input                     | Kinds                                              | CLI / tool                                      |
| ----------- | ------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `users.add` | `name`, `owner` (boolean) | `added` (`name`, `password`, `expiresAt`), `taken` | `easel users add <name> [--owner]` / `add_user` |

`added` is the one answer of easel that carries a secret. easel makes the password, keeps only its
digest, and never shows it again. A password is 20 letters from the alphabet of the codes, in 5
groups of 4 (about 90 bits).

These HTTP routes are new. Each one is an entry in the `routes` table, as `/mcp` is.

| Route                                         | Answers                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource`   | RFC 9728: `resource` `https://<server>/mcp`, `authorization_servers` [the server]       |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: the endpoints below; S256; `none` auth; CIMD supported; `iss` in the response |
| `GET /oauth/authorize`                        | The sign-in page, or an error page. It never redirects to an address it did not check.  |
| `POST /oauth/authorize`                       | The form of the page: the name and the password. Then the redirect to the client.       |
| `POST /oauth/token`                           | A form body: `authorization_code` with the PKCE verifier, or `refresh_token`            |

The 401 of `/mcp` becomes
`WWW-Authenticate: Bearer realm="easel", resource_metadata="https://<server>/.well-known/oauth-protected-resource"`.

## Rules

The model of the password, the sign-in and the tokens is the chart
[access-connector](docs/statecharts/access-connector.md). It sits next to
[access-login](docs/statecharts/access-login.md), and uses the same revoke.

### Fact rules (the code graph decides)

1. The OAuth routes run no guard. They write only the `users` and grant cells.
2. `users.add` runs the `user` guard, then the `owner` guard.
3. `/mcp` takes a connector token only when the token's resource is the address of `/mcp`.
4. Only the cmd reads `PUBLIC_ORIGIN`; the routes get the origin from it.

### Judged rules (need reading the code)

1. easel knows two clients: Claude's (`https://claude.ai/oauth/mcp-oauth-client-metadata`) and
   Claude Code's (`https://claude.ai/oauth/claude-code-client-metadata`). easel fetches only these
   two documents, and keeps them for 1 hour. A different `client_id` gets the error page.
2. The `redirect_uri` is the same as one in the client's document, character for character. For a
   loopback address (Claude Code), only the port can be different (RFC 8252, section 7.3).
3. The page shows the name of the client and the host of its redirect address.
4. The page cannot be put in a frame (`frame-ancestors 'none'`). Its form carries the `state` of
   the request, which works one time and for 10 minutes.
5. An authorization code works one time, for 60 seconds, with the PKCE verifier of its challenge
   and the `resource` of its request.
6. A password, a token, a digest, a code, a verifier and a `state` never reach a span attribute, a log record,
   or the text of an error.
7. A revoke ends the user, its password, its access tokens and its refresh tokens in one write.
8. The sign-in compares the password digest in constant time. It uses the password, makes the
   authorization code and binds the user to the client in one write. A second sign-in with the
   same password fails.
9. The token endpoint answers within 10 seconds.

### Accepted risks

- The password is the proof of who the person is. A person who gets the password first, in its
  24 hours, gets the connector. The person who waits for it then sees "This password does not
  work now", and the owner sees the client and the time of the sign-in in `easel users`. The
  owner revokes it, and makes a new password.
- When the answer of the token endpoint to a code does not reach Claude, Claude asks again with
  the same code. The code is used, so its tokens stop, and the person needs a new password. This
  is rare (Claude waits 10 s), and safe: a copy of a code never gives tokens.

## Success Criteria

- A test runs the full sign-in against a server in the same process: discovery from the 401, the
  password made by `users.add`, the page, the code, the token, a tool call, a refresh, and a
  revoke (401 and `invalid_grant` after it).
- A test reaches each failure above: a wrong password, a used password, one that ran out, a name
  in use for `users.add`, an unknown client, a wrong
  redirect address, a wrong PKCE verifier, a used code, a wrong resource, a lost refresh answer (the connector keeps working), a refresh
  token older than the last two, and the rate limit.
- A token of `easel login` still works at `/mcp`, and the MCP client tests of SPEC-mcp stay green.
- By hand: a person adds easel to the Claude web app at `https://easel.vibea.dev/mcp`, signs in,
  and an agent in the Claude mobile app lists the canvases. Then `easel users revoke` stops it.
- Each rule of the new chart holds, and a test walks each path that the chart draws. `tinker check`
  is OK.

## Built first

The user decided on 2026-11-23: "Dont rush for super safe auth first. Let's make the app
functional". So a subset is live first, and the rest of this spec is the hardening.

- `easel users add <name> [--owner]` makes a user and prints its token one time. It is an easel
  token, as from `easel login`, with no expiry. No MCP tool shows it.
- The 401, the two metadata routes, and `/oauth/authorize` and `/oauth/token` are as above.
- The sign-in page asks for the easel token, not a one-time password.
- easel fetches no client document. It sends a code only to Claude's callback
  (`claude.ai` or `claude.com`) or to a loopback address.
- A code works one time, for 60 seconds, with PKCE S256. It is kept in memory: a restart loses it.
- The token endpoint gives the easel token itself as the access token, with no refresh token and
  no expiry. `easel users revoke` stops it at once, as it stops any token.

Not yet: the one-time password, the 1-hour access token, the refresh rotation of the chart, the
client document fetch, the rate limit of the page, and the client in `easel users`.

## Out of Scope (Deferred)

- Dynamic Client Registration (RFC 7591). It is deprecated. Add it when a client that a team uses
  has no CIMD.
- Clients other than Claude and Claude Code. Add a client to the list when a team asks for it.
- Scopes: a connector can do what a member can do. Add scopes when a team asks for a connector
  that only reads.
- The sign-in with a code that an owner approves, as `easel login` (the next delta, by the
  user's decision of 2026-11-23). It needs no password to travel from the owner to the person.
- A password that a person keeps and uses again, and single sign-on. Add them when a person adds
  connectors often.
- An expiry for the tokens of `easel login`.

## Open Questions

1. Claude's docs do not say if a person can add a connector in the mobile app, or only use it
   there. C1 needs only the use: the person adds it on the web one time.
