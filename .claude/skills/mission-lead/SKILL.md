---
name: mission-lead
description: Leads one easel mission from its outcome to the report. The lead asks Socratic questions to fill the top of the mission file tasks/<mission>.md (Mission, Success, Nono, Verify), talks to the other leads of the shared checkout, gives each task to a worker subagent, reviews each diff, verifies, ships, and knows when to stop for the person. Use when the person gives a mission (a feature or a fix), when a task goes to a subagent or its result comes back, when the work needs a thing that the Nono refuses, or when another mission touches the same file.
---

# Mission lead

The rules are in [AGENTS.md](../../../AGENTS.md), "Leads and missions"; that section wins. You are
a lead: you do all that your mission needs, through workers.

## The mission file

Make `tasks/<mission>.md` with this top. A file in `tasks/` with no "Mission" part is not one.

```markdown
# Mission: <name>

Lead: <agent name>. Accepted: <date, the words of the person>. Done: <sha, date>.

## Mission

<What a person or an agent can do at the end, in one sentence.> (<epic and requirement IDs>)

## Success

- <a check that a person can see, and that can fail>

## Nono

- Not in: <a thing that the mission does not do>. Back when <the case>.
- Must not: <a thing that no agent of the mission does>. Only the person lifts it.

## Verify

- <the check: the command or the click path, and what shows a pass>
- A new reviewer subagent that did not build the work.
- Live: `/api/version` shows the ship. Confirms: <the person, or the live proof for a fix>.

## Touching

- `<path>`

## Plan

- [ ] <task>: paths; what is true when done; the check
```

## The questions

Look in the code and the docs first. Ask the person only what is theirs to decide, with 2 or 3
options and your pick. Stop when no part has an unknown.

- **Mission:** What can a person do at the end that they cannot do now? Which requirement needs
  it? Is there a smaller outcome with the same value?
- **Success:** What will you see when it works? Can this check fail? If each check passes, can the
  outcome still be absent?
- **Not in:** What is near, but not part of this? Which case brings it back?
- **Must not:** What must stay as it is (data, a contract, speed)? What broke before? What do we
  do if the mission needs it?
- **Verify:** Which check proves each success check? Can it pass while the work is broken? Who
  confirms, and where do they look?

The rules of `AGENTS.md` always apply; do not copy them into "Must not". For a new need, use
`writing-requirements`. For a design, write a delta spec `SPEC-<name>.md`, not `SPEC.md`.

## After a wait

When you wake after a wait, count your compactions first. At 2 or more, hand over with `paseo-handoff` before you build.

## The other leads

Do the steps of "Leads talk" in `AGENTS.md`: one message at the start, agree before you change a
file of another mission, tell after a ship that it uses, keep "Touching" current. When the mission
is done, empty "Touching" and fill "Done".

## Workers

A worker has a new context and cannot ask the person. Give it all of this:

```
You are a worker on the mission <mission> of easel, in a checkout that other agents share.
Read first: AGENTS.md, tasks/<mission>.md, <spec section, files>.
Task: <one task of the plan, and the success checks that it serves>.
Paths: <paths>. Do not edit, format, revert or stash a file outside them.
Nono: <the Not in and Must not lines that this task can meet>.
Write the failing test first. Use `offload -- <command>` for a heavy run, `work new` for temp files.
Run one `offload` at a time. Give a short check `--timeout 5min`, so it goes first.
Give the Bash call 600 s or more, or run it in the background: an easel run waits in line 30 min or more.
Do not run scripts/ship.sh, git add, git commit or git push. If the task needs more, stop and say so.
Verify: <the exact command, and the output that shows a pass>.
Give back: each file and what changed, the output of the verify command, what you did not confirm.
```

Keep each worker small: one worker makes one ship, on exact paths. Split a task that needs more than about 60 tool calls. Tell the worker to send long output to a file and read its end. (Retro 2026-11-25: a worker of the largest session used 34.8 M tokens.)

- Only one worker at a time writes a set of paths. Workers that only read can run together.
- Read the diff, and run the verify command yourself. Only you ship, and only a reviewed diff.
- The reviewer is a new subagent in each pass. Give it the mission file and the diff, not your
  conclusions. It gives `proven`, `partly` or `not` for each success check, and each broken Nono.

## Stop rules

- The work needs a Nono item, or the mission must change: stop, and bring options and your pick.
- "Verify" failed 5 times: stop, and report what is open and the cause that you see.
- A new need shows that no requirement has: it is "Not in" until the person agrees.
- All other decisions: decide, and put each one in the report.

## Red flags

- A build that starts before the person accepted the top.
- A success check that cannot fail, or that only a log can show.
- A change to a file of another open mission, with no message to its lead.
- A result of a worker that you did not verify yourself.
- "Done" with no live proof, or with no report.
