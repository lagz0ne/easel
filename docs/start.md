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

This prints a link. Open it in a browser. You see the frame. Send the link to
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

If your agents work from GitHub, easel opens an issue for each request in a private repository of
your team. The issue starts a run of your agent, and the run takes the request
([queue](../SPEC-queue.md#the-dispatcher-gets-a-request-to-the-agents)). This is the way of
[claude-code-action](https://github.com/anthropics/claude-code-action): a GitHub workflow that an
issue or a comment starts.

Steps 1, 2 and 5 work now. Steps 3 and 4 are not built: a run cannot get the command line or
sign in to easel yet.

1. Make a fine-grained personal access token of a real GitHub user, for example a bot account of
   your team. Give it "Issues: Read and write" on the repository only. Do not use the
   `GITHUB_TOKEN` of a workflow: GitHub starts no workflow for an issue or a comment that it
   makes.
2. Put the token in a file, then connect the repository. Easel checks that the repository is
   private, and makes the label:

   ```sh
   easel channel set gh github --repo acme/design --label easel --token-file token.txt
   rm token.txt
   ```

3. Not built ([cli](../SPEC-cli.md#sign-in-with-no-file)). Get a token for the runs, and keep it
   in the repository as secrets:

   ```sh
   easel login https://acme.easel.example --name github --print-token
   ```

   In the repository, add the secrets `EASEL_SERVER` (the address of your easel) and
   `EASEL_TOKEN` (the token), and the key of your model, for example `ANTHROPIC_API_KEY`.

4. Not built ([cli](../SPEC-cli.md#get-the-command-line)). Add the workflow
   `.github/workflows/easel.yml`. A new issue with the label starts it, and a
   comment that starts with the trigger (`@claude`) starts it again. A new issue with a label
   also sends `labeled`, so `opened` is not necessary.

   ```yaml
   on:
     issues:
       types: [labeled]
     issue_comment:
       types: [created]
   permissions:
     contents: read
     issues: write
     id-token: write
   jobs:
     work:
       if: >-
         (github.event_name == 'issues' && github.event.label.name == 'easel') ||
         (github.event_name == 'issue_comment' && startsWith(github.event.comment.body, '@claude'))
       runs-on: ubuntu-latest
       env:
         EASEL_SERVER: ${{ secrets.EASEL_SERVER }}
         EASEL_TOKEN: ${{ secrets.EASEL_TOKEN }}
       steps:
         - run: curl -fsSL "$EASEL_SERVER/install.sh" | sh
         - uses: anthropics/claude-code-action@v1
           with:
             anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
             prompt: >-
               Run the easel next command in this issue. If it answers empty, stop. Else do the
               request, then end it with easel resolve, ask or decline.
   ```

5. Ask for a change on a shared canvas. Within 1 minute, the issue shows in the repository, and
   the run starts. `easel deliveries <canvas> <n>` shows each delivery and its cause.

## Help

Write to the help address of the company (R4). Send a share link of the canvas, so that the company
sees what you see.
