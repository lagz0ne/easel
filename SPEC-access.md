# Spec: access — V1

Module `access` of [SPEC.md](SPEC.md). Depends on nothing. The CLI shell is built with it
([cli](SPEC-cli.md): the hosts file, the rpc client, the exit table, `--json`); access adds
`easel login`, `easel users`, `easel whoami` and `easel logout`.

## Objective

Decide who may use easel. A **user** works on canvases: an agent, or a person through an agent. A
user has a token, gets it by a one-time code that an owner approves, and works through the CLI.

There are no accounts with passwords. A user is a name and a token. A user is an `owner` or a
`member`; only an owner approves, denies and revokes.

access gives the `user` and `owner` guards. Share links, passes and the `mayRead` guard belong to
[frames](SPEC-frames.md).

Prior art: the code and its approval are the OAuth 2.0 device grant (RFC 8628, as `gh auth login`)
with an admin's approval in place of a browser sign-in (as Tailscale's device approval). The CLI
makes its own token and sends only its digest, as an OAuth client sends a PKCE code challenge (RFC
7636), so no answer ever carries the token. The first owner's setup code is the pattern of Jenkins'
initial admin password.

## How a server is set up

`EASEL_AUTH` picks one of three ways. The cmd reads it; nothing else does.

- `approve` (the default): a new user waits until an owner approves their code.
- `open`: each login is granted at once, as an owner. For one person on their own machine. The
  server refuses every rpc call from a peer that is not this machine, and refuses to start when
  `PUBLIC_ORIGIN` is unset or is not a loopback address.
- `single`: one person on a public server ([SPEC-single](SPEC-single.md)). The sign-in page has no
  name field, and an approve signs the browser in as the owner who approves it. No login and no
  approve makes a new person. The agents keep their member tokens (`easel users add`).
  `EASEL_PROJECT` names the one project: it is the title of `/`.

While an `approve` or `single` server has no user, each start prints a new one-time setup code to
its log, and the code from the start before stops working: it answers `wrong`. The first login
that gives it becomes the owner. Once used, it answers `taken`.

Users, tokens and pending codes are kept in the SQLite file, so they survive a restart.

