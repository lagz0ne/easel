# Method: requirements and design

This file tells how easel gets from a business need to a design that is proven. It is the rule for
each round, each epic and each design review. The skill `writing-requirements`
(`.claude/skills/writing-requirements/`) applies it step by step. Where they do not agree, this
file is correct.

Write in ASD-STE100, with the terms of [glossary.md](glossary.md). The actors are in
[actors.md](actors.md). The epics and their requirements are in [epics.md](epics.md).

## Contents

- Goal: a minimum viable business
- Rounds
- Features
- The parts of an offer
- Requirements
- The forms
- Steps
- Design review: a proof loop
- Sources

## Goal: a minimum viable business

The requirements of a round must be complete enough to start building, so that the work goes fast.
"Complete" is for the business, not only for the product. A round is a minimum viable business
(MVB): the smallest set of requirements that lets the company behind easel offer easel and operate
it.

A round is not a minimum viable product (MVP). An MVP is an experiment: it gets the most learning
for the least effort (Ries). An MVB is an offer that a customer can get, use and pay for, and that
the company can run and support.

| Source                                      | What this method takes from it                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Levitt; Moore, "Crossing the Chasm"         | The whole product: all the products and services that a customer needs to get the reason to buy. The core is not enough. |
| Shalloway, Minimum Business Increment       | An increment holds all the parts that are necessary to get the value and to keep it.                                     |
| Aulet, "Disciplined Entrepreneurship", MVBP | The customer gets value, the buyer pays, and a feedback loop starts.                                                     |
| Denne and Cleland-Huang, MMF                | The smallest unit that has value when it ships alone.                                                                    |
| Patton, "User Story Mapping"                | A release slice goes across the full backbone. "Viable" means that it can live on its own.                               |

## Rounds

A round is a set of requirements that must ship together. If one of them is missing, the company
cannot offer the round, so there is no value in building the others.

- Round 1, "Show the design", has no base. It makes the first MVB.
- Each round after it is a layer on the base. It adds an offer, or it makes an offer good for more
  customers. It is an MVB too: when it ships, the company can offer it and operate it.
- A requirement that the offer of the round does not need goes to a later round. Write it under
  "Decided" in its epic, as "Deferred:", with the case that brings it back.
- Gaps and edges are permitted. A gap in the goal of the round is not permitted. When the round
  can start, stop adding to it.
- Each round has one outcome: what the customer can do at its end. Match each requirement, each
  decision and each deferred item against it. A need that the outcome does not need is deferred;
  a need that it needs cannot be deferred (the user, 2026-11-23).

## Features

A feature is the unit that one agent builds: one journey, one spec delta or one fix. Rounds and
epics stay the map of the requirements. A feature is a piece of work on that map.

- Each feature has one feature lead and one feature brief (`docs/features/<slug>.md`). The form is
  in [features/README.md](features/README.md). The flow is in `AGENTS.md`.
- The brief names the epic and the requirement IDs that its outcome serves. Its fit criteria come
  from those requirements.
- The brief also says what is not in the feature, what no agent does, how the work is verified, and
  how the person confirms it.
- A need that the feature finds, and that no requirement has, goes back to step 4. It is not in the
  feature until the person agrees.

## The parts of an offer

For each round, examine each part below. Mark it as "in the round", "by hand" or "deferred", with
the reason. Do not defer a part that the offer of the round needs.

| Part  | The need                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------- |
| Value | A customer gets the outcome of the offer from the start to the end.                               |
| Get   | A new customer learns what the offer is, gets in, and gets the first value.                       |
| Pay   | The buyer can pay. Or the round says why the offer is free.                                       |
| Help  | A customer can get help. The company can see what the customer sees.                              |
| Run   | The company keeps the offer running: health, errors, backups and updates.                         |
| Trust | The customer can trust the company with its data and its access. The terms and privacy are known. |
| Learn | The company sees how customers use the offer, and hears what they need.                           |

