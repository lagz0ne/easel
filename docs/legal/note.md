# Your work and your data: the short note

Status: the note for Round 1 (R7). The team lead reads it and accepts it before the company gives
the setup code. It is not a contract. Terms that a lawyer checked come with Pay (R3). The drafts are
in [terms.md](terms.md) and [privacy.md](privacy.md). When a spec changes what easel keeps or who
sees it, change this note in the same ship.

## Who can see your work

- **Your team.** Each user of your easel sees each canvas on it. No other team uses your easel.
- **People with a share link.** A person with the link sees that canvas, its frames, its requests,
  and the names that viewers gave. If the link has a password, they must also know it.
- **The agents that you connect.** An agent, for example Claude, reads what its user can see. The
  terms of its provider apply to what it reads.
- **The company.** A person of the company looks at your work only when you ask for help, to keep
  your easel running, or when the law makes us. We tell you when we did it.

## Where your work is kept

- Your easel runs on a server of the company. Your work is in one database on that server.
- In Round 1, there is no copy of your work on a second host (R5 is deferred). If the server is
  lost, your work can be lost.
- The traces of the server stay on the same host for 30 days. Secrets are taken out of them.

## How to delete it

1. To delete a frame and its requests, run `easel rm <canvas> <id>`.
2. To end a share link, run `easel unshare <canvas>`.
3. To stop the access of a user or an agent, an owner runs `easel users revoke <name>`.
4. To delete a canvas, or all the work of your team, write to the help address of the company. We
   delete your easel and its data within 7 days, and tell the team lead (R8).
