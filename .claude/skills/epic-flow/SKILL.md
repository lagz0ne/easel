---
name: epic-flow
description: Runs the design review loop of an epic until each requirement is proven. A new reviewer subagent with fresh context checks the Doop design against each requirement ID in each review pass, a worker of the feature lead fixes, and the loop ends when all are proven or after 5 review passes. Use when an agreed epic gets its design on Doop, when a design must be proven against its requirements, or when the design finds a need that no requirement has. Write the requirements first with writing-requirements.
---

# Epic flow: the design review loop

## Overview

The method is in [docs/method.md](../../../docs/method.md) ("Design review: a proof loop"). Where this skill and
the method do not agree, the method is correct. The skill `writing-requirements` writes the requirements and
runs `bun run design:proof`. This skill adds the loop around them: who checks, how often, where the result is
kept, and when the loop stops.

A "review pass" is one turn of the loop. It is not a round of requirements (`docs/glossary.md`).

There are two checks, and a design needs both:

| Check | What it proves | Who runs it |
|---|---|---|
| `bun run design:proof` | Each ID shows on a state; the frames follow the design system | the script, in each review pass, first |
| The review | A person can really do what each requirement says, by a click path in the prototype | a new reviewer subagent, in each review pass |

The script cannot see if a state really meets its requirement. The reviewer cannot see each token. So run both.

## When to use

- An epic is agreed and its design starts on Doop.
- A design must be proven against its requirements before the user gives a verdict.
- The design finds a need that no requirement has.

**When not to use:** to write or scope requirements. Use `writing-requirements` (steps 1 to 5) for that.

## The loop

The loop has 5 parts. If one part is missing, it is only one review, not a loop.

1. **A list of targets.** The requirement IDs, each with a fit criterion that can fail (from `docs/epics.md`).
2. **A maker.** A worker of the feature lead draws or fixes the frames. The feature lead does not
   (`feature-lead`, the worker brief).
3. **A new checker in each review pass.** A subagent with fresh context, read only. For each ID it gives `proven`,
   `partly` or `not`, the click path, and a fix. It does not see the earlier review passes or your opinion.
4. **A file that keeps the state.** Each review pass writes `~/work/tmp/<epic>-review/review-r<N>.json`. The next
   review pass starts from this file, also after the chat loses its context.
5. **An end.** All IDs are proven and `design:proof` prints OK. Or 5 review passes are done: then stop and tell the
   user what is open.

The loop runs in 3 places:

| Loop | Who checks | It starts again when |
|---|---|---|
| Inner: design and review | `design:proof`, then a fresh reviewer | an ID is `partly` or `not`, or the proof has a finding |
| Middle: design and the user | the user | the user picks a base option, or says what is wrong |
| Outer: design and requirements | the user | the design finds a need with no requirement: write it with `writing-requirements`, the user agrees, then run the inner loop on it |

Prior art: the "evaluator-optimizer" pattern in Anthropic's "Building effective agents". One model makes, a
second one checks against fixed criteria, and the work repeats until the check passes.

## Workflow

Copy this checklist into your reply and mark each item as you go:

```
Epic flow progress:
- [ ] 1. The epic is agreed; its IDs and fit criteria are fixed
- [ ] 2. Prior art: leaders in the field and UI kits, named
- [ ] 3. 2 or 3 quiet options on Doop; each state names the IDs it claims
- [ ] 4. Inner loop: design:proof OK, then a fresh reviewer; fix; repeat (5 review passes at most)
- [ ] 5. The user picks a base; the other options are deleted
- [ ] 6. New needs go back to writing-requirements (outer loop)
- [ ] 7. All proven: show the proof output and the last verdicts to the user
```

**Step 2. Prior art first.** Start two research subagents at the same time: one on the leaders in the field,
one on UI kits and pattern libraries ([prompts.md](prompts.md), B). Name the sources in the design notes. Keep
the design quiet (`docs/method.md`).

**Step 3. Look before the review.** The maker takes a screenshot of each frame that it changed, and fixes the
faults that it sees. Add the epic's frames and IDs to `scripts/design-proof.ts` in the same ship.

**Step 4. One review pass:**

1. Run `bun run design:proof`. Fix each finding first.
2. Start a NEW subagent with prompt A from [prompts.md](prompts.md). Give it the files and the frames, not your
   conclusions.
3. Read its JSON. Give the fixes to the maker: the `blocks` items first, then the `partly` and `not` IDs.
4. Ship the change with `scripts/ship.sh`.
5. Go to 1. Stop after review pass 5 and report what is open, with your recommendation for each item.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "design:proof prints OK, so the design is done." | The script sees IDs and tokens. Only the review sees if a person can do it. |
| "The maker can review its own frames." | It sees what it meant to draw. A fresh reviewer sees what is there. |
| "Use the same reviewer again; it knows the frames." | It also trusts the old fixes. Use a new one in each review pass. |
| "One more review pass will fix it." | After 5 review passes the problem is in the requirement or the base option. Ask the user. |
| "This new need is small; add it to the design only." | A need with no requirement cannot be proven. Write it first (outer loop). |

## Red flags

- A review pass with no output file.
- A feature lead that draws or fixes a frame itself.
- A reviewer that got your conclusions in its prompt.
- A requirement called proven with no click path.
- A loop with more than 5 review passes and no report to the user.
- Old option frames left on the canvas after the user picked a base.

## Verification

- [ ] `bun run design:proof` prints `design proof: OK`, and the output is in the reply.
- [ ] The last review pass gives `proven` for each ID, with its click path.
- [ ] The JSON of each review pass is kept, and the reply gives the counts: proven, partly, not.
- [ ] Each new need from the design is in `docs/epics.md`, agreed by the user.
