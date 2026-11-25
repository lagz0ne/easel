---
name: writing-requirements
description: Writes and reviews easel requirements and their designs with the project method in docs/method.md. It scopes a round as a minimum viable business (MVB), writes epics and journeys as needs with fit criteria, walks the slice, and finds design gaps. The skill epic-flow proves the design. Use when the user talks about requirements, epics, journeys, rounds, MVB, scope, what to defer, or "is this complete", when editing docs/epics.md or docs/method.md, or when a design must be compared with its requirements to list the gaps.
---

# Writing requirements

## Overview

The method is in [docs/method.md](../../../docs/method.md). Read it before step 1. It holds the goal
(a round is an MVB), the parts of an offer, the rules, the forms (copy them), the steps, and the
design proof. This skill tells how to apply steps 1 to 6 in a session. The skill `epic-flow` does
step 7. In a mission, the lead (`mission-lead`) starts this skill for a new need.

## When to use

- A new round, epic or journey.
- A review of an epic: complete, ready, what to defer.
- A design that must be compared with its requirements, to list the gaps.

**When not to use:** design names and mechanisms inside a module spec (`SPEC-*.md`). Use
`spec-driven-development` for those. Come back here for step 6.

## Workflow

Copy this checklist into your reply and mark each item as you go:

```
Requirements progress:
- [ ] 1. Scope the round: offer, customer, base; mark the 7 parts
- [ ] 2. Write: each epic has one outcome sentence and its actors
- [ ] 3. Check form: each journey has actor, need, trigger, success end, failure ends
- [ ] 4. Map needs: requirements, fit criteria, open questions
- [ ] 5. Walk the slice: as the customer, then as the company
- [ ] 6. Check design: spec and canvas against each ID; list the gaps
- [ ] 7. Prove: go to `epic-flow`; fit criteria become tests
```

**Step 1. Scope the round.** Only the user can name the offer, the customer and who pays. Do not
make them up. Ask, and give your recommendation and its reason. Mark each part of the offer as "in
the round", "by hand" or "deferred". A part that the offer needs cannot be deferred.

**Steps 3 and 4. Review each requirement before you show it:**

1. Does it name a mechanism (a field, call, state, rule, screen or token)? Rewrite it as the
   actor's need.
2. Can a person see its fit criterion, with no tool and no internals? If not, rewrite it.
3. Does the round need it? If not, move it to "Decided" as "Deferred:", with the case that brings
   it back.
4. Repeat until each row passes.

**Step 5. Walk.** Read the round as one customer, from the first contact to the value, the payment
and the help. Then read it as the company that runs it. Each missing step is a new requirement or a
"by hand" step. Record the walk with the form in the method.

**Step 6. Check design.** Compare the module spec and the design with each requirement ID. Write
each gap with the form "Design gap" of the method. Do not explain a gap away.

**Step 7. Prove.** Use the skill `epic-flow`. It runs `bun run design:proof` and the review
passes until each requirement is proven.

## How to talk to the user

- Write in ASD-STE100: short sentences, active voice, one meaning for each word.
- In a talk about requirements, give needs and fit criteria only. Keep mechanisms for step 6.
- Each question carries your recommendation and its reason. Look in the docs and the code first.
  Ask only what is the user's to decide.
- Give the smallest scope first. Do not offer a large menu of options.
- Land the work with `scripts/ship.sh`. A docs-only ship runs `check:style` only.

## Common rationalizations

| Rationalization                                    | Reality                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| "A field name makes the requirement precise."      | It fixes the design too early. Make the fit criterion precise instead.                     |
| "The product works, so the round is complete."     | An MVB also needs Get, Pay, Help, Run, Trust and Learn, or a reason for each mark.         |
| "Add this edge case now, to be safe."              | Gaps and edges are permitted. Defer them with the case that brings them back.              |
| "This state clearly covers N9."                    | Only the proof output shows that it does.                                                 |
| "I can guess the price and the customer."          | Those are business decisions. Ask, with a recommendation.                                 |

## Red flags

- A requirement with a code name, a screen step or a token in it.
- A fit criterion that only a test or a log can see.
- A round with a part that has no mark.
- A journey with more than about 12 requirements: split it.
- A "Deferred:" line with no case that brings it back.
- A design that is called proven with no run of `epic-flow`.

## Verification

- [ ] Each part of the offer has a mark and a reason.
- [ ] Each journey has the five lines and no open question, or it is not called ready.
- [ ] Each requirement has an ID, a need and a fit criterion, with no mechanism.
- [ ] The walk is recorded, with the IDs that it changed or added.
- [ ] Each design gap is in its table, or the design has no gap.
- [ ] The proof of the design went to `epic-flow`.
