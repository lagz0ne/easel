# Spec delta: `flows`, the screens of a journey and the links between them

Status: approved by the requirements of 2026-11-24 (E12, J1 to J9; the user: "Now onto the custom
controller, copies, i18n, screen and flows"). The user granted autonomy for this round, so the
agent decided the open points below.

It adds to [SPEC-frames](SPEC-frames.md), [SPEC-arrange](SPEC-arrange.md) and
[SPEC-viewer](SPEC-viewer.md). It is the design of E12 in [docs/epics.md](docs/epics.md#e12-screens-and-flows).

## Objective

A screen alone does not show a journey. Today a person sees the frames of a journey side by side,
and reads the order from their names. No frame leads to another frame. On Doop, our design had 803
prototype clicks on 82 frames. The frames that came to easel still hold them as
`data-doop-action="navigate:<Doop id>"`, but easel does nothing with them.

After this delta:

- an agent adds a link from an action of a screen to the next screen, with no position (J6);
- an agent names a flow and its first screen (J2);
- the person starts a flow in one press, and walks it by presses on the screens (J1, J3);
- the person asks for a change on a screen of the walk (J4), in the state of the canvas (J5);
- the person sees the links as arrows on the canvas (J7), and the flows in one list (J9);
- a change that breaks a link tells the agent, and the arrow shows it (J8).

## Words of this spec

- **Screen:** a frame that is a step of a journey. Each frame can be a screen.
- **Action:** a named part of a screen that the person presses, such as `send`. The element has
  `data-easel-action="send"`. A name is 1 to 40 of `a-z`, `0-9` and `-`.
- **Link:** in this spec, a link of a flow: an action of a screen and the screen that it leads to.
  It is not a share link. A link is **broken** when the screen that it leads to is gone or on
  another page, or when its screen does not have its action now.
- **Flow:** a named start screen on a canvas. Its screens are the screens that the links reach
  from the start, in the order of a breadth-first search (the **flow order**).
- **Walk mode:** the mode of the viewer that shows one screen of a flow at a time. The person
  walks a flow in walk mode.
- **Map:** the arrows of the links on the canvas.

## Prior art

| Tool                                         | What we take                                                                                                                         | What we leave                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Figma prototypes                             | A connection from a layer to a frame. A flow is a named starting point. The flows list. The presentation view with Back and Restart. | Overlays, transitions, smart animate and variables: deferred. A connection lives on the layer; here a link is data of the canvas.  |
| Figma hotspot hints                          | A press that is not on a hotspot flashes the hotspots of the screen.                                                                 |                                                                                                                                    |
| Doop prototype clicks (803 on 82 frames)     | The press of an element leads to a frame.                                                                                            | The target in the HTML (`navigate:<id>`): a target that goes stays in the HTML of each frame that names it, and nothing finds it.  |
| Excalidraw bound arrows                      | The two ends of an arrow bind to elements. The arrow follows them when they move, and its ends are on the outline of each element.   | Free arrows that a person draws.                                                                                                   |
| Storybook interaction tests, Testing Library | A test presses a part by a stable name. `data-testid` is a hook that does not change with the text or the layout.                    | The role and the text of the element as the name (`getByRole("button", { name: "Send" })`): the text changes with the locale (J5). |
| Playwright `data-testid`                     | One attribute, written in the source, that a tool finds with no position.                                                            |                                                                                                                                    |

## The decisions

1. **An action is a data attribute: `data-easel-action="<name>"`.** It is the same for an HTML
   frame and an app frame, because an app frame draws its elements in the same document. easel
   finds the actions of a screen in its source with no code run: the attribute with a name in
   quotes (`"send"`, `'send'`, `{"send"}`). Other ways:
   - A CSS selector. It names a position in the document (`main > button:nth-child(2)`), so it
     breaks when the screen changes (J6).
   - The role and the text of the element, as Testing Library does. The text changes with the
     locale, so a walk in Vietnamese loses each link (J5).
   - A capsule action of an app frame. An HTML frame has none, and the move from Doop is HTML. A
     link is a step of a review, not a part of the app.
2. **A link is data of the canvas, not of the screen.** easel keeps it beside the frames, as Figma
   keeps a connection beside a layer. A change of a link makes no version of a frame, so the
   requests on a screen stay as they are. easel can find each link that a change breaks (J8). The
   Doop way, a target in the HTML of each screen, cannot be found when its target goes.
3. **A flow is on one page.** A link leads to a screen on the page of its screen, as in Figma. The
   map is on that page.
4. **The walk is a mode of the viewer on the canvas, not a new page.** The viewer shows the live
   document of the screen at the size that fits, and hides the other frames. So each screen of the
   walk is drawn as the canvas draws it (J5), and a request is a request of the canvas, on that
   screen (J4).
5. **The frame names an action, never a place to go.** The script of the viewer in each live
   document posts `{ easel: "action", name }` when the person presses an element with an action.
   The viewer reads it only from the iframe of the screen that it shows, and finds the next screen
   in the links of the canvas. Nothing that the frame sends is an address. The iframe stays
   `sandbox="allow-scripts"`, so a frame cannot change the address of the viewer.
6. **The map is off until the person turns it on.** A canvas with 803 links is not quiet. The
   start of each flow is a small mark at the name of its first screen (as Figma shows a flow
   start), and it starts the walk in one press.

## Current behavior

- A frame is an HTML document or an app frame. No frame leads to another frame.
- The viewer draws up to 12 live documents in sandboxed iframes (`srcdoc`, `allow-scripts`). It
  draws each frame with the locale pick of the dock and the picks of the frame (E10).
- A live document does not take a press: the canvas takes it, for a pan or a request.
- `frame.put`, `frame.move` and `frame.delete` answer the layout of the page (SPEC-arrange).

## New behavior

### Links (J6)

1. `link.set` adds a link, or changes the screen that a link leads to: a screen `from`, its action
   `action`, and the screen `to`. A screen has one link for each action.
2. easel refuses a link:
   - `gone`: no canvas, or no frame `from` or `to`;
   - `noAction`: the screen `from` does not have the action; the answer lists its actions;
   - `otherPage`: `to` is on another page than `from`;
   - `full`: the canvas has 2000 links.
3. `link.remove` removes the link of an action. A link of a screen goes when its screen goes.
4. A link names two frames by their ids and an action by its name. It holds when a screen moves,
   gets a new size or a new version that keeps the action (J6).

### Flows (J2, J9)

5. `flow.set` gives a flow a name (1 to 80 characters) and a start screen. The key of the flow is
   the slug of its name. A second `flow.set` with that name changes its start. A canvas has at
   most 100 flows. `gone`: no canvas, or no frame `start`.
6. `flow.remove` removes a flow. Its screens and links stay.
7. `flow.list` lists the flows of a canvas: the key, the name, the start, the page of the start,
   the count of the screens in the flow, and the count of its broken links.
8. The screens of a flow are the start and each screen that a link that is not broken reaches
   from it. The flow order is a breadth-first search from the start; the links of a screen go in
   the order that they were added.

### A change that breaks a link (J8)

9. After each change of a frame, easel finds again the state of each link of that frame and of
   each link to it, in the same call:
   - `frame.put` of a new version: a link of the screen is broken (`action`) when the new version
     does not have its action, and whole again when it has it;
   - `frame.delete`: each link to the screen is broken (`screen`), and each link of the screen
     goes; a flow with that start is broken (`start`);
   - `frame.move` to another page: each link of the screen and to it whose two screens are on
     two pages is broken (`page`); it is whole again when they are on one page.
10. The answer of that change has `broken`: each link and each flow that the change broke. The
    agent that made the change gets it. The CLI prints each one on stderr. With nothing broken,
    the answer has no `broken`.
11. `flow.check` lists, with no change:
    - each broken link, and each flow whose start is gone;
    - `order`: a screen that is not after the screen that first leads to it, in the flow order.
      A screen is after another when it is below it, or at the right of it in the same row
      (E2.3, J7).
      It answers the links of the canvas and each flow with its screens in the flow order.

### The map on the canvas (J7)

12. The dock has a Flows button when the page has a flow or a link. Its menu lists the flows of
    the page, and has the switch "Show the links".
13. With the switch on, each link of the page is an arrow from its screen to the screen it leads
    to, with the name of its action. An end of the arrow is on the outline of its screen, on the
    line between the two middles, as an Excalidraw bound arrow. The arrow follows a screen that
    moves or gets a new size. Two links between the same two screens are apart.
14. A broken link is a red dashed arrow with its cause: "the screen is gone", "no action
    `send`" or "the screen is on another page". When its screen `to` is not on the page, the
    arrow is a short line from its screen.
15. The arrows keep their width and their text size on the screen at each zoom, as the frame
    names do.

### Start a flow (J2, J9)

16. The first screen of each flow has a mark beside its name: a play icon and the name of the
    flow. One press on it starts the walk.
17. The Flows menu lists each flow of the page: its name, the name of its first screen, and the
    count of its screens. One press on a flow starts the walk. A flow with a broken start shows
    "The first screen is gone", and does not start.
18. The address holds the walk: `?flow=<flow key>&steps=<id>,<id>`. The last id is the screen
    that shows. A reload opens the walk at the same screen, with the same steps back.

### Walk mode (J1, J3, J4, J5)

19. In walk mode, the viewer shows only the screen of the step, at the size that fits the view
    (at most 100%), on a dark ground. The other frames, the section names, the arrows and the
    dock do not show.
20. The bar at the top shows the name of the flow, the name of the screen, and the count of the
    steps. It has Back, Restart, Comment and Leave (J3).
    - Back shows the screen of the step before. It is off on the first step.
    - Restart shows the first screen, with no steps back.
    - Leave ends walk mode. The canvas shows the screen of the last step, with the mark of Find.
    - Escape closes the request that the person writes, then a menu, then leaves.
21. The live document of the screen takes the presses of the person. A press on an element with
    an action that has a link shows the next screen (J1). The viewer keeps the next screens of
    the step live, so the next screen shows within 1 second.
22. A press on an action with no link, or with a broken link, keeps the screen. The bar says "No
    screen comes after `send` yet", with the button "Ask for it". It opens a request at that
    place, with the text "Add the screen that `send` leads to." (J1 failure end).
23. A press that is not on an action outlines the actions of the screen that have a link, for 1
    second, as the hotspot hints of Figma do.
24. Comment turns on the request mode in the walk. A press on the screen opens a request at that
    place, on that screen and its version, as on the canvas (J4). After the send, the walk stays
    on the screen.
25. Each screen of the walk is drawn as the canvas draws it: with the locale pick of the dock, the
    picks of the frame, and the color scheme of the browser (J5). The walk has no state of its
    own. When the switches of the canvas come (X6), they change the same picks, so each screen of
    the walk shows them with no change of the walk.
26. A share link can walk a flow too: a viewer starts it from the mark or from the menu.

### The CLI and MCP

27. `easel link <canvas> <from> <action> <to>` adds or changes a link.
    `easel unlink <canvas> <from> <action>` removes it.
28. `easel flow set <canvas> <name> <start>`, `easel flow rm <canvas> <name>`,
    `easel flow ls <canvas>`, and `easel flow check <canvas> [<name>]`. `flow check` exits 0 with
    no finding, and 1 with one.
29. `easel put`, `easel move` and `easel rm` print each broken link on stderr:
    `broken <from> <action> -> <to>: <cause>`, and `broken flow <name>: the first screen is gone`.
30. MCP: `link_screen`, `unlink_screen`, `set_flow`, `remove_flow`, `list_flows`, `check_flows`.

## Contract

```ts
type Why = "screen" | "action" | "page"
type Link = { from: string; action: string; to: string; page: string; broken: Why | null }
type Break = { link: { from: string; action: string; to: string; why: Why } }
           | { flow: string; start: string; why: "start" }
type FlowInfo = { key: string; name: string; start: string; page: string | null;
                  screens: number; broken: number; startGone: boolean }
type Finding = Break | { order: [string, string]; flow: string }

"link.set":    { canvas, from, action, to }
            -> { kind: "linked" | "unchanged"; link: Link } | { kind: "gone" }
             | { kind: "noAction"; actions: string[] } | { kind: "otherPage"; page: string }
             | { kind: "full"; max: number }
"link.remove": { canvas, from, action } -> { kind: "unlinked" } | { kind: "gone" }
"flow.set":    { canvas, name, start } -> { kind: "set" | "unchanged"; flow: FlowInfo }
             | { kind: "gone" } | { kind: "full"; max: number }
"flow.remove": { canvas, flow } -> { kind: "removed" } | { kind: "gone" }
"flow.list":   { canvas } -> { kind: "found"; flows: FlowInfo[] } | { kind: "gone" }
"flow.check":  { canvas, flow? } -> { kind: "found"; findings: Finding[]; more: number;
                 links: Link[]; flows: (FlowInfo & { order: string[] })[] } | { kind: "gone" }

"frame.put" (written), "frame.move" (moved), "frame.delete" (deleted): & { broken?: Break[] }
```

- `flow` in `flow.remove` and `flow.check` is a name or a key. `gone` also when the canvas has no
  flow of that name.
- Success kinds: `link.set`: `linked`, `unchanged`; `link.remove`: `unlinked`; `flow.set`: `set`,
  `unchanged`; `flow.remove`: `removed`; `flow.list` and `flow.check`: `found`.
- The board gets two cells: `links`, keyed by canvas, page and the screen and action of the link,
  and `flows`, keyed by canvas and flow key, with the fields of `FlowInfo`.
- `findings` holds the first 20; `more` counts the others.

## Models

Walk mode and the links that break have state, so models and charts come first.

- [viewer-walk](docs/statecharts/viewer-walk.md): a flow of three screens; a press on a linked
  action, on an action with no link, and off an action; Back, Restart, Leave; a request in the
  walk, and Escape. Its rules: the walk shows only a screen that a link of the shown screen
  reaches, or one that it showed before; Back shows the screen of the step before; a request made
  in the walk is on the screen that shows; Escape with a request open never leaves the walk.
  [viewer-walk-any-post](docs/statecharts/viewer-walk-any-post.md) breaks on purpose: a viewer
  that goes where the frame says shows a screen that no link reaches.
- [flows-links](docs/statecharts/flows-links.md): two links; an agent puts a version with no
  action and with the action again, moves a screen to another page and back, and deletes a
  screen. Its rules: each link is whole or marked broken with its true cause; each change that
  breaks a link tells it in its answer. [flows-links-unchecked](docs/statecharts/flows-links-unchecked.md)
  breaks on purpose: a put that does not look at the actions leaves a link that looks whole, and
  leads from an action that is not there.

## Fact rules

1. Each link is of a frame that is there. Its action and its target are as the last `link.set`
   gave them.
2. The state of a link is true after each change: `broken` is `screen`, `page`, `action` or null,
   in that order of cause.
3. The viewer moves to a screen only by a link of the board, never by a value from a frame.
4. A change of a link or a flow makes no version of a frame and no change of the revision of the
   canvas.

## Speed

31. The next screen of a walk shows within 1 second of the press (J1), on the reference laptop.
32. A put of a frame with 50 links finds the state of its links in less than 5 ms on the server.
33. A canvas with no flow and no link loads no more data than today, and Q1 to Q3 of the speed gate
    hold. The arrows draw only with the switch on.

## Success criteria

1. **J1.** On a flow of 5 screens, a browser test presses an action on each screen and gets from
   the first screen to the last. Each next screen shows within 1 second.
2. **J2.** `easel flow set` names a flow and its start. One press on the mark at the start screen
   starts the walk.
3. **J3.** The bar shows the names of the flow and of the screen. Back shows the screen before;
   Leave ends the walk.
4. **J4.** A request made in the walk is on the screen of the step, at the place of the press, on
   its version.
5. **J5.** With Vietnamese picked in the dock, each screen of the walk draws in Vietnamese. The
   test proves the composition of the walk is the composition of the canvas.
6. **J6.** A link holds after `easel move` and after a put that keeps the action.
7. **J7.** With the switch on, each link of the page is an arrow from its screen to its target.
   `flow check` names a screen that is not in the flow order.
8. **J8.** A put with no action, a delete and a move to another page answer `broken` with each
   broken link, and the arrow shows red with its cause.
9. **J9.** The Flows menu lists each flow with its first screen and its count, and one press
   starts it.
10. The models hold their rules, and the twins break. `tinker check` is OK.

## Boundaries

- Always: a link names screens and actions, never a position.
- Always: the viewer goes only to a screen of the board, by a link.
- Ask first: an import of the Doop clicks (`data-doop-action`) into links.
- Never: a script of a frame that changes the address of the viewer.

## Out of scope (deferred)

- **Data from one screen to the next** (a name typed on screen 1 shows on screen 2). Add it when
  a flow cannot be judged with example data (X10).
- **A transition between screens** (slide, fade). Add it when the person asks for it.
- **A link to a screen on another page.** Add it when a journey must cross pages.
- **An action on an image frame** (a hotspot box, as in Figma). Add it when a flow needs a screen
  that is only a picture.
- **An import of the 803 Doop clicks.** The frames from Doop hold `data-doop-action` with Doop ids.
  Add an import when the person asks for the flows of the moved design.
- **The picture of a request in the state of the walk.** A request keeps the version and the kit
  of the screen; its picture shows the default locale. It comes with the switches of the canvas
  (X6), as on the canvas today.
- **An overlay** (a screen on top of another, as a Figma overlay). Add it when a flow needs one.
