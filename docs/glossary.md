# Glossary

This file lists the technical nouns and technical verbs of easel. Use each word with the meaning
given here, in specs, code, tests, CLI text and page labels.

## How this list is made

The list follows three sources:

- **ASD-STE100, Issue 9.** A project adds its own technical nouns and technical verbs to the STE
  dictionary (Rule 1.8). Do not use a technical noun as a verb (Rule 1.7).
- **ISO 704.** One term has one concept, and one concept has one term. A definition names the
  general class, then the property that makes the term different. The definition must be able to
  replace the term in a sentence.
- **The Kubernetes glossary.** It marks the terms that a reader must know to understand the other
  terms ("fundamental"). Here, these terms are in "Core terms".

A term goes into this list only when all three of these are true:

1. The term has a meaning special to easel.
2. A reader of a journey or a contract meets the term.
3. The common English meaning of the word is not enough.

A term that only one spec uses stays in that spec. The spec defines the term where it first uses
it. When this file and a spec do not agree, the spec is correct. Change this file in the same ship.

## Core terms

You must know these terms to read any spec.

| Term        | Type | Definition                                                                                        |
| ----------- | ---- | ------------------------------------------------------------------------------------------------- |
| agent       | noun | A program that uses easel through the CLI or MCP.                                                 |
| user        | noun | A name and a token on one server. A user can change canvases. Most users are agents.              |
| owner       | noun | A user that can also approve, deny and revoke users.                                              |
| member      | noun | A user that is not an owner.                                                                      |
| viewer      | noun | A person who opens a share link in a browser. A viewer can look and ask, but not change a frame.  |
| canvas      | noun | A plane with no edge that holds frames. Each canvas has a name and a canvas key.                  |
| frame       | noun | One HTML document on a canvas, with a position and a size. Only an agent writes it.               |
| version     | noun | The number of a frame document. It starts at 1 and increases when a put changes the document.     |
| share link  | noun | A URL that lets a viewer see one canvas and ask for changes. A canvas has one share link or none. |
| request     | noun | A change that a viewer asks for, at one place on a frame or on the canvas. It holds messages.     |
| message     | noun | One entry in a request: the ask, a question, an answer, a result, a note. No call changes it.     |
| queue       | noun | All waiting requests of all canvases, oldest first. Agents take requests from it.                 |
| claim       | verb | To take one request or one error group for a lease. Only the claim holder can then change it.     |
| lease       | noun | The time that a claim stays live. When the lease ends, another agent can claim the item.          |
| resolve     | verb | To mark a claimed item as finished, with a result. Its status becomes `resolved`.                 |
| error group | noun | All production errors that have the same fingerprint.                                             |
| fixer       | noun | An agent that claims an error group, ships a fix, and proves that the fix is live.                |

## Business terms

| Term      | Type | Definition                                                                                   |
| --------- | ---- | -------------------------------------------------------------------------------------------- |
| company   | noun | The business that offers easel and operates it. It is an actor in the rounds.                |
| team      | noun | The customer of a round: the people and the agents that use one easel.                       |
| team lead | noun | The person of a team who agrees the price, pays, and gets the setup code.                    |
| round     | noun | A set of requirements that must ship together, so that the company can offer and operate it. |

## Terms for each module

### Access

| Term       | Type | Definition                                                                                |
| ---------- | ---- | ----------------------------------------------------------------------------------------- |
| token      | noun | 32 random bytes that identify a user. The CLI makes it. The server keeps only its digest. |
| login code | noun | A one-time code that `easel login` shows. It stops after 10 minutes.                      |
| setup code | noun | A one-time code in the server log when the server has no user. It makes the first owner.  |
| approve    | verb | To accept a login code. Only an owner can approve.                                        |
| deny       | verb | To refuse a login code. Only an owner can deny.                                           |
| revoke     | verb | To remove a user. The token of that user stops at once.                                   |

### Frames and sharing

| Term         | Type      | Definition                                                                                                                              |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| canvas key   | noun      | The short ID of a canvas. easel makes it from the name: `Checkout flow` gives `checkout-flow`.                                          |
| put          | verb      | To write the document of a frame. Without a frame ID, a put makes a new frame.                                                          |
| base         | noun      | The version that a writer read before a put. If the base is not the current version, nothing changes.                                   |
| picture      | noun      | An image of one version of a frame. Chromium on the server draws it.                                                                    |
| kept version | noun      | An old version of a frame that a request or a message refers to. easel keeps it until the canvas is removed.                            |
| share        | verb      | To make the share link of a canvas, with or without a password.                                                                         |
| unshare      | verb      | To stop the share link of a canvas. A new share makes a new link.                                                                       |
| pass         | noun      | A random value that a browser tab gets when it opens a share link. It stops when the link stops or the password changes.                |
| look         | noun      | The colors, type, sizes and shapes that all frames of one easel share. It is not the look of the easel page (design).                   |
| kit          | noun      | The pieces of screen in the look (a button, a field, a card) that agents use to make frames. Each easel has one.                        |
| look value   | noun      | One named value of the look, such as the main color. It is not a token: a token is only an access token.                                |
| piece        | noun      | One part of the kit: a class for a common control, or a short tag that the frame expands.                                               |
| kit version  | noun      | The number of one state of the look and the kit. It starts at 1 and increases at each change of either. It never changes.               |
| text key     | noun      | The name of one text of the team, such as `trial.start`. A frame shows a text by its text key.                                          |
| team text    | noun      | One text in the one list of texts of an easel, in `en` and, if given, in `vi`. It is in the kit version.                                |
| exploring    | adjective | The status of a new app frame. It may have its own texts, and colors and sizes that are not in the look.                                |
| ready        | adjective | The status of an app frame that settled each text, color and size: each is in the texts of the team or the look.                        |
| own text     | noun      | A text that a frame shows with no text key: a text in the markup of an HTML frame, or an own text of a part or the JSX of an app frame. |
| made CSS     | noun      | The CSS that easel makes from the class names of a frame version or a kit version, and keeps with it.                                   |
| pane         | noun      | A control of an app frame that the viewer draws beside it, in its own iframe and scope. It is a React component of the frame.           |
| pane link    | noun      | The channel between a pane and the scope of its frame. The pane reads the frame and calls it on the pane link.                          |

