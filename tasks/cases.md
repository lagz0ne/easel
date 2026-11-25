# Plan: SPEC-cases, ship 1 (X12, X17)

Source: [SPEC-cases.md](../SPEC-cases.md), approved by the user on 2026-11-25. Ship 1 is
decisions 1 to 5, 11 and 12: cases with a fixture and switches, the case frames in their case
group, the tools, and the draw of a case frame with its values. No new UI: the views and the
section `Cases` are ship 2.

## Files

| File                                                    | Change                                                                                                                                                          | Owner now            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/frames/cases.ts`                                   | New: the shape of a case, the limit of 36, the refusal kinds.                                                                                                   | this work            |
| `src/frames/contract.ts`                                | `cases.list`, `cases.set`; `CaseFrame` in the answer of a put; the field `case` on a frame of the board.                                                        | this work            |
| `src/frames/store.server.ts`                            | The table `frames_cases`; the columns `source` and `case_name`; the build of a new version goes to the case frames; a drop of the source drops its case frames. | this work            |
| `src/frames/cases.server.ts`                            | New: `setCases` and `listCases`, in one transaction with `arrangeAfter`.                                                                                        | this work            |
| `src/frames/ops.server.ts`                              | A put on a case frame refuses `CaseFrame`; the docs of the case frames go stale with their source.                                                              | this work            |
| `src/cli/cases.ts`, `src/cli/index.ts`, `cmds/easel.ts` | `easel cases ls` and `easel cases set`.                                                                                                                         | this work            |
| `src/mcp/server.ts`                                     | The calls `cases.list` and `cases.set`.                                                                                                                         | this work            |
| `src/mcp/tools.ts`, `src/mcp/texts.ts`                  | The tools `list_cases`, `set_cases`, and a text for each new kind. Lines added only.                                                                            | dirty: another agent |
| a new file in `src/viewer/`, `src/viewer/canvas.tsx`    | The values of the case over the board value, under the frame value of the tab.                                                                                  | `canvas.tsx` dirty   |
| `tests/cases.test.ts`, `tests/cli-cases.test.ts`        | New.                                                                                                                                                            | this work            |

## Tasks, in order

Each task lands green with `scripts/ship.sh`. A dirty file of another agent goes in with `-p`
(only the hunks of this work), after a message to its owner.

- [ ] **T1 · The cases and the case frames on the server.**
  - Acceptance: `cases.set` with 4 cases (`empty`, `few`, `longNames`, `many`) on a source frame
    makes 4 case frames in the section `<name> · cases`, at the place of the source frame, in
    order. A second write renames one, removes one, and keeps the others with their ids. A new
    version of the source frame gives each case frame its build and version. A drop of the source
    frame drops its case frames. A put on a case frame refuses `CaseFrame`. `CaseInvalid`,
    `CasesTooMany` and `changed` each have a test.
  - Verify: `bun test tests/cases.test.ts`, then `bun run check:plain` (each exit reached).
- [ ] **T2 · The tools.** `easel cases ls|set`, MCP `list_cases` and `set_cases`, and a text for
      each kind.
  - Acceptance: the CLI prints the list and each refusal as one line with its fix; MCP gives the
    same kinds. `tests/mcp-kinds.test.ts` passes.
  - Verify: `bun test tests/cli-cases.test.ts tests/mcp-kinds.test.ts`.
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
