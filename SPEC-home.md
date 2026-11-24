# Spec delta: `home`, a home page of the projects, and a browser that signs in

Status: approved (user, 2026-11-24: the ask, then "Approve the browser"). The details are the
coordinator's, on the prior art below; the user can change each one.

## Objective

The user, 2026-11-24: "Links are hard to remember, give me a simple homepage in the current design
system style to list out all of projects. And projects should have a back button next to page
title to get back to the list. The project list item should have indicator of inbox items".

A project is a canvas. A team member opens easel at `/`, sees each canvas of the team, sees which
ones wait for them, and opens one. From a canvas, a back button goes to the list.

To list each canvas, the browser must know that the person is a user of the team. Today only the
CLI signs in. A browser sees a canvas only through its share link, as a viewer
([actors](docs/actors.md)). So this delta adds a browser sign-in, with the approval that the CLI
already uses.

Prior art:

- **Tailscale device approval and the OAuth device grant (RFC 8628).** A new device shows a code,
  and an admin approves it. easel's CLI login works so already (SPEC-access).
- **Jupyter's token link, and the magic links of Slack and Supabase.** A link that works one time,
  for a short time, signs a browser in.
- **Vercel's and Linear's project lists.** One row for each project, its name, its last change, and
  a count of what needs the person.

## Current behavior

- `/` shows the greeting of the template.
- A user signs in only with the CLI (`easel login`), with a token that an owner approves.
- A browser opens a canvas only with its share link (`/s/<link>`). The viewer has no way back to
  a list.

## New behavior

### The browser signs in

1. `/` on a browser that is not signed in shows the sign-in page. It shows a one-time code, as
   `easel login` prints one. An owner approves it with `easel users approve <code>` (or on the
   home page of a signed-in owner, rule 9). The page then signs in on its own.
2. `easel open` on a machine where the CLI is signed in prints a sign-in link, and opens it in the
   browser of that machine when it can. The link works one time, for 5 minutes, and signs that
   browser in as the user of the CLI. It does not carry the token of the CLI.
3. A signed-in browser keeps its session in a cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, with
   no script access. The server keeps only a digest of it. A session ends when its user is revoked,
   when the person signs out, or after 30 days with no use.
4. `easel users` lists the sessions of each user (the browser and when it was last used), and an
   owner ends one (`easel users end <session>`).
5. A browser session has the rights of its user, and no more: a member is a member.

### The home page

6. `/` on a signed-in browser lists each canvas of the team, in one column, in the look of easel
   (`src/design`). Each row has the name of the canvas, its count of frames and of pages, when it
   last changed, and its inbox.
7. **The inbox** of a canvas is the count of its requests that wait for a person: questions,
   results to check, and requests that need a person. They are the requests of `Waits for you` in
   the Requests panel (SPEC-viewer). A canvas with none shows no count. The rows with an inbox come
   first, then the others, each by the time of their last change.
8. A row opens the canvas at `/c/<canvas>`, in the viewer, as the user (not through a share link,
   so a canvas that is not shared opens too). A share link still opens as before.
9. An owner also sees the codes that wait for approval, and approves or denies each one there.
10. The page updates live: a new request or a new canvas shows without a reload.

### The back button

11. In the viewer, a back button is before the name of the canvas at the top. It goes to `/`. A
    viewer with a share link and no session does not see it: for that person, the link is the only
    canvas.
12. The home page and the viewer keep the theme, the keyboard and the motion rules of SPEC-design.

## Success criteria

1. On a phone with no session, `/` shows a code. After `easel users approve <code>`, the phone
   shows the list within 5 seconds, with no reload.
2. `easel open` signs the browser of the machine in. A second use of the same link is refused.
3. The list shows each canvas of the team, and a canvas with 2 requests that wait for a person
   shows `2`. When the agent answers one, the count goes to `1` with no reload.
4. A canvas that is not shared opens from the list. The back button goes to the list.
5. After `easel users revoke <name>`, each browser of that user shows the sign-in page on its
   next call.
6. No answer and no page shows a session or a token. A script on the page cannot read the cookie.

## Model

The sign-in of a browser is new state: a code that waits, an approval, a link used once, a session
that ends. So a TLA+ model and its chart come first (`access-browser`), with these rules:

- A browser has a session only after an owner approved its code, or after it used a sign-in link.
- A sign-in link signs in at most one browser.
- After a revoke, no browser of that user reads a canvas.

## Boundaries

- Always: a session is a cookie that a script cannot read. The server keeps only its digest.
- Always: a share link works as before, with no session.
- Ask first: a sign-in with an outside provider (Google, GitHub).
- Never: a token of the CLI in a link, a page or a log.

## Out of scope (deferred)

- **Sign-in with Google or GitHub.** Add it when the team has people who do not use the CLI and no
  owner is there to approve them.
- **Folders, search or stars on the home page.** Add them when the list has more than 30 canvases.
- **Make a canvas from the home page.** Agents make canvases. Add it when a person needs to.
