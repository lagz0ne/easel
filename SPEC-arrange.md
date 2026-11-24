# Spec delta: `arrange`, the agents arrange the frames by relation, and a person drops an image

Status: implemented (be6f0f7, live on easel.vibea.dev since 2026-11-24, build 307). Approved (the
requirements of 2026-11-24: E2.3 G1 to G6, E2.4 I3; the user granted the decisions).

## Objective

On 2026-11-24 the user said: "I don't do any work, agents does only. So, arrangement is the work
for agent, but still need. Also, learn how excalidraw does the "relative" placement, so, not
everything needed to be actual. Image surely needed".

Today an agent gives each frame an exact place (`--at x,y`), or the frame goes to the right of the
frames of its page at y 0. An agent that puts 10 frames of a flow must compute 10 places. When a
frame gets wider, the frames at its right stay where they are, and the two frames are on each
other. Nothing tells the agent.

After this delta, an agent says how a frame relates to the other frames: after a frame, below a
frame, or in a named section. easel computes each place. When a frame grows or goes, easel
computes the places again, so the order stays and no frame is on another. Each change answers the
list of the frames that touch. A person who is signed in drops or pastes an image on the canvas,
and it becomes an image frame at that place (I3).

A **section** is a named set of frames on one page that easel places together, with its name
above them. The epics say "group" (G3). The glossary has "error group", so this spec says
"section", as Figma does.

## Prior art

- **Excalidraw, the element skeleton** (`convertToExcalidrawElements`). A program gives the type
  and a few fields. easel takes the same idea: an agent gives the relation, and the server gives
  the rest. A container gets its size from its label. An arrow binds to the ids of its ends, not to
  points. A frame takes `children` ids, and its box is the box of its children with a padding.
- **Excalidraw+ MCP tools.** The agent gives the intent (`frameId`, bindings, `notesPerRow`,
  `columns`), and the server measures and places. `create_slide` and `create_sticky_notes` compute
  each position. `check_scene_layout` lists overlaps and "elements outside their frame", each with
  the elements that it names and a fix. Each write tool runs that check on its changes and answers
  the problems as `layoutIssues`, and it still saves. A diagram or slide tool that sees a changed
  scene answers a conflict: "Read the current scene and retry".
- **tldraw.** `stackShapes(shapes, "horizontal" | "vertical", gap)` puts shapes in a line with a
  gap; `distributeShapes` and `alignShapes` make even spaces and edges. easel stacks in the same
  two directions: a row of columns, and a column of frames.
- **Figma auto layout.** A frame with a direction, a gap and a wrap places its children. A child
  with "absolute position" stays at its place, and the others ignore it. Figma sections have a
  name above their content. easel takes the direction, the gap and the wrap, and the name above.
  An exact place in easel is not a child: the sections go around it (G4).
- **ELK layered layout, and mermaid-to-excalidraw.** A graph of nodes and edges gets layers from
  left to right. mermaid-to-excalidraw takes the places that mermaid's layout computed (dagre, or
  ELK when it is set). easel has no edges between frames today, so it needs no graph layout. A flow
  is an order, and an order is a row.
- **Figma and Excalidraw, a dropped image.** The image goes where the person drops it. A paste of
  an image goes at the pointer (Excalidraw) or at the middle of the view (Figma).

## Current behavior

- `frame.put` takes `page`, `x` and `y` for a new frame. With no place, the frame goes 80 px to
  the right of the frames of its page, at y 0 (SPEC-pages rule 5).
- `frame.move` takes `x`, `y` and `page` (SPEC-pages rule 6). No call changes the size of a
  frame. A new image version changes it.
- No call says that two frames touch.
- `frame.put` with `id` and `base` refuses a write on an old version (`stale`, B6). Nothing
  refuses a change of place made from an old read.
- The viewer shows frames. It has no title for a set of frames.
- A person pastes an image into the textbox of a request (I2). A drop or a paste on the canvas
  does nothing.

## New behavior

### The relations

