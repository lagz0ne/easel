# Spec delta: `single`, one person and one project on a server

Status: implemented (f0c3d6c, live on easel.vibea.dev since 2026-11-24). Approved (the user,
2026-11-24: the ask; "for now, use easel.vibea.dev, yes"; the one project is `easel`, and the other
canvases go after an export: "yes"; the person: "can be anyname, choose lagz0ne").

## Objective

The user, 2026-11-24: "we'll want to have single user mode, as now, I'm on this machine, give me
single user mode. In single user mode, there'll be only one user. Mostly work as "embededd" where
the easel support only ONE project". And: "the code must be copyable right off" (done in
`683dbdb`).

Today easel.vibea.dev has one person, but it works as a team server. The sign-in page asks for a
name, and a wrong name makes a second user. On 2026-11-24 this made the user `lagz0ne`, and then
refused the next codes for that name. A single server removes these steps: one person, and one
project.

Prior art:

- **Jupyter Server and code-server.** One user for each server. A browser signs in with a token
  link that the server prints, or with a password. There is no list of users.
- **Storybook.** One instance for each project. It opens on the project, with no project list.
- **Tailscale device approval (RFC 8628).** A new device shows a code, and the one admin approves
  it. easel's browser code works like this already (SPEC-home).

## Current behavior

