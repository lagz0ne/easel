# Actors and journeys

Who uses easel, what each one does, and through which door. The words are from
[glossary.md](glossary.md). The steps of each journey are in the module specs; this page links to
them and does not copy them.

Prior art: the actors and goals of use-case modelling (Alistair Cockburn, "Writing Effective Use
Cases", 2000). An actor is a role, not a person. One person can have two roles: an owner who opens
a share link is a viewer in that tab.

## The main story

This is the success line of [SPEC.md](../SPEC.md). Each step names its actor.

| #   | Actor  | Door      | Step                                                                     |
| --- | ------ | --------- | ------------------------------------------------------------------------ |
| 1   | owner  | CLI       | Starts the server and logs in with the setup code.                       |
| 2   | agent  | CLI       | Runs `easel login`, and waits.                                           |
| 3   | owner  | CLI       | Approves the agent's login code.                                         |
| 4   | agent  | CLI / MCP | Makes a canvas and puts frames on it.                                    |
| 5   | agent  | CLI / MCP | Shares the canvas, with or without a password, and gives the link out.   |
| 6   | viewer | browser   | Opens the link, gives a name, pans and zooms, and watches frames change. |
| 7   | viewer | browser   | Pins a comment on a frame.                                               |
| 8   | agent  | CLI / MCP | Claims the comment, changes the frame, and resolves it with a reply.     |
| 9   | viewer | browser   | Sees the comment go claimed, then done, and sees the new frame, live.    |

When something goes wrong in production, a second story runs with no person in it:

| #   | Actor  | Door          | Step                                                                          |
| --- | ------ | ------------- | ----------------------------------------------------------------------------- |
| 1   | server | none          | Records the error under a fingerprint, in an error group.                     |
| 2   | tick   | host schedule | Sees an open server group and starts a fixer.                                 |
| 3   | fixer  | CLI, git, gh  | Claims the group, opens one GitHub issue, writes a failing test, ships a fix. |
| 4   | fixer  | CLI           | Waits until the fix is live, then resolves the group and closes the issue.    |
| 5   | probe  | GitHub        | Watches `/api/ready` and the tick from outside the host.                      |
| 6   | owner  | GitHub, CLI   | Acts only on a `needs-human` or `prod-down` issue.                            |

## Actors

### Owner

A user with the right to let others in. The owner is a person, or an agent that a person runs.

- Sets up a server: starts it, and logs in with the setup code. ([access](../SPEC-access.md#become-the-first-owner))
- Approves or denies login codes, and can make a new user an owner. ([access](../SPEC-access.md#join-a-server))
- Revokes a user. Cannot revoke or log out the last owner. ([access](../SPEC-access.md#revoke-a-user))
- Reads the server state and the error samples: `easel status`, `easel errors ls`. ([ops](../SPEC-ops.md#a-person-sees-the-state))
- Takes an error group that the fixer handed off (`needs-human` issue), and uses the runbook. ([fixer](../SPEC-fixer.md#a-fixer-fixes-an-error))
- Can do everything a member does.

### Agent (a member or an owner at work)

A user that works on canvases. It is a program with a token. It calls easel through the CLI with
`--json`, or through MCP.

- Joins a server: `easel login`, then waits for an owner. ([access](../SPEC-access.md#join-a-server))
- Adds easel to its MCP client, local (`easel mcp`) or remote (`/mcp` with a bearer token). ([mcp](../SPEC-mcp.md#a-local-agent-adds-easel))
- Makes, lists and deletes canvases. ([frames](../SPEC-frames.md#make-a-canvas))
- Puts, gets, moves, resizes and deletes frames, and gets a picture of a frame. On `stale`, gets the frame again and puts again. ([frames](../SPEC-frames.md#make-and-change-frames))
- Shares and unshares a canvas, and sets or removes its password. ([frames](../SPEC-frames.md#share-a-canvas))
- Works the queue: next, extend, resolve with a reply, or release. ([queue](../SPEC-queue.md#an-agent-works-the-queue))
- Changes only the frame that a comment is pinned on, whatever the comment's text asks. ([mcp](../SPEC-mcp.md#an-agent-works-through-mcp))
- Signs out with `easel logout`. ([access](../SPEC-access.md#sign-out))

### Viewer

A person with a share link and a browser. A viewer has no account and no token; the tab holds a
pass. A viewer changes no frame.

- Opens the link, types a name once per browser, and types the password if the link has one. ([frames](../SPEC-frames.md#open-a-share-link))
- Sees frames, pans and zooms. ([viewer](../SPEC-viewer.md#see-the-frames), [pan and zoom](../SPEC-viewer.md#pan-and-zoom))
- Watches agents add, change, move and delete frames, live. ([viewer](../SPEC-viewer.md#watch-an-agent-work))
- Pins a comment on a frame. ([viewer](../SPEC-viewer.md#pin-a-comment))
- Follows each comment in the comments panel: open, claimed, done with a reply, or stuck. ([viewer](../SPEC-viewer.md#follow-the-queue))
- Is sent to the ended page when the link ends, or to the password page when the password changes. ([viewer](../SPEC-viewer.md#when-the-link-ends))
- Uses the page with a keyboard, in a light or dark theme, with less motion if asked. ([design](../SPEC-design.md))

### Fixer

An agent that the tick starts, one per error group, at most two at once. It holds an owner token.
No person is in its loop.

- Claims one server error group, and extends the claim through the wrapper. ([fixer](../SPEC-fixer.md#a-fixer-holds-a-claim))
- Opens or reopens one GitHub issue for the group, reproduces the error as a failing test, and ships a fix with `ship.sh --fixer`. ([fixer](../SPEC-fixer.md#a-fixer-fixes-an-error))
- Proves the fix live, and resolves the group.
- Gives up after two shipped fixes that did not cure the error, or when the cause is not in the code. Then it labels the issue `needs-human`.
- Takes a `trunk-red` issue that is open for more than 10 minutes.

### System actors

These act on a clock or on an event. They have no model and make no choice.

| Actor  | Runs                             | Does                                                                                     |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| server | `easel serve`                    | Pushes each change to open tabs, records errors, ends leases, makes hourly backups.      |
| tick   | paseo schedule, every 5 minutes  | Stamps `fixerSeen`, starts fixers, closes finished issues, copies a backup off the host. |
| probe  | GitHub Actions, every 10 minutes | Reads `/api/ready`, opens or closes `prod-down`.                                         |
| CI     | GitHub Actions, on each push     | Runs the gates, deploys a green main, opens `trunk-red` on a red main.                   |

## Who can do what

| Action                         | Owner             | Member            | Viewer | Fixer |
| ------------------------------ | ----------------- | ----------------- | ------ | ----- |
| Approve, deny, revoke users    | yes               | no                | no     | no    |
| Make, change, delete canvases  | yes               | yes               | no     | no    |
| Put, move, delete frames       | yes               | yes               | no     | no    |
| Share, unshare, set a password | yes               | yes               | no     | no    |
| Look at a canvas in a browser  | with a share link | with a share link | yes    | no    |
| Pin a comment                  | with a share link | with a share link | yes    | no    |
| Claim and resolve comments     | yes               | yes               | no     | no    |
| Read the server status         | yes               | yes               | no     | yes   |
| Read error groups and samples  | yes               | no                | no     | yes   |
| Resolve or hand off a group    | yes               | no                | no     | yes   |
| Claim a group (fixer calls)    | yes               | no                | no     | yes   |

The fixer signs in as an owner, because every `ops.*` call but `ops.status` and every `fixer.*`
call runs the `owner` guard ([ops](../SPEC-ops.md), [fixer](../SPEC-fixer.md)). It uses only
the error calls.

Any user may work on any canvas: V1 has no per-canvas permissions ([access](../SPEC-access.md)).