1. A new frame takes one place, or none:
   - `x` and `y`: an exact place (G4). It works as today.
   - `after: <id>`: the frame goes in a new column right after the column of that frame, in its
     section.
   - `below: <id>`: the frame goes under that frame, in its column.
   - `section: <name>`: the frame goes in a new column at the end of that section. A section
     that the page does not have is made, after the other sections of the page.
   - No place: as today, 80 px to the right of the frames of its page, at y 0. It is an exact
     place.
2. `after` and `below` name a frame that is in a section. A frame with an exact place answers
   `placed`, with its id. The page is the page of that frame: `page` with `after` or `below` is
   `invalid`. Two kinds of place in one call are `invalid`.
3. `frame.move` takes the same places, and also `size` (`{ w, h }`). A move with a relation takes
   the frame out of its section or its exact place, and puts it at the new relation. A move with
   `x` and `y` takes the frame out of its section. `size` changes the box, and makes no version.
4. A section has a name (1 to 80 characters) and a key, the slug of the name. Two names with the
   same slug are the same section. A section is on one page. Its name stays as it was first given.
5. A section that has no frame is removed.

### What easel computes

6. In a section, the columns go from left to right, in their order. The frames of a column go from
   top to bottom, in their order. The gap is 80 px between two columns and between two frames of a
   column. A column is as wide as its widest frame.
7. `wrap: n` (1 to 100) puts at most n columns on a line; the next column starts a new line under
   the tallest column of the line before. With no wrap, all the columns are on one line (a row).
8. A section box is its frames and a head of 120 px above them, where the viewer shows the name.
9. The sections of a page go from top to bottom, in their order, at x 0, from y 0. 160 px
   separate two sections.
10. An exact frame is fixed. A section that is placed with `at` is fixed too. A section in the
    flow never comes closer than 80 px to a fixed box. When it would, easel moves it down, below
    that box, and it starts again from that place (G4).
11. After each change of a page (a new frame, a move, a new size, a delete, a section change),
    easel computes each place of the sections of that page again, in the same write. So a frame
    that gets wider moves the columns after it, and a frame that goes leaves no hole (G2). A
    change on one page does not move a frame of another page.

### Sections

12. `section.set` changes a section of a page:
    - `at: { x, y }` gives the section an exact place. Its frames move with it (G3). `at: null`
      puts it back in the flow.
    - `after: <name>` puts it after that section in the order. `after: null` puts it first.
    - `wrap: n` or `wrap: null`, and `gap` (16 to 800).
13. The viewer shows the name of each section above its frames (G3), in grey, at the size of a
    frame name, and above the frame names. It is text only: no box, no fill, and nothing behind
    the frames (the canvas rule of the user: a grey title for each group, above its screens).
    The name keeps its size on the screen at each zoom, as a frame name does.

### The check (G5)

14. Two frames **touch** when their boxes are closer than 16 px on both axes, or are on each
    other.
15. A frame is a **stray** of a section when it is not in the section, and its box is on the box of
    the section (its head too). A person reads it as a part of the section.
16. A frame of a section is never out of its section: easel places it. A test proves it.
17. Each answer of a change (`frame.put`, `frame.move`, `frame.delete`, `section.set`) has
    `layout`: the page, the revision, the pairs that touch, the strays, the first 20 of all, and
    `more` for the count of the others. `page.layout` answers the same for a page, with no change.
18. A relation never makes a touch or a stray: easel places the frame clear of the others. Only an
    exact place (of a frame or of a section) can make one. As in Excalidraw, the write saves and
    the answer names the frames, so the agent moves one of them in its next call.

### The revision (G6)

19. Each canvas has a revision, a number. Each change of a place, a size, a page, a section or a
    frame of the canvas adds 1 to it. A change of the document of a frame does not, but a new
    image of another size does.
20. `frame.list` and `page.layout` answer the revision. Each change answers the new one.
21. `frame.put` (a new frame), `frame.move` and `section.set` take `rev`. When it is not the
    revision of the canvas now, nothing is written: the answer is `changed`, with the revision
    now. The agent reads again, and makes its change on what it read. With no `rev`, the change
    is made on the canvas as it is.
