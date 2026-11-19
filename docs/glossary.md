# Glossary

The words that easel uses in its specs, its code, its CLI and its page. One word has one meaning.
When you write a spec, a test name, a CLI message or a label, use the word from this list.

Prior art: the "ubiquitous language" of Domain-Driven Design (Eric Evans, 2003). The team, the code
and the docs use one set of words, and a word with two meanings gets a second, longer name.

The source of each term is the spec in brackets. When a spec and this file disagree, the spec is
correct, and this file changes in the same ship.

## People and roles

| Term        | Meaning                                                                                                                                             | Spec           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| person      | A human. A person can be a user (through an agent or the CLI) or a viewer.                                                                          | SPEC.md        |
| agent       | A program that calls easel through the CLI or MCP. Most users are agents.                                                                           | SPEC.md        |
| user        | A name and a token on one server. A user works on canvases. A user is an owner or a member.                                                         | access         |
| owner       | A user who may also approve, deny and revoke users. A server that has an owner always has one.                                                      | access         |
| member      | A user who is not an owner.                                                                                                                         | access         |
| first owner | The user who logs in with the setup code. The setup code works once.                                                                                | access         |
| viewer      | A person who opens a share link in a browser. A viewer has a pass, not a token. A viewer looks and comments, and changes no frame.                  | frames, viewer |
| viewer name | The name a viewer types once per browser. easel does not check it. It shows on each comment the viewer posts.                                       | viewer         |
| fixer       | An agent that fixes production errors. A fixer run works on one error group.                                                                        | fixer          |
| tick        | The script `scripts/fixer-tick.sh`. A paseo schedule runs it every 5 minutes. It uses no model, and it starts a fixer only when there is work.      | fixer          |
| wrapper     | The script `scripts/fixer-run.sh`. It claims an error group, starts the fixer agent, extends the claim, and stops the agent when the claim is lost. | fixer          |
| probe       | A GitHub Actions workflow outside the host. It reads `/api/ready` every 10 minutes and opens a `prod-down` issue on a failure.                      | fixer          |

## Sign-in

| Term       | Meaning                                                                                                                        | Spec   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| server     | One running `easel serve`, with one SQLite file. The CLI keeps one token for each server.                                      | cli    |
| token      | 32 random bytes that the CLI makes. The server keeps only its SHA-256 digest. A token is the whole identity of a user.         | access |
| login code | A one-time code (`KDFX-8QWP`) that `easel login` prints. An owner approves or denies it. It expires after 10 minutes.          | access |
| setup code | A one-time code in the server log, while the server has no user. The login that gives it makes the first owner.                | access |
| approve    | An owner accepts a login code. The token of that login works from then on.                                                     | access |
| deny       | An owner refuses a login code. The CLI keeps nothing.                                                                          | access |
| revoke     | An owner removes a user. The token of that user stops at once, and the name is free again.                                     | access |
| hosts file | `~/.config/easel/hosts.json`. The CLI keeps each token and each pending login there.                                           | cli    |
| auth mode  | `EASEL_AUTH`: `approve` (the default) or `open`. In `open` mode each login is an owner at once, for one person on one machine. | access |

## Canvas and frames

| Term           | Meaning                                                                                                                                         | Spec   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| canvas         | An endless plane that holds frames. Each canvas has a name and a canvas key.                                                                    | frames |
| canvas key     | The short id of a canvas, made from its name: `Checkout flow` gives `checkout-flow`.                                                            | frames |
| frame          | One HTML document that an agent wrote, with a box on its canvas.                                                                                | frames |
| document       | The HTML of a frame. Its size is measured in UTF-8 bytes.                                                                                       | frames |
| box            | The place and size of a frame on its canvas: x, y, w, h. The default size is 1440×900.                                                          | frames |
| version        | A number for each document of a frame. It starts at 1 and goes up on each put that changes the document. A move does not change it.             | frames |
| put            | A write of a frame's document. A put with no id makes a frame. A put with an id names the base.                                                 | frames |
| base           | The version that the writer read. A put on a base that is not the current version answers `stale`.                                              | frames |
| stale          | The answer to a put whose base is old. The writer gets the frame again and puts again. This is optimistic concurrency (HTTP `If-Match`, `412`). | frames |
| picture        | An image of one version of a frame, drawn by Chromium as a browser draws it. With no Chromium, pictures are off.                                | frames |
| shot           | The CLI command and the call that give the address of a picture. "Shot" is the action; "picture" is the image.                                  | frames |
| picture key    | `k`: the HMAC that signs a picture address. A picture address with an old picture key does not work.                                            | frames |
| key generation | A number for each canvas. It goes up when the link ends or its password changes, and that ends every old picture address.                       | frames |

