# Mission: observe and improve

- **Lead:** m: observe and improve (paseo fdcbcfb9). **Accepted:** 2026-11-25, the person: "Every few hours"; "Ship small doc and skill changes; bring bigger ones to you". **Done:** -

## Mission

Learn from the work of all easel sessions, and make the next work faster, cheaper in tokens and more correct.

## Success

- S1. One retro of the work from 2026-11-17 to now answers "if we do it again, what do we do differently". Each point has evidence: a session, a commit, a number.
- S2. Each retro gives numbers for speed, token economy and correctness, from a script that anyone can run again.
- S3. Each retro ends in at most 3 changes. Each change is shipped (AGENTS.md, a skill, a script) or brought to the person.
- S4. The retro runs again every 4 hours, and each run compares its numbers with the run before.
- S5. The observer ships a small change to a doc or a skill itself, and reports it. A change to the workflow or to a mission goes to the person with a recommendation.

## Nono

Not in:

- The sessions of other projects (create, work). Add them when the person asks for it.
- A dashboard or a page on the live easel. Add it when a retro shows that a file is not enough.

Must not:

- Change the code, the files or the mission of a lead. Tell the lead instead.
- Interrupt a lead in its turn. Use a queued message.
- Copy transcript text out of the machine, or put a secret or a token into a retro.

## Verify

- `retro.ts` gives the same numbers on a second run over the same window.
- A new reviewer subagent checks each point of a retro against its evidence.
- The person reads the retro and accepts or comments.

## Touching

- `tasks/observe.md`
- Small fixes to `AGENTS.md` and `.claude/skills/mission-lead/`, one line each, with the retro that asks for it.
- Outside the repo, because a retro quotes the transcripts: `/home/rocky/work/tmp/2026-11-25-easel-retro/` holds `retro.ts`, its output and each retro `retro-<UTC>.md`.

## Plan

1. Done: `retro.ts` (worker) gives the numbers and the digests. Two runs on one window give the same output.
2. Done: the first retro, `retro-2026-11-25T09.md`. Shipped its 3 small changes: worker size, session life, the rule for dirty files after a restart.
3. Brought to the person: ship preflight and record (`scripts/ship.sh`), and the dispatcher check (no agent for a change that is live).
4. Every 4 hours, a new scheduled session runs the retro on the window since the last one, and compares the numbers. It ends when its retro is written.