22. A relation needs no `rev` to keep its meaning: "after b" stays after b when another agent adds
    a frame. Give `rev` with an exact place that you computed from a read.

### The CLI and MCP

23. `easel put <canvas> <file> [--page <page>] [--at x,y | --after <id> | --below <id> |
--section <name>] [--rev <n>]`. Two place flags are bad usage (64). `--page` with `--after` or
    `--below` is bad usage.
24. `easel move <canvas> <id> [--at x,y | --after <id> | --below <id> | --section <name>]
[--page <page>] [--size WxH] [--rev <n>]`. A move needs a place or `--size`.
25. `easel section <canvas> <name> [--page <page>] [--at x,y | --flow] [--after <section> |
--first] [--wrap n | --no-wrap] [--gap n] [--rev <n>]`.
26. `easel layout <canvas> [--page <page>]` prints the sections and the findings. It exits 0 when
    there is no finding, and 1 when there is one.
27. Each change prints each finding on stderr: `touch <id> <id>`, `stray <id> <section>`.
28. MCP: `put_frame` and `move_frame` take `after`, `below`, `section`, `size` and `rev`. New tools:
    `set_section` (`section.set`) and `check_layout` (`page.layout`).

### Drop or paste an image on the canvas (I3)

29. On `/c/<canvas>`, a signed-in user drops an image file on the canvas. The image becomes an
    image frame on the page of the tab. Its top left corner is at the place of the drop. The
    frame has the size of the image (SPEC-frames § Image frames). The name of the frame is the
    name of the file, with no extension.
30. A paste of an image on the canvas does the same. The image goes at the place of the pointer
    when the pointer is on the canvas, else in the middle of the view. A paste into a text field
    (the textbox of a request, I2) goes to that field, not to the canvas.
31. While a file is over the canvas, the canvas shows a line on its edge and "Drop the image to put
    it on this page". One image goes at a time. A drop while an image goes says "Wait for the
    image that goes now".
32. A file that is not a PNG, JPEG or WebP, or that is over 10 MiB, does not go. The page says "Only
    a PNG, JPEG or WebP image of 10 MB at most goes on the canvas". A refusal of the server
    (`badImage`, `tooBig`) says why in the same place. A lost socket says "The image did not go.
    Drop it again".
33. A place left of or above the origin goes to 0. The frame is an exact place (G4): the sections
    of the page go around it.
34. A share link (`/s/<link>`) does not take a drop or a paste on the canvas: a viewer does not
    change frames (SPEC-frames fact rule 7).

## Contract

```ts
type Finding = { touch: [string, string] } | { stray: string; section: string }
type Layout = { page: string; rev: number; findings: Finding[]; more: number }
type SectionInfo = {
  key: string; name: string; x: number; y: number; w: number; h: number
  at: boolean; wrap: number | null; gap: number; columns: string[][]  // frame ids
}

"frame.put":   written & { layout: Layout } | { kind: "placed"; id: string }
             | { kind: "changed"; rev: number } | ... (the kinds of SPEC-frames)
"frame.move":  { kind: "moved" | "unchanged"; layout: Layout } | { kind: "placed"; id: string }
             | { kind: "changed"; rev: number } | { kind: "gone" }
"frame.delete":{ kind: "deleted"; layout: Layout } | { kind: "gone" }
"frame.list":  { kind: "found"; rev: number; frames: (ListedFrame & { section: string | null })[] }
             | { kind: "gone" }
"section.set": { kind: "set" | "unchanged"; layout: Layout } | { kind: "changed"; rev: number }
             | { kind: "gone" }
"page.layout": { kind: "found"; layout: Layout; sections: SectionInfo[] } | { kind: "gone" }
```

