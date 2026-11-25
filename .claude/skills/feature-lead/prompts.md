# Prompts for the feature lead

Copy one of these, fill in the `<...>` parts, and give it to a NEW subagent (Agent tool). Do not add your own
conclusions. The brief is `docs/features/<slug>.md`. The plan is `tasks/<slug>.md`.

## A. Worker brief

```
You are a worker on the feature <slug> of easel, in a checkout that other agents share.
Read first: AGENTS.md, then the brief docs/features/<slug>.md, then <SPEC-<slug>.md, section> and <files>.
Objective: <the one task, copied from tasks/<slug>.md, and the fit criteria that it serves>.
Claimed paths: <paths>. Do not edit, format, revert or stash a file outside them.
Not in: <what the task does not do>.
Must not: <the must-nots of the brief that this task can meet>.
Rules: AGENTS.md binds you. Write in ASD-STE100. No comments in code. No cast (no `as` but `as const`,
no `!`, no `any`). Write the failing test first.
Runs: use `offload -- <command>` for a heavy run. Make temporary files with `work new <slug>`.
Do not run scripts/ship.sh, git add, git commit or git push. Do not format a folder.
If the task needs a path outside yours, or the spec does not answer a question, stop and say so.
Verify: <the exact command, and the output that shows a pass>.
Give back: a summary of the diff (each file, what changed, why), the output of the verify command, and each
thing that you did not confirm.
```

## B. Reviewer

Use a new reviewer in each pass. It did not build the work.

```
You are a reviewer with fresh eyes. Read only: edit no file but your one output file.
Read the brief docs/features/<slug>.md and the diff <base sha>..<sha> (or the dirty files <paths>).
For each fit criterion under "Success", run its check from "Verification". For a check on the live site
(<url>; /api/version must show <sha> or a later commit), look with agent-browser (AGENTS.md, "Browser smoke")
or the easel tools.
The verdict for each criterion is "proven" (with the command or the click path, and what you saw), "partly"
(say exactly what is missing) or "not".
Also compare each line of "Not in", "Must not" and "Should not" with the diff.
Write JSON to <dir>/review-<N>.json:
{"pass":N,"criteria":{"<id>":{"verdict":"proven|partly|not","evidence":"...","fix":"..."}},
 "refused":[{"line":"...","broken":true|false,"where":"..."}],"other":[{"what":"...","fix":"..."}]}
Then reply with the counts of proven, partly and not, and the top problems.
```