The rate limits count per client address. The server reads `X-Forwarded-For` only when the
socket's peer is a trusted proxy (`EASEL_TRUSTED_PROXIES`, loopback when unset; production lists
Traefik's network and Cloudflare's ranges). It reads the header from the right, skips each trusted
proxy, and takes the first address that is not one (nginx's `real_ip_recursive`). Otherwise the
address is the socket's peer. An IPv6 address counts by its /64.

## How a token is made

1. The CLI makes the token: 32 random bytes. It sends only the token's SHA-256 digest, with
   `login.start` or `login.setup`.
2. The CLI keeps the token, and the pending request, in `~/.config/easel/hosts.json` before it
   waits. So a CLI that stops can resume.
3. An approve binds the digest to the user. The token works from then on, whether or not the CLI
   has heard.
4. `login.wait` carries no token. It answers `granted` as often as it is asked, while the token
   works. A lost answer is safe: the CLI asks again.
5. The server never holds the token in the clear.

## Journeys

### Become the first owner

1. Someone starts a new server. Its log shows `setup code: XXXX-XXXX`.
2. They run `easel login <server> --name ann --setup XXXX-XXXX`. The CLI says they are signed in as
   ann, owner, and keeps the token.
3. The same code a second time answers `taken`. A code from before a restart answers `wrong`: a
   restart with no user prints a new code, and the log shows it. A setup name that a pending login
   code carries answers `taken`, as a name in use does.

### Join a server

1. An agent runs `easel login <server> --name builder`. At once, the CLI prints the code
   (`KDFX-8QWP`) and when it runs out, as its first line (with `--json`, its first JSON line). It
   says to ask an owner to approve it, and waits.
2. An owner runs `easel users` and sees the request: its code, its name, and when it came. They run
   `easel users approve KDFX-8QWP`. With `--owner`, builder becomes an owner.
3. The waiting CLI says it is signed in as builder.
4. `easel login --no-wait` prints the code and exits. `easel login --resume` waits on that code
   later. The same works after Ctrl-C or a dropped connection: if the owner approved meanwhile, the
   resumed CLI is signed in at once.
5. If the owner runs `easel users deny KDFX-8QWP`, the CLI says it was denied and keeps nothing.
6. A code nobody approves runs out after 10 minutes; the CLI says so and keeps nothing.
7. A name in use answers `taken` at once, and the CLI says to pick another name.
8. Past a rate limit, `login.start` answers `slow`, and the CLI says when to try again.
9. `easel login --print-token` asks in the same way, but keeps nothing on the computer. When an
   owner approves, it prints the token one time, for a secret of a run that has no file
   ([cli](SPEC-cli.md#sign-in-with-no-file)).

### Revoke a user

1. An owner runs `easel users revoke builder`. Builder's token stops working at once. Its next call
   is refused, and its CLI says to log in again. The name builder is free again.
2. If the owner approved builder's code and its CLI has not heard yet, the revoke ends that code
   too. The CLI is told `denied`, not `granted`.
3. An owner may revoke another owner, or themselves. Revoking the last owner answers `last` and
   changes nothing, so a server with an owner always has one.

### Sign out

1. `easel whoami` calls `users.me`, and prints the name, the role and the server.
2. `easel logout` calls `login.end`. The server removes the calling user, with its token and its
   codes, in one write; it answers `ended`. The name is free again, so the user can log in again
   with it. Then the CLI deletes the token from `hosts.json`.
3. The last owner cannot log out: `login.end` answers `last` and changes nothing, as
   `users.revoke` does, so a server with an owner always has one. Its token still works.

## Contract

Login calls need no token, except `login.end`. User calls need a user's token. Owner calls need an
owner's token.

```ts
// login: `digest` is the SHA-256 of the token the CLI made
// login.start { name, digest }; login.setup { name, code, digest }; login.wait { request }
"login.start":  { kind: "pending"; code: string; request: string; expiresAt: number }
              | { kind: "granted"; user: User }                       // `open` server
              | { kind: "taken" }                                     // the name is in use
              | { kind: "slow"; retryIn: number }
"login.setup":  { kind: "granted"; user: User }
              | { kind: "taken" }    // the code was used, or the name is in use or pending
              | { kind: "wrong" }    // not the live setup code: one from before a restart
              | { kind: "slow"; retryIn: number }
"login.wait":   { kind: "granted"; user: User } | { kind: "pending" }
              | { kind: "denied" } | { kind: "expired" } | { kind: "slow"; retryIn: number }

// user: `easel whoami` and `easel logout`
"users.me":      { kind: "me"; name: string; owner: boolean }
"login.end":     { kind: "ended" }    // removes the calling user: its token, codes and name
               | { kind: "last" }     // the caller is the last owner: nothing changes

// owner
"users.list":    { users: User[]; requests: Request[] }
"users.approve": { kind: "approved"; user: User } | { kind: "gone" }    // { code, owner?: boolean }
"users.deny":    { kind: "denied" } | { kind: "gone" }
"users.revoke":  { kind: "revoked" } | { kind: "last" } | { kind: "gone" }
```

Success kinds: `login.start` `pending` and `granted`; `login.setup` `granted`; `login.wait`
`granted` and `pending`; `users.me` `me`; `login.end` `ended`; `users.approve` `approved`;
`users.deny` `denied`; `users.revoke` `revoked`. `users.list` answers no kind, and is a success.
Every other kind is not: the CLI exits 1, and an MCP tool sets `isError`.

`User = { name, role: "owner" | "member", since }`. `Request = { code, name, since, expiresAt }`.
`request` is a 128-bit random value that names one login for `login.wait`.

`login.wait` answers within 50 s: `pending`, if nothing changed. The CLI calls it again until the
code ends. `easel login` exits 0 on `granted`, and on `pending` with `--no-wait`.

Refusals: `{ signIn: true }` (no token, or a revoked one), `{ owner: true }` (a member calls an owner
call).

## Rules

The statechart [access-login](docs/statecharts/access-login.md) checks the login and revoke
journeys. Its rules are the oracle the tests follow.

### Fact rules (the code graph decides)

1. Every owner call runs the `user` guard, then the `owner` guard.
2. Every user call (`users.me`, `login.end`, canvas, frame, and the agent calls of the request queue) runs the `user` guard.
3. `login.start`, `login.setup` and `login.wait` run no guard, and write only the `logins` and
   `users` cells, and the setup code cell that the granting write of `login.setup` clears.
4. Only the cmd reads `EASEL_AUTH` and the env; no operation reads `process.env`.

### Judged rules (need reading the code)

1. The CLI makes each token. The server gets only its SHA-256 digest, keeps only that, and compares
   in constant time. No answer carries a token.
2. A code is single use: an approve, a deny, its expiry or a revoke ends it, and a second approve
   answers `gone`. A day after its code ends, a request is forgotten; an unknown request answers
   `expired`.
3. A code is 8 letters from an alphabet with no look-alikes (RFC 8628, section 6.1), and runs out
   after 10 minutes.
4. The setup code works once, and only while the server has no user. Once used, it answers
   `taken`. Each start while there is no user prints a new one; the one before answers `wrong`.
5. `login.wait` on an approved code answers `granted` each time it is asked, while its token works.
   Once the code is denied, or its user is revoked, it answers `denied`.
6. An approve makes the digest a live token in the same write that ends the code.
7. A name is in use while a user has it or a pending code carries it. `login.start` and
   `login.setup` check and take the name in one write, so two users never share a name. A name in
   use answers `taken`.
8. A revoke ends the user's tokens and its codes in one write. The user is refused on its next call
   or read, not only at its next connect, and is never told `granted` again.
9. `users.revoke` on the last owner answers `last`. An owner may revoke themselves while another
   owner remains.
10. Each rate limit counts per client address, an IPv6 one by its /64. In one minute, from one
    address: 5 `login.start` calls, 5 `login.setup` calls, 30 `login.wait` calls. Each call counts,
    whatever it answers. Past that, the call answers `slow` with `retryIn`, even a right setup code.
11. At most 20 codes wait for approval at once, and at most 3 from one address. Past that,
    `login.start` answers `slow`.
12. In `open`, the server refuses every rpc call (`/rpc`) from a peer that is not a loopback
    address; pages, `/api/health` and `/api/version` stay readable. It does not start unless
    `PUBLIC_ORIGIN` is a loopback address. Listening on 127.0.0.1 alone waits on a hostname option
    in Tinker's `serve`.
13. A token, a digest, a code and a request never reach a span attribute, a log record, or the text
    of an `invalid` fault. The setup code reaches the log once, in the line that shows it.
14. `login.end` removes the calling user, its token and its codes in one write, as `users.revoke`
    does, so its name is free for a new login. The last owner answers `last` and nothing changes.
15. An `/rpc` upgrade whose `Origin` is present and is not `PUBLIC_ORIGIN` is refused 403, as
    OWASP's guidance on cross-site WebSocket hijacking asks: a foreign page, and a sandboxed frame
    (whose `Origin` is `"null"`), cannot open the socket. A client with no `Origin`, as the CLI,
    passes; a token or a pass still guards each call. With `PUBLIC_ORIGIN` unset (tests, dev), the
    request URL's origin stands in. Tinker's `ws.server({ origin })` makes the check; the cmd gives
    it `PUBLIC_ORIGIN`.

### Accepted risks

- A frame's script can read the page's URL through `document.baseURI`, and the page URL holds the
  share link (`/s/<link>`). The sandbox keeps it from the tab's storage, cookies and socket, and
  rule 15 keeps it from opening one of its own from the frame; it can still send the link
  elsewhere. The author owns the canvas and wrote the script, so this is no escalation
  ([viewer](SPEC-viewer.md) § Rules).

## Success Criteria

- Every journey above runs end to end in a test: first owner, a used setup code (`taken`), a setup
  code from before a restart (`wrong`), a setup name that a pending code carries (`taken`),
  join (approve, approve as owner, deny, expiry, `--no-wait` and `--resume`, a lost `granted`
  answer), `taken`, revoke (also before the CLI heard, and the last owner), `slow`, and sign out
  (`whoami`, then `logout`: the token is refused after it, and the name logs in again; the last
  owner's `logout` answers `last` and its token still works).
- Every contract kind and refusal is reached by a test; `tinker check` is OK.
- Each judged rule is judged OK with a file:line.
- Each rule of [access-login](docs/statecharts/access-login.md) holds, and a test walks each path
  its chart draws.

## Out of Scope (Deferred)

- Accounts with passwords, OAuth and SSO. A browser signs in with a code that an owner approves,
  or with a link of `easel open`: see [home](SPEC-home.md).
- More roles than owner and member, and per-canvas permissions for users: any user may work on
  any canvas.
- One user on two machines: the second machine logs in under its own name.
- Sharing a canvas with viewers: [frames](SPEC-frames.md).
