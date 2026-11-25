# Feature briefs

A feature brief is the agreement between the person and one feature lead. It says what the feature
must achieve, what stays out, what no agent does, and how the work is verified and confirmed. The
flow is in [AGENTS.md](../../AGENTS.md), "A feature: from start to done". The skill `feature-lead`
(`.claude/skills/feature-lead/`) has the questions that fill each part.

## Rules

- One feature has one brief: `docs/features/<slug>.md`. A feature is one journey, one spec delta or
  one fix.
- Each feature lead writes only its own brief. Read the briefs of the other features; do not edit
  them.
- The feature lead writes the brief from the answers of the person. The person accepts it one time.
- After that, only the person changes a definition: the outcome, success, not in, must not, should
  not, verification or confirmation.
- A brief is open while its status is not `closed`. A closed brief claims no path.

## The form

Copy this form. Keep each part, in this order.

```markdown
# Feature: <name>

- **Feature lead:** <the name of the agent>.
- **Status:** draft.
- **Accepted:** <the date, and the words of the person>.

## Outcome

<What a person or an agent can do at the end, in one sentence.> (E<n>.<m>: <requirement IDs>)

## Success

| ID  | Fit criterion                   |
| --- | ------------------------------- |
| X1  | <a check that a person can see> |

## Not in

- <a thing that the feature does not do>. Add it when <the case that brings it back>.

## Must not

- <a thing that no agent of the feature does>.

## Should not

- <a thing to stay away from>.

## Verification

- [ ] <a check: the command, and the output that shows a pass>
- [ ] A new reviewer subagent that did not build the work gives `proven` for each fit criterion.
- [ ] The live proof: `/api/version` shows the ship, and <what shows on the live easel>.

## Confirmation

<Who accepts, and where they look.>

## Claimed paths

- `<path or glob>`

## Neighbours and impact

| Feature | Lead | What this feature changes for it | Agreed |
| ------- | ---- | -------------------------------- | ------ |

## Decisions log

- <date>: <the decision, and its reason>.
```

## The parts

| Part                  | What it holds                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome               | One sentence, with the epic and the requirement IDs of [epics.md](../epics.md). A fix names the fault, and the requirement that the fault breaks.                               |
| Success               | The fit criteria. A person can see each one, and each one can fail. No mechanism is in them ([method.md](../method.md), "Requirements").                                        |
| Not in                | The non-goals: each is a thing that the feature could do, but does not. Each has the case that brings it back.                                                                  |
| Must not              | The "MUST NOT" of RFC 2119: there is no exception. Only the person lifts it. The rules of `AGENTS.md` are must-nots of each feature; do not copy them.                          |
| Should not            | The "SHOULD NOT" of RFC 2119. The feature lead can do the thing, with a written reason in the decisions log and a report to the person.                                         |
| Verification          | How the feature lead proves that the work meets "Success" and breaks no "must not". It has the checks, a new reviewer subagent that did not build the work, and the live proof. |
| Confirmation          | How the person agrees that the outcome is there. The person confirms a feature on the live easel. A fix needs only the live proof.                                              |
| Claimed paths         | The paths that only this feature changes. The workers of the feature lead share them. Keep the list small and exact.                                                            |
| Neighbours and impact | The other open features, and what this feature changes for each one. Read the open briefs at the start and before each ship.                                                    |
| Decisions log         | Each decision that the feature lead made with no gate, each "should not" that it did, and each change of a definition by the person.                                            |

## Verification of a feature with state

A feature with state has a TLA+ model and its chart before the code (`scripts/statecharts.sh`). Its
"Verification" has these lines:

1. `scripts/statecharts.sh --check` is clean.
2. A conformance review by a new reviewer subagent. Each action of the model has the code that does
   it. Each rule has the test that fails when the rule breaks. Each path of the chart that ends in
   an answer has the test that goes along it.
3. Each gap is closed in the code, or the model and the spec change first.
4. The report to the person at "Confirmation" shows the charts and the table of the review.

## Status

| Status      | It is true when                                                           |
| ----------- | ------------------------------------------------------------------------- |
| `draft`     | The feature lead writes the brief. Questions are open.                    |
| `accepted`  | The person accepted the brief. The spec and the plan can start.           |
| `building`  | Workers do the tasks of the plan.                                         |
| `verified`  | Each line of "Verification" but the live proof is done.                   |
| `live`      | `/api/version` shows the last ship of the feature, and the proof is done. |
| `confirmed` | The person confirmed the feature. A fix does not use this status.         |
| `closed`    | The work is complete, or the person stopped it. It claims no path.        |
