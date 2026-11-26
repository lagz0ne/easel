# North star: as designed, not only as it looks

Status: accepted by the person on 2026-11-26, after two rounds of questions. It is the north star of
epic [E13](epics.md#e13-hand-over-as-designed). The words come from [glossary.md](glossary.md). New terms are in "Words of this file".

## The problem

A design tool such as Figma or Doop shows a snapshot of a screen. Its prototype joins the snapshots
with links that a person draws. It does not tell how the screen works: its props, its states, the
moves between them, and the rules over time.

So an agent that gets "implement this" often makes a mock. The screen looks right, but no real
operation runs, and some states do not exist. The person said: the work must be "as designed, not
just as it looks".

## The north star

**A person accepts a screen model. Then easel proves that the design frames and the live app both
do what the model says, with no person in the loop. Drift stays at 0.**

Tinker makes this possible. A Tinker unit is free of side effects when it obeys the lint rules, so
easel can read it, run it with example answers, and run it live. The same facts are true in each
of the three runs.

## The number: drift

Drift is the count of facts that do not agree between the screen model and the live app. easel
counts in both directions:

| Direction        | Example                                                                             |
| ---------------- | ----------------------------------------------------------------------------------- |
| model to the app | The model has the state "Question for a viewer". No run of the live app reaches it. |
| app to the model | The code gives the answer `wrongState`, and the model has no state or move for it.  |

1. easel measures drift on the live app after each deploy, in the job of E11.
2. easel counts each direction apart, and shows each fact that does not agree.
3. The target is 0 for each screen that has a model.

## Words of this file

| Term         | Definition                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| screen model | A typed TS definition of one screen: its props, states, moves, rules, look and words. It is the one source of truth. |
| handover     | The step where an implementer gets a screen model that the person accepted, and writes the product code for it.      |
| conform      | To agree with the screen model in each of the six facts below.                                                       |
| drift        | The count of facts that do not agree between a screen model and the live app.                                        |
| trace        | The record of one run of the live app: each state and each move, in order.                                           |

## The six facts of a screen

The screen is the unit of a handover. A piece is a screen with no route. A journey is a list of
screens. Each of the six facts stops a handover when it does not conform.

| Fact   | What the model says                                            | What the check reads                                        | It fails when                                                   |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| props  | The input of the screen, and the answers of each call.         | The Tinker contract and the generated types.                | The code has a prop or an answer that the model does not have.  |
| states | Each state, and the data that it holds.                        | The kinds of the cell of the screen.                        | A state has no kind, or a kind has no state.                    |
| moves  | Each move: from a state, an action and its answer, to a state. | The map: a run with each answer forced (SPEC-prototype J6). | The map of the code is not equal to the moves of the model.     |
| rules  | The rules over time: two users, a lease, a retry.              | TLC on the TLA+ that easel makes from the model.            | TLC finds a state that breaks a rule, or a trace breaks a rule. |
| look   | The look values that each state uses.                          | The classes of the code (oxc) and the look of the kit.      | The code uses a raw color, size or space, not a look value.     |
| words  | The text keys of each state, in each locale.                   | The text keys of the code (SPEC-words).                     | The code has a literal text, or a text key has no translation.  |

A picture of each state, beside the design frame, gives a report only. A picture diff fails on small
changes of fonts and anti-aliasing, so it never stops a handover.

## How a handover goes

1. An agent writes the screen model with the person, by questions.
2. easel makes the TLA+ from the model. TLC checks each rule. easel draws the chart.
3. The person reads the chart and the rules in plain words, and accepts them. The person never reads TLA+.
4. An agent makes one design frame for each state. The frame uses the generated types and the example
   answers of the model. easel refuses a frame for a state that the model does not have.
5. The person comments on the look and the words of each state, and accepts them.
6. The implementer writes new Tinker code with the generated types. A `switch` on a `kind` has a case
   for each state, so the compiler refuses a missing state.
7. The gate checks the six facts. The map of the code must be equal to the model.
8. After the deploy, the E11 job makes the map and the traces of the live app, and counts the drift.

The code of the design frames does not become the product code. The design and the product both
conform to the model, so they agree with each other.

## Three runs, one set of facts

| Run         | What runs                                                | What it proves                                       |
| ----------- | -------------------------------------------------------- | ---------------------------------------------------- |
| static      | Nothing. oxc and `tinker.graph` read the code.           | Props, states, look and words.                       |
| semi-static | The code, with each answer forced, on example answers.   | Each move. A screen with only fixtures shows here.   |
| runtime     | The live app. easel records traces, and TLC checks them. | No mock: each move happens with the real operations. |

## Worked example: the request card

The first screen model is the request of a viewer on a canvas. It has all six facts, and rules over
time: a claim, a lease, and a count of tries. Its chart now is
[request-life](statecharts/request-life.md), with [queue-lease](statecharts/queue-lease.md).

This sketch shows the size of a model. The API of the model is a design for later.

```ts
export const requestCard = screen("request.card", {
  props: { request: RequestId },
  states: {
    waiting: { tries: Tries },
    inWork: { tries: Tries, holder: AgentName },
    question: { text: TextKey },
    resultToCheck: { result: Result },
    needsPerson: { why: oneOf("declined", "noOutcome") },
    accepted: {},
    closed: {},
  },
  moves: [
    move("waiting", by("agent"), "request.next", "claimed", "inWork"),
    move("inWork", by("agent"), "request.ask", "asked", "question"),
    move("inWork", by("agent"), "request.resolve", "resolved", "resultToCheck"),
    move("inWork", by("time"), "lease.end", "ended", "waiting"),
    move("resultToCheck", by("viewer"), "request.accept", "accepted", "accepted"),
  ],
  rules: {
    onlyAnOpenRequestIsInWork: always(...),
    aQuestionWaitsForAViewer: always(...),
    noOutcomeTwiceNeedsAPerson: leadsTo(...),
  },
  look: { needsPerson: ["--warning"], accepted: ["--success"] },
  words: { needsPerson: ["request.needsPerson.declined", "request.needsPerson.noOutcome"] },
});
```

Drift on this screen, for example:

- The code of `request.next` gives `wrongState`, and the model has no move for it: drift 1, app to the model.
- A live trace goes from "Question for a viewer" to "Needs a person": the rule `aQuestionWaitsForAViewer`
  breaks, so drift 1, model to the app.

## Order

1. easel proves the north star on its own screens. The request card is first, then the sign-in and the
   share link.
2. Then teams that build Tinker apps with agents.

## Not in, and must not

- **Not in:** a handover to a stack that is not Tinker. A promotion of the design code into the product.
- **Must not:** a link that a person draws. A mock written by hand as a proof. A picture diff that stops a
  handover. A model that only a person who reads TLA+ can review.

## Prior art

| Tool                                                  | What we take                                                      | What we leave                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Figma, Doop, ProtoPie                                 | The look of a snapshot, and comments on it.                       | Links drawn by hand, and no states or rules.                     |
| Storybook                                             | One state of a component, with the real code.                     | A story by hand for each state: it drifts from the code.         |
| XState, `@xstate/graph`                               | A typed model of states and moves, and a search of its paths.     | A model beside the app that no check holds to the app.           |
| P language (Microsoft)                                | A model and its code from one source, checked by a model checker. | A language of its own beside the Tinker types.                   |
| Quint (Informal Systems)                              | A typed way to write TLA+.                                        | A second language. Our model is TS, so the types are one source. |
| TLA+ trace validation (Cirstea, Kuppe and Merz, 2024) | TLC checks the record of a real run against the model.            | Nothing: it is the runtime check of drift.                       |
| Design tokens (DTCG), i18next-parser                  | Look values and text keys that a tool reads from the code.        | Nothing: the kit and SPEC-words use them now.                    |

## How it changes the present specs

- SPEC-prototype derives the map with no model. Under this north star, its map is the code side of
  the check, and the model is the other side.
- The charts in `docs/statecharts/` are TLA+ by hand. A screen model makes them, so a chart and its
  types cannot disagree.
- E10, E11 and E12 become parts of one epic: "Hand over as designed".

## Decided with the person

1. "Hand over as designed" is epic E13, with E10, E11 and E12 as its parts. So one outcome holds them.
2. The first ship is the screen model language, the TLA+ that it makes, and the chart of the request
   card, equal to the chart of today. The present chart is the oracle that proves the language.
