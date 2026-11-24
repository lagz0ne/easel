# Spec delta: `single`, one person and one project on a server

Status: proposed (the user, 2026-11-24: the ask; "for now, use easel.vibea.dev, yes"; the one
project is `easel`, and the other canvases go after an export: "yes").

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
   Then delete the 4 canvases.
10. Remove the member `lagz0ne`. The browser signs in again, as the owner.
11. The hub sets `EASEL_AUTH=single` and `EASEL_PROJECT=easel` on the app (a hub request).

## Model

The mode changes who can get a session, so the model comes first. It is a variant of
[access-browser](docs/statecharts/access-browser.md) with these rules:

- In `single`, each session belongs to the owner or to an agent token, and to no other name.
- No step in `single` adds a person.
- The rules of access-browser still hold: a link signs in at most one browser, and after a
  revoke, no browser of that user reads a canvas.

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

## Open questions

1. **The name of the person.** I recommend `rocky`: it is the owner today and holds the CLI
   login. The other way: rename it to `lagz0ne`, the name that you typed on the sign-in page.
   The name shows only on your requests and in `easel users`.
