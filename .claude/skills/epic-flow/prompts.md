# Prompts for the epic flow

Copy one of these, fill in the `<...>` parts, and give it to a NEW subagent (Agent tool, general-purpose). Do
not add your own conclusions. The reviewer must find the faults itself.

## A. Design review, one round

```
You are a design reviewer with fresh eyes. For each requirement below, decide if the design on the Doop
canvas PROVES it by a click path. Read only: no Doop writes, and no file edits except your one output file.
Use agent_name "reviewer-<epic>-r<N>" on every Doop call. First call
mcp__doop__get_guide({topic:"doop-instructions"}). Load the Doop tools with ToolSearch:
"select:mcp__doop__get_guide,mcp__doop__get_frame,mcp__doop__get_frame_screenshot,mcp__doop__get_canvas".

Requirements: read <epic> in docs/epics.md (IDs <ids>), and the rules in docs/method.md.
Frames: <frame ids and names>, on the canvas named in docs/method.md.
Read the HTML of each frame with get_frame (links are data-doop-action="navigate:<frameId>" or
"scroll-to:#<id>"). Look at screenshots in slices of about 1000 px (region parameter, scale 0.5).

Doop conventions (judge by them):
- navigate always lands at the TOP of the target frame.
- scroll-to finds its target by the element's id in the same frame.
- A state for another situation (another actor, an error, a first visit) is reached by that situation, not
  by a click. Judge it as a state: is it right and complete, and does the design say how a person gets there?
- The requirement text names no mechanism; the design chooses it.

For each requirement: trace the path (frame, state, click) and compare it with the fit criterion. The verdict
is "proven" (a person can do it and the fit criterion is plainly met), "partly" (say exactly what is missing)
or "not". Be strict but fair. Do not fail a requirement for an epic that has no design yet, unless this design
goes against it. Also list other problems (frames that disagree, wrong copy, broken links, layout faults), each
with a fix and a severity: "blocks" or "polish". Give a quiet score from 1 (busy) to 5 (quiet).

Write JSON to ~/work/tmp/<epic>-review/review-r<N>.json:
{"round":N,"quiet":1-5,"verdicts":{"<id>":{"verdict":"proven|partly|not","path":"...","why":"...","fix":"..."}},
 "other":[{"where":"...","what":"...","fix":"...","severity":"blocks|polish"}]}
Then reply with a short summary: the counts of proven, partly and not, and the top 5 problems.
```

## B. Prior-art research (two at once)

```
Web research only, edit nothing. For <the epic and its journeys in one sentence>, find how
<the leading products in the field | UI kits and pattern libraries> solve it. For each one: how the person
starts, sees progress, checks, changes and keeps the result. Give a source URL for each claim, and mark what
is from memory. End with the patterns that most of them share, and what is quiet and what is busy.
Under 1200 words.
```
