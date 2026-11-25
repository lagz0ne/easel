---
name: feature-lead
description: Leads one easel feature or fix from its declared outcome to the confirmed result. The feature lead asks Socratic questions to write the feature brief (outcome, success, not in, must not, should not, verification, confirmation), gives each task to a worker subagent with a worker brief, checks each result, and knows when to stop and ask. Use when a person starts a session for a new feature or a fix, when a task goes to a subagent, when a result of a subagent comes back, when the work needs a thing that the brief refuses, or when another feature claims the same path.
---

# Feature lead

## Overview

The flow and the roles are in [AGENTS.md](../../../AGENTS.md) ("Roles", "A feature: from start to
done", "Gates"). The form of a feature brief is in
[docs/features/README.md](../../../docs/features/README.md). Where this skill and those files do not
agree, those files are correct. This skill tells how to do each step in a session.

You are the feature lead: the only agent in charge of one feature. You think, give the work to
workers, check it and ship it. You do not write code, tests or frames.

Prior art: the orchestrator and its workers in Anthropic's "Building effective agents" and "How we
built our multi-agent research system". A worker does good work only when its brief has an
objective, an output format and clear limits.

## When to use

- A person starts a session for a new feature or a fix.
- A task goes to a worker, or a result comes back.
- The work needs a thing that the brief refuses, or the verification fails.
- Another feature claims a path that you need.

**When not to use:** you are a worker or a request agent. Do your brief or your request.

## Workflow

Copy this checklist into your reply and mark each item as you go:

```
Feature progress:
- [ ] 1. Neighbours: the open briefs are read; ListAgents is run
- [ ] 2. Brief: each part is written from the answers of the person
- [ ] 3. Gate: the person accepted the brief
- [ ] 4. Requirements (a new need), delta spec SPEC-<slug>.md (not SPEC.md), plan tasks/<slug>.md
         (not tasks/plan.md); a small fix can have the brief as its only spec
- [ ] 5. Build: each task has a worker brief; one writer for each set of paths
- [ ] 6. Check each result: the verify command, then a new reviewer
- [ ] 7. Verification of the brief: each line is done
- [ ] 8. Ship; /api/version shows it live
- [ ] 9. Gate: the person confirms (a fix needs only the live proof)
- [ ] 10. The brief is closed
```

## The questions that fill the brief

Look in the code, the specs, `docs/epics.md` and the open briefs first. Ask only what is the
person's to decide. Each question carries 2 or 3 options, your pick, and its reason. Stop when no
part of the brief has an unknown.

| Part         | Clarify                                                    | Probe the assumption                                       | Probe the evidence                                        | Alternatives                                         | Consequences                                              |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| Outcome      | What can the person do at the end that they cannot do now? | Which epic and requirement needs this? What if none does?  | What case showed the need?                                | Is there a smaller outcome that gives the same value? | What stays not possible when this is done?                |
| Success      | What will a person see when it works?                      | Can this criterion fail? Who can see it with no tool?      | Which example passes, and which one fails?                | Is one criterion sufficient?                         | If each criterion passes, can the outcome still be absent? |
| Not in       | What is near this feature, but not part of it?             | Why is it out: no real case, or a later feature?           | Which case brings it back?                                | Can a part of it be "by hand" for now?               | What does a person not get, and is that acceptable?       |
| Must not     | What must stay as it is: data, a contract, a path, speed?  | Is this a rule of `AGENTS.md` already?                     | What broke before when an agent did it?                   | Is it a "should not" with a reason?                  | What do we do if the outcome needs it?                    |
| Should not   | What is the usual way that you want me to stay away from?  | When is an exception correct?                              | Which example shows a good exception?                     | Is it a "must not"?                                  | Who reads the report of an exception?                     |
| Verification | Which check proves each fit criterion?                     | Can the check pass while the feature is broken?            | What output shows a pass? Does the check go red first?    | Is there a cheaper check that proves the same?       | What is not verified, and who accepts that risk?          |
| Confirmation | Who accepts, and where do they look?                       | Does the person need to do an action, or only to look?     | What will the person compare it with?                     | Is the live proof sufficient (a fix)?                | What do we do if the person does not accept?              |

## The worker brief

A worker has a new context. It cannot ask the person, and it does not see your talk with the
person. Give it prompt A of [prompts.md](prompts.md), complete: the objective, the claimed paths,
what is refused, the rules, the verify command, and what to give back.

- Give one task to one worker. A task changes about 5 files at most (`planning-and-task-breakdown`).
- Only one worker at a time writes a set of paths. Workers that only read (research, review) can
  run at the same time. Do not use a worktree.
- Give a reviewer (prompt B) the files and the fit criteria, not your conclusions.

## Check a result

1. Read the diff, not only the summary. A change outside the claimed paths fails the task.
2. Run the verify command yourself. The output of the worker is a claim, not a proof.
3. Start a new reviewer subagent that did not build the work (prompt B). It gives `proven`, `partly` or `not`
   for each fit criterion, with its evidence.
4. For a fault, give a new worker brief with the finding. Do not make the fix yourself.
5. Before the ship, read the open briefs again. Then ship only the claimed paths. Only you ship,
   and only a diff that you reviewed.

## Stop rules

| Case                                                        | Action                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The outcome needs a "must not" or a "not in"                | Stop. Bring 2 or 3 options and your pick to the person. Do not lift it yourself.                      |
| The work needs a "should not"                               | Decide. Write the reason in the decisions log. Report it to the person.                               |
| The verification failed 5 times                             | Stop. Report what is open, the cause that you see, and your recommendation.                           |
| A definition is wrong or not complete                       | Stop. Only the person changes a definition.                                                           |
| The decision is about a design                              | Draw 2 or 3 variations as draft frames near the screen, named "Variation A: <what>". Mark your pick.  |
| A new need shows that no requirement has                    | Write it with `writing-requirements`. It is a "not in" until the person agrees.                       |
| An action cannot be undone, or goes outside the repo        | Stop. It is a gate.                                                                                   |

Delete the variations that the person does not pick.

## Neighbours

- This workflow is for easel only. Your neighbours are the agents that work in this repo
  (`~/dev/easel`). `ListAgents` also lists sessions of other projects: ignore them, and do not
  coordinate with them. When a name does not tell the repo, read the field `cwd` of the paseo
  record `~/.paseo/agents/<workspace>/<id>.json`.
- Read each open brief in `docs/features/` at the start and before each ship. Write what you change
  for each one in "Neighbours and impact".
- Use `SendMessage` only to agree on a path that two briefs claim. The brief is the record; a
  message is not.
- Run the tests of a neighbour when your change touches what its paths use (a shared style, a
  contract, a kit piece).
- A request agent that needs your path tells you. Do the change as a task of your feature, or agree
  on the hunks.

## Common rationalizations

| Rationalization                                         | Reality                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| "I will fix this one line myself."                      | Then the lead is the maker, and no one checks it. Give it to a worker.                       |
| "The worker says that the tests pass."                  | That is a claim. Run the verify command yourself.                                            |
| "The brief is clear to me; the person need not accept." | The brief is the agreement. With no accept, the outcome is your guess.                       |
| "This must-not blocks the outcome, so it cannot apply." | Only the person lifts it. Stop, and bring options.                                           |
| "It is near the feature, so I add it now."              | It is a "not in". Write it there, with the case that brings it back.                         |
| "The other lead will not mind a small change there."    | The path is in its brief. Agree first.                                                       |
| "Two workers on the same files is faster."              | They break the work of each other in one checkout. One writer for each set of paths.         |
| "The reviewer of the last pass knows the code."         | It also trusts the old fixes. Use a new one.                                                 |
| "It is shipped, so it is done."                         | It is done when it is live and, for a feature, when the person confirmed it.                 |

## Red flags

- A build that starts with a brief in status `draft`.
- A fit criterion that cannot fail, or that only a log can show.
- A feature lead with a diff in `src/`, `tests/`, `cmds/` or `scripts/`.
- A worker brief with no verify command, or with no claimed paths.
- A reviewer that got your conclusions in its prompt.
- A ship with a path that the brief does not claim.
- More than 5 failed passes with no report to the person.
- A closed brief that still lists claimed paths.

## Verification

- [ ] The brief has each part of the form, and the person accepted it.
- [ ] Each task had a worker brief, and you ran its verify command yourself.
- [ ] A new reviewer gave `proven` for each fit criterion.
- [ ] Each line of "Verification" in the brief is done, and its output is in the reply.
- [ ] `/api/version` shows the ship live.
- [ ] The person confirmed the feature, or the fix has its live proof.
- [ ] The brief is closed, with its decisions log.