A person of the company can do a part by hand while the number of customers is small (Graham, "Do
Things That Don't Scale"). Write that step as a requirement on the company, with a fit criterion,
as for each other actor.

## Requirements

An epic holds requirements. A module spec (`SPEC-*.md`) holds the design that meets them. Keep the
two apart.

- **Need, not solution.** A requirement says what an actor needs, and why. It does not say how
  easel does it: no field, call, state, rule or screen (ISO/IEC/IEEE 29148: necessary and free of
  implementation). Keep the design names for step 6.
- **Fit criterion.** Each requirement has a check that a person can see, with no mechanism in it
  (Volere). "Within 1 second, with no reload" is a fit criterion. "The socket sends an event" is
  not.
- **Words of the actor.** Write examples as the actor says them, not as UI steps or internals
  (Cucumber, declarative style).
- **Smallest scope.** Inside a round, take the smallest form that meets the need. Defer a need that
  has no real case. Do not offer large menus of options.
- **One term, one meaning.** Use the glossary terms only. A new term goes into the glossary, or
  into the one spec that uses it.

## The forms

### Round

```markdown
## Round N: <name>

- **Outcome:** <what the customer can do at the end of the round, in one sentence>.
- **Offer:** <what the company offers, in one sentence>.
- **Customer:** <who gets it, and who pays>.
- **Base:** <the rounds that it builds on, or "none">.

| Part  | Mark                        | Epics or reason |
| ----- | --------------------------- | --------------- |
| Value | in the round                | E1, E2          |
| Pay   | by hand: <who does what>    |                 |
| Learn | deferred: <the case that brings it back> |    |
```

### Epic

One row in the story map of [epics.md](epics.md): ID, epic, outcome (one sentence), actors,
journeys, status, review. Then one section for the epic, with a table of its journeys.

### Journey

```markdown
### E<n>.<m> <journey name>

- **Actor:** <one actor>.
- **Need:** <what the actor needs, and why>.
- **Trigger:** <what starts it>.
- **Success end:** <what is true when it ends well>.
- **Failure end:** <what is true when it fails, and what the actor keeps>.

| ID  | Requirement             | Fit criterion                   |
| --- | ----------------------- | ------------------------------- |
| X1  | <need, in actor words>  | <a check that a person can see> |

Open questions:

- <a question that stops the journey from being ready>

Decided:

- <a decision, with its reason>.
- Deferred: <the need>. Add it when <the case that brings it back>.
```

An ID is a letter and a number. It never changes and is never used again. A requirement that refers
to another uses its ID, for example "(N2)".

### Design gap

```markdown
#### Design changes that E<n>.<m> needs

| Req. | Gap in the design now | Spec |
| ---- | --------------------- | ---- |
```

When a spec closes a row, write the commit next to the table.

### Walk

```markdown
### E<n> walk of the slice

On <date>, E<n> was read from left to right as <actor>: <the steps>. The walk changed <IDs>,
and added <IDs>.
```

## Steps

| Step               | Source                               | Action                                                                                          |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1. Scope the round | Moore, whole product; Shalloway, MBI | Name the offer of the round and its customer. Mark each part of the offer.                      |
| 2. Write           | Patton, story mapping                | Give each epic one outcome sentence and its actors. List its journeys.                          |
| 3. Check form      | Cockburn, use cases; INVEST          | Each journey has one actor, one need, a trigger, a success end and its failure ends.            |
| 4. Map needs       | Wynne, Example Mapping               | For each journey, list the requirements, their fit criteria, and the open questions.            |
| 5. Walk the slice  | Patton                               | Read the round from left to right as the customer, then as the company. Find the missing step.  |
| 6. Check design    | ISO/IEC/IEEE 29148, traceability     | Compare the module spec and the design with the requirements. List each gap as a design change. |
| 7. Prove           | SPEC.md, Success Criteria 1 and 8    | Each fit criterion becomes a test. Each rule with state becomes a statechart rule.              |

- A journey is ready when it has no open question.
- A round is ready to build when each of its journeys is ready and the walk finds no missing part.
- A journey with many requirements is too large: split it.

## Design review: a proof loop

A design must meet each requirement that it claims, and it must agree with the design system. Both
must be proven by a check that anyone can run again. A claim such as "this state covers N9" is not
a proof.

The loop: requirement → design → proof → review → change the requirement or the design → again.

| Check  | What it proves                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Trace  | Each requirement ID shows on a state of the design, or the proof says where else it is proven. Each ID on the design is a real ID. |
| System | Each frame uses only the components and the tokens of the canvas. Nothing is redrawn.                                              |
| Detail | Spacing, line height, motion, shadow, grid and copy follow the rules of the design system.                                         |

- The design is on the Doop canvas [easel · Product design](https://doop.vibea.dev/c/xFJSTXA-v5),
  one page for each epic (`Work · E<n> <epic title>`). Its parts and tokens are on the library
  canvas [easel · Design system](https://doop.vibea.dev/c/zPdfXgdRrQ). The rules are in the style
  guide `easel-system` and in the frame "Foundations". How to use the canvases:
  [design-canvas.md](design-canvas.md).
- The check is `bun run design:proof` (`scripts/design-proof.ts`). The design is done only when it
  prints `design proof: OK`. Each finding is one line: `<frame> <rule id> <what is there>`.
- When a new epic gets a design, add its frames and its IDs to the proof in the same ship.
- Copy the patterns of leaders in the same field (Figma, Linear, Vercel, Liveblocks). Keep the
  design quiet.
- Detail rules come from Emil Kowalski (emil-design-eng), the Vercel Web Interface Guidelines and
  Refactoring UI.

## Sources

- Levitt, T. "Marketing success through differentiation — of anything". Harvard Business Review, 1980. Moore, G. "Crossing the Chasm", 1991.
- Shalloway, A. Minimum Business Increment. PMI Disciplined Agile.
- Aulet, B. "Disciplined Entrepreneurship", 2013, step 22.
- Denne, M. and Cleland-Huang, J. "Software by Numbers", 2003.
- Patton, J. "User Story Mapping", 2014.
- Ries, E. "The Lean Startup", 2011.
- Graham, P. "Do Things That Don't Scale", 2013.
- Cockburn, A. "Writing Effective Use Cases", 2000. Wake, B. INVEST, 2003.
- Wynne, M. Example Mapping, 2015.
- ISO/IEC/IEEE 29148, requirements engineering. Robertson, S. and J. Volere.
- ASD-STE100, Issue 9.