- `EASEL_AUTH` has two modes ([SPEC-access](SPEC-access.md#how-a-server-is-set-up)):
  - `approve`: a team; each new user waits for an owner.
  - `open`: one person on their own machine, loopback only.
- easel.vibea.dev runs `approve`. It has the owner `rocky` (the CLI) and the member `lagz0ne`
  (the browser session of the user). It also has two agent members, `vibea-claude` and
  `rocky-claude`.
- The sign-in page asks for a name. An approve with a new name makes a new user.
- `/` lists 6 canvases: `design-system`, `product`, `capsule-frames`, `leafy-plant-shop`,
  `s15-find-a-frame` and `image-proof`.

## New behavior

### One person

1. A third mode, `EASEL_AUTH=single`, is for one person on a public server. The server has one
   person: its owner.
2. The sign-in page has no name field. It shows a code at once. `easel users approve <code>` on
   the CLI of the person signs the browser in as the person. `easel open` works as before.
3. No code and no login makes a new person. `easel login` with a new name is refused, and
   `easel users approve --owner` is refused.
4. The agents keep their own tokens as members (`easel users add <name>`), so a request cannot
   make an agent act as the owner (SPEC-design-loop § Boundaries). `easel users` shows the person
   and the agents.
5. The rate limits, the session rules and the security rules of SPEC-home stay the same.

### One project

6. The server has one project. Its name comes from `EASEL_PROJECT` (here `easel`).
7. `/` is the page of the project. Its title is the project name. It lists the canvases of the
   project with their inbox counts, as the home page does today. The back button of a canvas goes
   to it.
8. A canvas is a part of the project, for example `design-system` and `product`. Agents still
   make canvases with `easel canvas new`.

### The move of easel.vibea.dev

9. Export each frame of `capsule-frames`, `leafy-plant-shop`, `s15-find-a-frame` and
   `image-proof` to `~/work/tmp/2026-11-24-single/<canvas>/` (`easel get`, and the pictures).
   Then delete the 4 canvases. Done on 2026-11-24: 20 frames, their pictures and pages, and the
   12 request threads of `s15-find-a-frame`; then `easel canvas rm` of each.
10. The one person is `lagz0ne`. A new owner command, `easel users rename <name> <new>`, renames
    the owner `rocky` to `lagz0ne`, so the CLI keeps its token. Before it, remove the member
    `lagz0ne`, and the browser signs in again, as the owner.
11. The hub sets `EASEL_AUTH=single` and `EASEL_PROJECT=easel` on the app (a hub request).

## Model

The mode changes who can get a session, so the model comes first. It is a variant of
[access-browser](docs/statecharts/access-browser.md) with these rules:

- In `single`, each session belongs to the owner or to an agent token, and to no other name.
- No step in `single` adds a person.
- The rules of access-browser still hold: a link signs in at most one browser, and after a
  revoke, no browser of that user reads a canvas.

The chart is [access-single](docs/statecharts/access-single.md). Its twin,
[access-single-approve](docs/statecharts/access-single-approve.md), breaks on purpose: a sign-in
page with a name field and an approve that makes a user add a person.

## Success criteria

1. On a phone with no session, `/` shows a code with no name field. After
   `easel users approve <code>`, the phone shows the project page within 5 seconds.
2. The page title is `easel`. It lists `design-system` and `product` and no other canvas.
3. `easel login https://easel.vibea.dev --name bob` is refused. `easel users` lists one owner and
   the agents.
4. A design agent still claims and resolves a request as `vibea-claude`.
5. The 4 canvases are in `~/work/tmp/2026-11-24-single/`, one HTML file for each frame, before
   the delete.
6. A server with `EASEL_AUTH=approve` works as before: the tests of SPEC-access and SPEC-home
   pass with no change.

## Notes from the build

These points were open in the rules above. The build decided them so:

- A code of a single server has no name. The approve binds it to the owner who approves it, and
  the browser signs in as that owner. With one owner, that is the person. (Prior art: RFC 8628
  section 5.4. The person who approves a code is the person that the device signs in as.)
  `easel users` shows such a code as `(the owner who approves it)`.
- The home page of the person shows a code with no name one time: the code, `a browser` and
  the time it runs out, with Deny and with no Approve button of its own. Above the list, the
  field "Code on your device" and its Approve take the code that the device of the person shows
  (user, 2026-11-25). `easel users approve <code>` works too. So a click on a code of another
  browser cannot sign that browser in. (Prior art: RFC 8628 section 3.3, the verification page
  of GitHub and Google, where the person types the user code.) A typed code that does not wait
  gets "No code like this waits. Read the code on your device again."
- New answers: `login.start` answers `single` for each name in single, also for a name of a user,
  so that no name shows. `users.add --owner` and `users.approve --owner` answer `single`. An
  approve that would make a user (a CLI login, or a browser code with a new name, left from an
  approve server) answers `single`. `browser.start` with no name on an approve or open server
  answers `name`.
- The page reads the mode and the project from two `<meta>` tags that the server puts in
  `index.html` (`easel-auth`, `easel-project`). (Prior art: Jupyter's `page_config` in its page.)
  So the page needs no call before the sign-in.
- `EASEL_PROJECT` is 1 to 40 of letters, digits, space, `.`, `_` and `-`. With none, the title of
  `/` is `Canvases`, as before.
- A single server prints a setup code while it has no user, as an approve server does. In
  production, it needs `EASEL_DB`. At start, it writes a line to its log when it has more than
  one owner (for example after a move from approve).
- `users.rename` is an owner call of its own service (`access.rename`), so the owner service of
  SPEC-home stays the same. It works in each mode. One write moves the user, its sessions, its
  sign-in links, its browser codes and its CLI logins to the new name. It first drops a session
  or a link that a row kept with the new name. A name of a user, or of a code or a login that
  waits or is approved, answers `taken`. No user answers `gone`. The MCP has no tool for it.
- Texts that name the old user stay as they are: the authors of requests, and the names on
  claims, agreements and messages of the queue. They are history, not rights: a claim is proved
  by its secret, and the owner checks read the role. A claim that a renamed agent holds runs out
  at the end of its lease. Rename the person, not an agent that holds a claim.

## Security review, 2026-11-24

A security auditor with fresh context read the code paths. It found no way to make a second
person or a second owner, and no way for an agent token to get owner rights. Its points:

- Fixed: a click on Approve of a code with no name gave an owner session to any browser that
  showed a code (medium). The home page now shows no Approve button for it.
- Fixed: `login.start` told `taken` for a user name and `single` for a new one, so a stranger
  could find the names (low). It now answers `single` for each name.
- Fixed: a rename did not drop a session or a link row that already had the new name (low).
- Fixed: a single server with more than one owner did not say so (low). It writes a line at start.
- Fixed: the refusal of `easel login` told a person to ask for `easel users add`, which gives a
  person a member token. It now says that `users add` is for an agent.
- Open, accepted: the person can still approve a code that a stranger sends in a message
  (remote phishing, RFC 8628 section 5.4). The page says to type only the code that your own
  device shows.
- Open: after a rename, a new user can take the old name, and the old texts then seem to name it
  (low). Add a list of names that a rename retired when an owner adds users again.
- Open, approve mode only: an anonymous caller can block a rename to a name with a login or a
  browser code that waits (low). Deny the code, then rename again.
- Open, approve mode only, from before this change: an approve of a CLI login for a name that a
  browser code made a user meanwhile replaces the token of that user (low). Check the name in the
  approve of a login, as `users.add` does.

## Boundaries

- Always: export a canvas before its delete.
- Always: a share link works as before.
- Ask first: the delete of a canvas that is not one of the 4 above.
- Never: an agent token with owner rights.

## Out of scope (deferred)

- **A local easel for each repository, as Storybook does.** Add it when a second project needs
  its own easel. `EASEL_AUTH=open` covers one machine today.
- **More than one project on a single server.** A second project gets its own server.
- **A move from `single` back to `approve`.** Add it when a second person joins.

## Decisions

1. **The name of the person** (the user, 2026-11-24): `lagz0ne`, by a rename of the owner `rocky`.
