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

```sh
curl -fsSL https://acme.easel.example/install.sh | sh
```

This installs `easel` in `~/.local/bin` ([cli](../SPEC-cli.md#get-the-command-line)). To put it in a
different folder, set `EASEL_BIN_DIR`. It works on macOS (Apple chip) and on Linux (x64 and arm64).
The script checks the SHA-256 of the download before it installs it. If the script says that
`~/.local/bin` is not in your `PATH`, run the line that it shows. The last line shows the next step.

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

### Give the agent the easel tools (MCP)

An agent with MCP, such as Claude Code, can use easel as tools. After you approve the agent, tell
the agent to run this in its shell:

```sh
claude mcp add easel -- easel mcp
```

`easel mcp` uses the login of the agent, so it needs no token
([mcp](../SPEC-mcp.md#a-local-agent-adds-easel)). For a different MCP client, add the command
`easel mcp` in the same way. To see that it works, ask the agent to list the canvases of easel.

An agent on a different machine connects over HTTP with a token. Get the token with
`--print-token` (step 7.3), and give it to the MCP client of the agent:

```sh
claude mcp add --transport http easel https://acme.easel.example/mcp --header "Authorization: Bearer <token>"
```

Not built: the Claude web app (claude.ai), where each person signs in with their own easel
account. It waits for `mcp-auth` ([map](../MAP-round-1.md)).

## 4. The agent makes the first frame

Tell your agent: "Make a canvas in easel and put a page on it." It runs commands such as:

```sh
easel canvas new "First look"
easel put first-look page.html --name Home
```

`easel --help` shows each command to the agent. With MCP, the agent uses the tools `create_canvas` and `put_frame`.

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

With MCP, the agent uses the tools `next_request` and `resolve_request`.

The agent takes the request, changes the frame, and replies. You see the change in the browser at
once.

## 7. Requests from GitHub (if you want)

If your agents work from GitHub, easel opens an issue for each request in a private repository of
your team. The issue starts a run of your agent, and the run takes the request
([queue](../SPEC-queue.md#the-dispatcher-gets-a-request-to-the-agents)). This is the way of
[claude-code-action](https://github.com/anthropics/claude-code-action): a GitHub workflow that an
issue or a comment starts.

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

3. Get a token for the runs, and keep it in the repository as secrets
   ([cli](../SPEC-cli.md#sign-in-with-no-file)). This shows a code. Approve it in a second shell
   (`easel users approve <code>`). Then the token shows one time, as the only line on stdout:

   ```sh
   easel login https://acme.easel.example --name github --print-token
   ```

   With the GitHub CLI, the token can go into the secret directly, and the screen does not show
   it:

   ```sh
   easel login https://acme.easel.example --name github --print-token | gh secret set EASEL_TOKEN --repo acme/design
   ```

   In the repository, add the secrets `EASEL_SERVER` (the address of your easel) and
   `EASEL_TOKEN` (the token), and the key of your model, for example `ANTHROPIC_API_KEY`. To stop
   the runs, run `easel users revoke github`.

4. Add the workflow
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
         - run: |
             curl -fsSL "$EASEL_SERVER/install.sh" | sh
             echo "$HOME/.local/bin" >> "$GITHUB_PATH"
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
