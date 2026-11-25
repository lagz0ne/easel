# Mission: cases

Lead: f11449a (`m: cases`; d13e221 handed over on 2026-11-25). Accepted: 2026-11-25, "Accept the top of tasks/cases.md." SPEC-cases
was approved on 2026-11-25 ("Approve SPEC-cases with both picks"). Done: open.

## Mission

A person sees each named case of one screen (a fixture and switch values) as its own frame,
next to the screen, and each new version of the screen shows in all of them. (E10.3: X12, X17;
SPEC-cases ship 1.)

## Success

- On the page `regroup-the-controller`, the users list has 4 cases (`empty`, `few`,
  `long-names`, `many`). The section `users list · cases` shows 4 case frames, each with its
  name and its own data.
- One `put_frame` of the users list changes all 4 case frames. No step for each case is done.
- `easel cases ls` and `list_cases` give the same list. A bad case (an unknown fixture, a
  name two times, more than 36) is refused with a line that says the fix.
- A pick of `dark` on the board changes each case frame. A pick on one case frame changes only
  that frame.

## Nono

- Not in: the spread view and the stack view, the section `Cases`, and the count of requests
  (ship 2, X13, X14). Back when ship 1 is live and the person starts ship 2.
- Not in: the answers of calls in a case (ship 3, X15), and "Keep as a case" (ship 4, X16).
- Not in: a rename of a case that keeps its frame. A new name is a new case frame.
- Must not: change the matrix (X11), the board value or the frame value (X6, X7), the request
  record, or a frame that is not in a case group.
- Must not: put a case as code in the files of a frame (SPEC-cases decision 1).

## Verify

- `offload -- bun --bun vp test tests/cases.test.ts tests/cli-cases.test.ts tests/mcp-table.test.ts`
  passes, and `bun run check:plain` prints `tinker check: OK`.
- The browser test of T3 passes, and `bun run smoke` passes.
- A look with `agent-browser` at the page `regroup-the-controller`: 4 case frames with their
  data; after one put of the source, each case frame shows the new version.
- A new reviewer subagent that did not build the work gives `proven` for each success check.
- Live: `/api/version` shows the ship. Confirms: the person, on the page `regroup-the-controller`.

## Touching

| File                                                                            | Change                                                                                                                                                          | Owner now            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/frames/cases.ts`                                                           | New: the shape of a case, the limit of 36, the refusal kinds.                                                                                                   | this work            |
| `src/frames/contract.ts`                                                        | `cases.list`, `cases.set`; `CaseFrame` in the answer of a put; the field `case` on a frame of the board.                                                        | this work            |
| `src/frames/store.server.ts`                                                    | The table `frames_cases`; the columns `source` and `case_name`; the build of a new version goes to the case frames; a drop of the source drops its case frames. | this work            |
| `src/frames/cases.server.ts`                                                    | New: `setCases` and `listCases`, in one transaction with `arrangeAfter`.                                                                                        | this work            |
| `src/frames/ops.server.ts`                                                      | A put on a case frame refuses `CaseFrame`; the docs of the case frames go stale with their source.                                                              | this work            |
| `src/cli/cases.ts`, `src/cli/index.ts`, `cmds/easel.ts`                         | `easel cases ls` and `easel cases set`.                                                                                                                         | this work            |
| `src/mcp/server.ts`                                                             | The calls `cases.list` and `cases.set`.                                                                                                                         | this work            |
| `src/mcp/tools.ts`, `src/mcp/texts.ts`                                          | The tools `list_cases`, `set_cases`, and a text for each new kind. Lines added only.                                                                            | dirty: another agent |
| a new file in `src/viewer/`, `src/viewer/canvas.tsx`                            | The values of the case over the board value, under the frame value of the tab.                                                                                  | `canvas.tsx` dirty   |
| `tests/cases.test.ts`, `tests/cli-cases.test.ts`                                | New.                                                                                                                                                            | this work            |
| `src/cli/frames.ts`, `src/viewer/drop.ts`, `tests/browser/viewer-drop.test.tsx` | The text of `CaseFrame` for a put and a drop.                                                                                                                   | this work            |
| `tests/mcp-table.test.ts`, `tests/mcp.test.ts`, `tests/mcp-http.test.ts`        | The count of tools is 49.                                                                                                                                       | this work            |
| `tinker.graph`                                                                  | The lines of the cases operations only.                                                                                                                         | shared: dark look B  |

## Plan

Each task lands green with `scripts/ship.sh`. A dirty file of another agent goes in with `-p`
(only the hunks of this work), after a message to its owner.

- [x] **T1 · The cases and the case frames on the server.** MCP `list_cases` and `set_cases`
      and the texts of the 3 refusals came with it (the MCP table test needs a tool for each call).
  - Acceptance: `cases.set` with 4 cases (`empty`, `few`, `long-names`, `many`) on a source frame
    makes 4 case frames in the section `<name> · cases`, at the place of the source frame, in
    order. A second write adds one, removes one, and keeps the others with their ids. The name
    is the key of a case: a new name is a new case frame. A new
    version of the source frame gives each case frame its build and version. A drop of the source
    frame drops its case frames. A put on a case frame refuses `CaseFrame`. `CaseInvalid`,
    `CasesTooMany` and `changed` each have a test.
  - Verify: `bun test tests/cases.test.ts`, then `bun run check:plain` (each exit reached).
- [x] **T2 · The tools.** `easel cases ls|set` (MCP and the kind texts shipped with T1).
  - Acceptance: the CLI prints the list and each refusal as one line with its fix; MCP gives the
    same kinds. `tests/mcp-kinds.test.ts` passes.
  - Verify: `bun test tests/cli-cases.test.ts tests/mcp-kinds.test.ts`.
  - After the ship: tell the lead of tinker-packages. It waits for T2 before it starts 7d in
    `src/frames/`. It does not touch `src/cli/index.ts` or `cmds/easel.ts`.
- [ ] **T3 · The draw of a case frame.** A frame of the board has `case`; the viewer puts the
      values of the case over the board value, under the frame value of the tab.
  - Acceptance: a browser test: a case frame `many` shows the fixture `many`; one pick of `dark`
    on the board changes it; a pick on the case frame changes only that frame.
  - Verify: the browser test, then `bun run smoke`, then a look with `agent-browser`.
- [ ] **Proof on the live easel.** The users list of the page `regroup-the-controller` as a real
      source frame with 4 cases. Its case frames show in the section `users list · cases`.

## Risks

- `canvas.tsx`, `mcp/tools.ts` and `mcp/texts.ts` change under another agent. Mitigation: lines
  added only, a message to the owner first, and `ship.sh -p`.
- The first document of a frame draws before its offer, then again with the values (as for each
  frame value today). A case frame flashes its own data first. Accept it in ship 1; note it for
  ship 2.
- A section key can collide with a section of a person. Mitigation: decision 3 adds the id.