## Sharing

| Term          | Meaning                                                                                                                                              | Spec   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| share link    | The URL that lets anyone who has it look at one canvas and comment. A canvas has one share link at a time, or none.                                  | frames |
| share         | Make the share link of a canvas, or print it again. `--password` sets the password.                                                                  | frames |
| unshare       | End the share link. Sharing again makes a new link; the old one stays ended.                                                                         | frames |
| link password | An optional password on a share link, 8 characters or more. After 5 wrong tries in a minute from one address, the link takes no password.            | frames |
| pass          | A random value that a viewer's tab gets when it opens a link. The tab sends it on each call. A pass ends when its link ends or its password changes. | frames |
| gate          | The pages in front of the canvas: the viewer name, the password, and the ended page.                                                                 | viewer |
| ended page    | The page that says a link has ended or is unknown, and shows nothing else.                                                                           | viewer |
| `mayRead`     | The guard on each canvas read: a live user token, or a live pass for that canvas.                                                                    | frames |

## Viewer page

| Term           | Meaning                                                                                                            | Spec   |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| frame shell    | The cheap form of a frame on the page: its name label and its picture, or a plain card with pictures off.          | viewer |
| live document  | A frame shown in a sandboxed iframe. At most 12 are live at rest, and only at a zoom of 30% or more.               | viewer |
| at rest        | 120 ms with no pan or zoom. Frames go live only at rest.                                                           | viewer |
| fit            | The zoom that shows all frames, with a 40 px edge, never past 100%.                                                | viewer |
| comment mode   | The mode that the `Comment` button turns on. A click on a frame then opens a comment textbox at that place.        | viewer |
| pin            | The mark of a comment on its frame (button `Comment #<n>`). It moves with the frame.                               | viewer |
| comments panel | The `Comments` region that lists the comments of the canvas, oldest first, with their states.                      | viewer |
| Reconnecting   | The status the page shows while its socket is down. The page reads the whole canvas again when the socket is back. | viewer |

## Comments and the queue

| Term           | Meaning                                                                                                                                                                                                   | Spec  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| comment        | Text that a viewer pins at a place on a frame. It has a number `n`, the viewer name, and a state.                                                                                                         | queue |
| comment key    | A random key that the page makes for each comment. A retry with the same key saves the comment once (an idempotency key).                                                                                 | queue |
| queue          | The open comments of all canvases, oldest first. Agents take them from it.                                                                                                                                | queue |
| claim          | An agent takes a comment for a time (`easel next`). The answer carries a claim handle. Every later write on that comment carries it.                                                                      | queue |
| lease          | The time a claim lasts: 300 s by default, 30 s to 3600 s. `extend` starts it again. This is the SQS visibility timeout.                                                                                   | queue |
| release        | An agent gives a claim back. The comment goes to the back of the queue, and the attempt does not count.                                                                                                   | queue |
| resolve        | An agent marks a comment done, with a reply.                                                                                                                                                              | queue |
| reply          | The text an agent writes when it resolves a comment. Viewers see it in the panel.                                                                                                                         | queue |
| attempt        | Each claim of a comment counts one attempt. A release takes its attempt back; an extend or a resolve adds none.                                                                                           | queue |
| comment states | `open`: no live claim. `claimed`: a live claim. `done`: resolved. `stuck`: three claims ran out. easel stores only `open` and `done`; it works out `claimed` and `stuck` from the lease and the attempts. | queue |
| `lost`         | The answer to a write with a claim that is no longer live.                                                                                                                                                | queue |
| `empty`        | The answer to `next` when no comment can be taken. It is a success, not an error.                                                                                                                         | queue |

## Errors and the fixer