- Inputs: `frame.put` (new) and `frame.move` take `after?`, `below?` (frame ids), `section?` (a
  name), `rev?`; `frame.move` also takes `size?`, and its `x` and `y` are optional, together.
  `section.set` takes `{ canvas, page?, section, at?, after?, wrap?, gap?, rev? }`. `page.layout`
  takes `{ canvas, page? }`. With no page, the first page.
- `gone`: no canvas, no page, no frame of that id, no section of that name on the page (for
  `section.set` and its `after`).
- Success kinds: `section.set`: `set`, `unchanged`; `page.layout`: `found`. `placed` and `changed`
  exit 1.
- The board gets the cell `sections`, keyed by canvas, page and key, with the name and the box.

## Models

The arrangement and the drop have state, so models and charts come first.

- [frames-arrange](docs/statecharts/frames-arrange.md): a section of two frames, after and below,
  a grow, a remove, and an exact frame that comes and goes. Its rules: no two frames touch; the
  columns are in order with one gap between them, so no hole; the frames of a column are in
  order; a section is clear of the exact frame.
- [frames-arrange-rev](docs/statecharts/frames-arrange-rev.md): two agents make exact changes
  from what each read; a change on an old revision is refused. No two frames touch.
  [frames-arrange-no-rev](docs/statecharts/frames-arrange-no-rev.md) breaks on purpose: with no
  revision, a place computed from an old read touches a frame that grew.
- [viewer-image-drop](docs/statecharts/viewer-image-drop.md): the drop and the paste of a member,
  the hint, one image at a time, a refusal, a lost socket, a paste in a text field, and a viewer.
  Its rules: a viewer never writes a frame; each frame is at a place where the person dropped or
  pasted; a paste in a text field never makes a frame; a refusal makes no frame.
  [viewer-image-drop-any-paste](docs/statecharts/viewer-image-drop-any-paste.md) breaks on
  purpose: a canvas that takes each paste takes the screenshot of a request too.

## Fact rules

1. Each frame is in one section or has an exact place, never both.
2. Each section has at least one frame.
3. Each write that changes a place calls the one `arrangePage` in its transaction.
4. The order of the columns and of the frames of a column changes only by a call of an agent, never
   by a computed place.

## Speed

35. The arrangement of a page of 200 frames takes less than 5 ms on the server. A change sends a
    cell only for each frame whose box changed. Q1 to Q3 of the speed gate hold.
36. A dropped image of 10 MiB is a frame on the canvas in 5 seconds at most (I3).

## Success criteria

1. **G1.** An agent puts 10 frames of a flow with `--section` and `--after` only. The person sees
   them in the order of the flow, with no frame on another.
2. **G2.** A move with `--size` makes a frame of the row 300 px wider: the frames after it move 300
   px right, and `layout` lists no touch. A delete leaves no hole.
3. **G3.** The viewer shows the name of the section above its frames. `easel section --at` moves
   each frame of the section.
4. **G4.** A frame with `--at` stays there, and the section goes around it.
5. **G5.** Each change answers its findings. `easel layout` lists the touches and the strays.
6. **G6.** A change with an old `--rev` is refused `changed`, and writes nothing.
7. **I3.** A dropped PNG is a frame at the place of the drop, on the page of the tab, in 5 s.
8. The models hold their rules, and the twins break. `tinker check` is OK.

## Boundaries

- Always: an exact place stays where the agent put it. `--at` works as before.
- Always: easel never changes the order that an agent gave.
- Ask first: an automatic layout of a graph (ELK) from links between frames.
- Never: a frame behind other frames, as the box of a section.

## Out of scope (deferred)

- **A person moves a frame or a section by hand.** The agents arrange the frames (E2, decided).
- **Links between frames, and a layout of a graph** (ELK layered). Add them with the flows of
  screens (SPEC-pieces, deferred), when a flow has branches.
- **Rename of a section.** Add it when an agent asks for it; a move to a new name does it now.
- **Many images in one drop.** Add it when a person drops many: the first image goes now.
- **A drop or paste on a share link.** A viewer asks for a change in a request (I2).
- **Find a section** (S15 finds frames).
