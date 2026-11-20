# Start with easel

These are the start steps for the team lead of a new team (Round 1, R2). With them, the team lead
and one agent have a first frame on a shared canvas within 30 minutes. They need no help from the
company.

Status: easel does not have each step yet. Each step names the spec that holds it. A step marked
"not built" waits for its spec. Do not give these steps to a team before each step is built and a
person of the company did them on a clean machine, in 30 minutes or less.

## What you get from the company

- The address of the easel of your team, for example `https://acme.easel.example`.
- A setup code, for example `QRTX-7MNP`. It works one time.
- The terms and the privacy text. Accept them before you get the code (R7).

## 1. Get the command line

Not built ([cli](../SPEC-cli.md#get-the-command-line)).

```sh
curl -fsSL https://acme.easel.example/install.sh | sh
```

This installs `easel` in `~/.local/bin`. It works on macOS (Apple chip) and Linux.

## 2. Take charge of your easel

```sh
easel login https://acme.easel.example --name ann --setup QRTX-7MNP
```

You are the owner now. If the code does not work, ask the company for a new one.

## 3. Let your agent in

Tell your agent to run this, with a name for the agent:

```sh
easel login https://acme.easel.example --name builder
```

The agent shows a code, for example `KDFX-8QWP`, and waits. In your own shell, see who asks, then
agree:

```sh
easel users
easel users approve KDFX-8QWP
```

## 4. The agent makes the first frame

Tell your agent: "Make a canvas in easel and put a page on it." It runs commands such as:

```sh
easel canvas new "First look"
easel put first-look page.html --name Home
```

`easel --help` shows each command to the agent.

## 5. Share the canvas

```sh
easel share first-look
```

This prints a link. Open it in a browser and give your name. You see the frame. Send the link to
your team. They need no account. To protect the link, add `--password` and a password of 8
characters or more.

## 6. Ask for a change

In the browser, select `Request`, click on the frame, write what to change, and select `Send`.

Then tell your agent to work the requests:

```sh
easel next --wait 600
```

The agent takes the request, changes the frame, and replies. You see the change in the browser at
once.

## 7. Requests from GitHub (if you want)

Not built ([queue](../SPEC-queue.md)). If your agents work from GitHub, easel can open an issue for
each request in a private repository of your team. Ask the company for these steps.

## Help

Write to the help address of the company (R4). Send a share link of the canvas, so that the company
sees what you see.
