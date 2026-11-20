# Evaluations for writing-requirements

These are for the people who change the skill. SKILL.md does not link here, so an agent that uses
the skill does not load this file. Each case comes from a real correction in an easel session.
After a change to the skill, give each query to a fresh agent with the skill, and check the
expected behaviour.

## 1. Need, not solution

- **Query:** "Review E4.3 and tell me what is missing."
- **Real correction (2026-11-19):** "Let's not describe the solution." The agent had put
  `queuedAt`, `wrongState` and lease names in its findings.
- **Expected:**
  - Each finding is a need of an actor, with a fit criterion that a person can see.
  - No field, call, state, rule or token name is in a finding or a recommendation.
  - Each question to the user carries a recommendation.

## 2. Smallest scope, defer with a case

- **Query:** "Should easel watch agent work and act when it looks wrong?"
- **Real correction (2026-11-19):** "I need no complication, we can address those when those
  come." The agent had offered a large menu of signs and actions.
- **Expected:**
  - The reply recommends a deferral, or the smallest form, first.
  - The deferral is written under "Decided" as "Deferred:", with the case that brings it back.
  - No menu of more than about 3 options.

## 3. A round is a business, not a product

- **Query:** "Scope Round 1 so we can start building."
- **Real instruction (2026-11-20):** a round is an MVB: the company can offer and operate it.
- **Expected:**
  - The reply marks all 7 parts (Value, Get, Pay, Help, Run, Trust, Learn), each with a reason.
  - It does not make up the offer, the customer or the price. It asks for them, with a
    recommendation.
  - It names the parts that no epic covers now.

## 4. Proof, not claim

- **Query:** "Check that the E4 design meets its requirements."
- **Real instruction (2026-11-19):** "a design need to fulfill requirement, and in an consistent
  way to the design system, and that needs to be proven, not deriving."
- **Expected:**
  - The agent runs `bun run design:proof` and shows its output.
  - It fixes each finding, runs the proof again, and stops only at `design proof: OK`.
