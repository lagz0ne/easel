# Intent: governed design spec

Status: confirmed by the person on 2026-11-28, after an interview (skill `interview-me`). It extends
the [north star](../northstar.md) and epic [E13](../epics.md#e13-hand-over-as-designed). The words
come from [glossary.md](../glossary.md).

## The problem

Doop and Figma make a new frame easily, but nothing governs it. A design spec of a big screen often
does not say which states can occur together and which cannot. Some states are parallel, and some
states are derived from others. The statecharts are not exhaustive, and implicit states are missing.
At the implementation, each implementer reads these gaps in a different way, so the gaps get worse.

## The intent

| Part         | What the person wants                                                                                                                                                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outcome      | Governance comes first. A screen model (TS) generates TLA+. TLC searches each reachable state, and its `VIEW` gives the visible states. A case (code and fixture input) must reach each visible state. A demo is a run on a case, so nothing needs a cleanup after it.  |
| Phases       | Discovery, then a gate, then delivery. Automation and AI do about 80% of the gate. A person does about 20%: taste, and the changes that have a blast radius.                                                                                                            |
| First tools  | We do not know yet how a person reviews. So easel first gives three review tools: show the states, show the flows (the moves, with the cases that reach them), and research similar approaches in other products. The use of these tools tells us the rules of the 20%. |
| User         | The person at the gate, who reviews. The agents that do discovery and delivery use the same model and cases.                                                                                                                                                            |
| Why now      | Nothing governs the frames of Doop and Figma. Specs miss implicit states, and each implementer reads the gaps in a different way.                                                                                                                                       |
| Success      | Each visible state that TLC finds has a case: no gap. Static analysis lists the full impact of a change. The semi-static map and the runtime traces cross-check it for drift. Reviewers use their time on taste and blast radius, not on repeated details.              |
| Constraint   | Tinker only. TLA+ and TLC give the coverage: no guess and no sample (no pairwise set). The view code can be product code. Cases and fixtures are design code, typed by the same contract, and are not product code.                                                     |
| Out of scope | Fixed rules for what goes to a person (they come later, from the data of the reviews). Coverage by a sample. Links that a person draws. Frames that no model governs. Stacks that are not Tinker.                                                                       |

## What the person said

1. "The code is not the production code. At least, not all of them."
2. A review is "code and input": a different set of fixtures, "put that to limit so we know how thing my work".
3. "We should not guess, we should stress test with cases so we can cover those up."
4. "Go tla and tlc."
5. The gate is a "combination of automated gate and human review", with "20% human, 80% done by combination of automation and ai".
6. "We are not sure how user will do review", so easel offers tools to demonstrate states and flows, and to research similar approaches.

## Prior art named in the interview

| Tool                                       | What it gives here                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| TLC `VIEW`, `-dump dot`                    | Merges states that look the same; gives the graph of the states.              |
| Modelator, `quint run` (Informal Systems)  | Tests made from TLA+ traces: the source of a case.                            |
| Harel statecharts, XState parallel states  | Parallel regions and derived states.                                          |
| Tinker exits check                         | Each answer kind of each call is reached: the source of many implicit states. |
| Chromatic UI Review, CODEOWNERS, Tricorder | A review of only what changed, by path, with the repeated part automated.     |