| Term            | Meaning                                                                                                                                                     | Spec  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| error           | A thrown operation, a log record at level error or above, a server panic, or an uncaught page error. An answer kind or a `refused` is not an error.         | ops   |
| fingerprint     | The SHA-256 of the side, the operation label, the error name and the error message with numbers and ids removed. Errors with one fingerprint are one group. | ops   |
| error group     | All errors with one fingerprint. It has a count, the builds it was seen on, a sample and a status.                                                          | ops   |
| side            | `server` or `browser`. A browser group is unconfirmed: easel counts it, but no fixer works on it.                                                           | ops   |
| sample          | One error message of a group, with secrets removed. Only owners can read it. It never goes into a GitHub issue.                                             | ops   |
| group status    | `open`, `resolved`, `regressed` or `human`. `open` and `regressed` groups are the fixer's work list.                                                        | ops   |
| regressed       | A resolved group that is seen again on a build at or after its fix.                                                                                         | ops   |
| hand-off        | Mark a group `human`: a person takes it. The fixer does this when it gives up.                                                                              | ops   |
| build           | The number of commits on main up to a commit (`git rev-list --count`). A fix is proven when the live build is at or after the fix's build.                  | ops   |
| readiness check | One check that `/api/ready` runs, for example free disk or Chromium. `/api/ready` answers 200 only when all pass.                                           | ops   |
| `fixerSeen`     | When the tick last ran. When it is older than 30 minutes, `fixerSilent` is true.                                                                            | ops   |
| group claim     | A fixer's claim on an error group: 15 minutes, extended every 5 minutes, at most 3 hours. Every write on the group carries it.                              | fixer |
| GitHub issue    | An issue in the repo. The labels are `prod-error`, `fp:<…>`, `needs-human`, `prod-down` and `trunk-red`.                                                    | fixer |

## Shipping

| Term       | Meaning                                                                                                             | Spec      |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | --------- |
| ship       | One commit landed on main through `scripts/ship.sh`, after its gate is green.                                       | AGENTS.md |
| gate       | The checks that `ship.sh` runs before it commits: style, `tinker check`, build, smoke.                              | AGENTS.md |
| trunk-red  | The GitHub issue that CI opens when main is red. Only a fix forward or a revert ships until it closes.              | AGENTS.md |
| smoke      | `bun run smoke`: the built binary in a real browser, for the critical paths only.                                   | AGENTS.md |
| statechart | A TLA+ model of one flow with state, checked with TLC and drawn as Mermaid. It is the oracle that the tests follow. | SPEC.md   |

## Tinker words

| Term      | Meaning                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| capsule   | A feature (`src/<module>/index.ts`).                                                                       |
| operation | An action: label, zod input, depends, run, and an answer `kind` union.                                     |
| kind      | One answer of an operation, for example `stale`. Each call lists which kinds are a success.                |
| refused   | A fault that a guard gives: the caller may not make the call.                                              |
| board     | Tinker's remote data board: the live server state that the page reads over the socket. It is not a canvas. |
| exit      | One way out of an operation: a kind, a refusal or a plain return. A test must reach each one.              |

## Words with two meanings

These words have two meanings in the specs now. Use the longer name on the right.

| Word    | Meanings now                                                                               | Use                                                                        |
| ------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| key     | canvas key, picture key `k`, key generation, comment key, the picture secret               | Always say which key. Never write "key" alone.                             |
| shell   | the CLI "shell" (SPEC-cli), and the frame shell on the page (SPEC-viewer)                  | "frame shell" on the page. "The CLI" for the command line.                 |
| board   | Tinker's remote data board, and "open a board" for a canvas (AGENTS.md smoke text)         | "canvas" for the product. "board" only for Tinker's remote data.           |
| issue   | GitHub issue, ops "issues" (SPEC.md capability map), and the template's `src/issues` board | "error group" for ops. "issue" only for a GitHub issue.                    |
| claim   | a comment claim (queue) and a group claim (fixer)                                          | "comment claim" and "group claim" when both can apply.                     |
| resolve | a comment goes `done`; an error group goes `resolved`                                      | "resolve a comment" and "resolve a group". Keep the two state names apart. |
| gate    | the viewer's gate pages, and the ship gate                                                 | "viewer gate" and "ship gate".                                             |
| user    | in plain text, "user" can mean any person; in easel it is a token holder                   | "person" for a human, "user" only for a token holder, "viewer" for a link. |