### Viewer page

| Term          | Type | Definition                                                                        |
| ------------- | ---- | --------------------------------------------------------------------------------- |
| frame shell   | noun | The light form of a frame on the page: its name and its picture, or a plain card. |
| live document | noun | A frame that shows in a sandboxed iframe. The page keeps a maximum of 12.         |
| pin           | noun | The mark of a request on its frame. It moves when the frame moves.                |

### Queue

| Term            | Type | Definition                                                                                                             |
| --------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| claim handle    | noun | A random value that a claim gives. Each later call on the request must include it.                                     |
| try             | noun | One claim of a request. It ends with an outcome, or with no outcome (a release, or a lease that runs out).             |
| outcome         | noun | The end of a try that takes the request out of the queue: a result, a question, or a decline.                          |
| release         | verb | To give a claim back with a reason, and no outcome. The request goes to the back of the queue. The try counts.         |
| decline         | verb | To give a request to a person, with a reason, because no agent can do it.                                              |
| needs a person  | adj. | Said of a request that an agent declined, or that had 3 tries with no outcome. Agents do not get it.                   |
| may be outdated | adj. | Said of a waiting request when its frame changed or was removed, or when it is more than 7 days old.                   |
| client key      | noun | A random value that the page makes for each request. If the page sends the request again, easel saves it one time.     |
| channel         | noun | A place where the dispatcher delivers waiting requests: a GitHub repository or a NATS subject. Epics say "way".        |
| dispatcher      | noun | The part of the server that delivers each waiting request to each channel, one time for each waiting period.           |
| delivery        | noun | One time that the dispatcher gives a request to a channel, for one waiting period. It is sent, or failed with a cause. |
| waiting period  | noun | One time that a request is waiting: from the post, or from a return to the queue, to the next claim.                   |
| nkey            | noun | The key that a NATS client signs in with. Its seed is secret. Its public key starts with `U`.                          |
| agree           | verb | To let a request start the work of an agent. Only an owner (the person) agrees. Not "approve", which is for a login.   |
| agreement       | noun | The time and the owner that agreed to a request as it is now. A new text of a viewer ends it.                          |
| starter         | noun | A service that starts an agent for each message on a NATS channel, such as the Paseo adapter. It reports to easel.     |
| limit           | noun | The most agents that the starter of a channel runs at the same time, or starts in a UTC day. An owner sets it.         |
| hold            | noun | The cause that a waiting request does not start an agent: no agreement, a limit, a failed start, a refusal, silence.   |

### Errors and the fixer

| Term        | Type | Definition                                                                                                                              |
| ----------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| fingerprint | noun | A SHA-256 of the side, the operation, the error name and the message without numbers or IDs.                                            |
| build       | noun | The number of commits on `main` up to and including a commit. A fix is live when the live build is equal to or more than the fix build. |
| hand off    | verb | To give an error group to a person. Its status becomes `human`.                                                                         |
| tick        | noun | A script that a paseo schedule runs each 5 minutes. It starts a fixer only when there is work.                                          |
| probe       | noun | A GitHub Actions workflow that reads `/api/ready` each 10 minutes, from outside the host.                                               |

## Words that must change

These words break the rules above. The right column gives the recommended change.

| Word  | Problem                                                                                      | Change                                                                   |
| ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| shell | Two meanings: the CLI "shell" (SPEC-cli) and the frame shell (SPEC-viewer).                  | Use "frame shell" for the page. Use "CLI" for the command line.          |
| board | Two meanings: the Tinker remote data board, and a canvas ("open a board" in AGENTS.md).      | Use "canvas" for the product. Use "board" only for Tinker remote data.   |
| issue | Three meanings: a GitHub issue, an ops "issue" (SPEC.md), and the template `src/issues`.     | Use "error group" for ops. Use "issue" only for a GitHub issue.          |
| key   | Six meanings: canvas key, picture key, key generation, client key, picture secret, text key. | Always write the full term. Do not write "key" alone.                    |
| claim | A verb and a noun (STE Rule 1.7).                                                            | Use "claim" as a verb only. For the noun, use "claim handle" or "lease". |
| put   | A verb and a noun ("a put", STE Rule 1.7).                                                   | Use "put" as a verb only. For the noun, use "write".                     |
| user  | In common English, any person. In easel, a token holder.                                     | Use "person" for a human. Use "user" only for a token holder.            |

## Terms that are not in this list

These terms stay in their own source:

- **Tinker terms** (capsule, operation, kind, refused, exit, board): in the Tinker skills.
- **Ship terms** (ship, gate, `trunk-red`, smoke): in `AGENTS.md`.
- **Internal names** (`mayRead`, picture key, key generation, wrapper, hosts file, `fixerSeen`,
  readiness check, sample): in the module spec that owns them.
- **Answer kinds** (`stale`, `gone`, `lost`, `empty`, `taken`, `wrongState`): in the contract of each spec.
- **Page labels and numbers** (Reconnecting, Fit, request mode, at rest): in SPEC-viewer.
- **Common words** (person, question, answer, password, box): these have their usual meaning.
