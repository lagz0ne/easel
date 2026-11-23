# Spec Delta: mcp-auth

Status: proposed (2026-11-23)

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
- The sign-in itself stays the device grant with an owner's approval of [access](SPEC-access.md)
  (RFC 8628, as Tailscale's device approval). easel has no passwords, and this delta adds none.

## Current Behavior

- `/mcp` takes `Authorization: Bearer <token>`, where the token comes from `easel login`
  ([SPEC-mcp](SPEC-mcp.md#a-remote-agent-adds-easel)). A missing or bad token answers 401 with
  `WWW-Authenticate: Bearer realm="easel"`. That header names no metadata, so the Claude web app
  cannot start a sign-in.
- The CLI makes each token and sends only its digest. No answer carries a token
  ([access](SPEC-access.md), judged rule 1). A token has no expiry.

## New Behavior

### A person adds easel to the Claude web app

1. In Claude, the person adds a custom connector with the address `https://<server>/mcp`, and
   keeps the default "Use Claude's published identity".
2. Claude calls `/mcp` and gets a 401 that names the metadata of easel. Claude reads it and opens
   the sign-in page of easel in a new window.
3. The page says that Claude (`claude.ai`) asks for the easel tools. It asks a name for this
   connector, for example `ann-claude`. The person writes it and selects `Continue`.
4. The page shows a code, for example `KDFX-8QWP`, and when it runs out. It says to ask an owner to
   approve it, and waits.
5. An owner approves it, as for each login: `easel users approve KDFX-8QWP`, or the `approve_user`
   tool of an agent that an owner signed in. The owner can approve it as an owner with `--owner`.
6. The page goes back to Claude by itself. Claude says that easel is connected.
7. In each Claude app of the person (web, desktop, mobile), an agent can use the easel tools as
   the user `ann-claude`.

### The sign-in fails

- An owner denies the code: the page says "An owner denied this connector." Claude says that the
  connection failed.
- No owner approves it in 10 minutes: the page says "The code ran out. Add the connector again."
- The name is in use: the page says so at once, and asks for a different name.
- A client that easel does not know, or a redirect address that its document does not list: the
  page says "easel does not know this app." It never redirects to that address.
- Too many sign-ins from one address: the page says when to try again (the limits of `login.start`).

### An owner stops a connector

1. `easel users` lists `ann-claude`, with its client (`Claude`).
2. `easel users revoke ann-claude` stops it. Its next tool call answers 401, and its refresh
   answers `invalid_grant`. Claude says that the connector needs a new sign-in.
3. The other users, and the other connectors, keep working.

### The tokens of a connector

1. easel makes the tokens of a connector, not the client. It gives each token one time, in the
   answer of the token endpoint, and keeps only its SHA-256 digest.
2. An access token works for 1 hour, and only at `https://<server>/mcp`.
3. A refresh token gives a new access token and a new refresh token. The old refresh token stops
   at once. A refresh token that is used a second time stops the connector, as a revoke does
   (the reuse rule of OAuth 2.1, section 4.3.1).
4. A token of `easel login` works at `/mcp` as before, with no expiry.

## Contract

These HTTP routes are new. Each one is an entry in the `routes` table, as `/mcp` is.

| Route                                         | Answers                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource`   | RFC 9728: `resource` `https://<server>/mcp`, `authorization_servers` [the server]       |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: the endpoints below; S256; `none` auth; CIMD supported; `iss` in the response |
| `GET /oauth/authorize`                        | The sign-in page, or an error page. It never redirects to an address it did not check.  |
| `POST /oauth/token`                           | A form body: `authorization_code` with the PKCE verifier, or `refresh_token`            |

The 401 of `/mcp` becomes
`WWW-Authenticate: Bearer realm="easel", resource_metadata="https://<server>/.well-known/oauth-protected-resource"`.

The sign-in page waits for the approval through the same calls as `easel login` (`login.start`,
`login.wait`), with a `client` field that the CLI does not send.

## Rules

A TLA+ model and its chart (`scripts/statecharts.sh`) of the sign-in and the tokens come before
the code. The chart extends [access-login](docs/statecharts/access-login.md).

### Fact rules (the code graph decides)

1. The OAuth routes run no guard. They write only the `logins`, `users` and grant cells.
2. `/mcp` takes a connector token only when the token's resource is the address of `/mcp`.
3. Only the cmd reads `PUBLIC_ORIGIN`; the routes get the origin from it.

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
6. A token, a digest, a code, a verifier and a `state` never reach a span attribute, a log record,
   or the text of an error.
7. A revoke ends the user, its access tokens and its refresh tokens in one write.
8. The token endpoint answers within 10 seconds, and the sign-in page waits for the approval
   in the page, not in an HTTP call.

### Accepted risks

- The page cannot prove who the person is. The owner's approval is the proof, as for each login.
  An owner approves only a code that a person of their team sent them.

## Success Criteria

- A test runs the full sign-in against a server in the same process: discovery from the 401, the
  page, the approval, the code, the token, a tool call, a refresh, and a revoke (401 and
  `invalid_grant` after it).
- A test reaches each failure above: deny, expiry, a name in use, an unknown client, a wrong
  redirect address, a wrong PKCE verifier, a used code, a wrong resource, a refresh token used two
  times, and the rate limit.
- A token of `easel login` still works at `/mcp`, and the MCP client tests of SPEC-mcp stay green.
- By hand: a person adds easel to the Claude web app at `https://easel.vibea.dev/mcp`, signs in,
  and an agent in the Claude mobile app lists the canvases. Then `easel users revoke` stops it.
- Each rule of the new chart holds, and a test walks each path that the chart draws. `tinker check`
  is OK.

## Out of Scope (Deferred)

- Dynamic Client Registration (RFC 7591). It is deprecated. Add it when a client that a team uses
  has no CIMD.
- Clients other than Claude and Claude Code. Add a client to the list when a team asks for it.
- Scopes: a connector can do what a member can do. Add scopes when a team asks for a connector
  that only reads.
- A password or a single sign-on for the page. Add it when the approval of each connector takes an
  owner too much time.
- An expiry for the tokens of `easel login`.

## Open Questions

1. The time that Claude's sign-in window waits is not in its docs. If it closes before an owner
   approves, the person adds the connector again, and the approved user stays. My pick: build it
   as above, and measure it in the check by hand. If the window is too short, the page keeps the
   approval for the next try of the same name.
2. Claude's docs do not say if a person can add a connector in the mobile app, or only use it
   there. C1 needs only the use: the person adds it on the web one time.
