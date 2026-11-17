# Canvas speed: what we learned

What made a canvas of many HTML frames fast.
Learned from tuning another canvas of this kind,
measured on pages of 180 to 460 frames.

These are ideas and measurements, written fresh.
Easel's code is its own. See "Clean room" below.

## Clean room

The canvas these lessons come from is AGPL-3.0.
Copyright covers code and text, not ideas.
So we keep the ideas and write our own code.

- Do not open, copy or adapt its source,
  styles, tokens, names or tests.
- Build from this page, public docs, and the
  prior art named here.
- When in doubt, design it from first principles
  and write down why.

## The core rule

A live iframe is the most expensive thing on the
page. The DOM is next. Pictures cost least.

- Each live document is laid out, rastered and
  held in memory.
- Creating an iframe blocks the main thread:
  it is made in process, then handed off.
- Every painted element can get its own
  compositor layer. The compositor pays per
  layer on every camera frame.

So: as few live documents as possible, as little
DOM as possible, pictures for the rest.

## 1. Only frames in view are live

- A frame on screen at reading zoom gets a live
  iframe. The rest show a picture of themselves.
- Below about 30% zoom, nothing is live.
- Selected frames, and frames someone is editing
  or an agent is writing, always stay live.
- Work out the live set when the camera rests,
  not on every camera frame.
- Use hysteresis: go live within 0.1 viewport
  of the view, stay live out to 0.5.
- Measured: 200 frames, 200 live documents down
  to 20. Heap 225 to 86 MB. Settle 3.7 to 1.0 s.
- The tighter margin: 12 live documents per rest
  down to 4-6. Coming back to an area: 435 to
  183 ms of main thread.

## 2. A frame that is not live is a cheap shell

- A shell is a picture plus a name. A few
  elements, no handlers, no per-frame logic.
- A press on a shell wakes it into the full frame
  and replays the press. Select and drag still
  work in the same gesture.
- Measured (with the rest of this list's first
  pass): pan at fit 2260 to 245 ms of main thread.
  Opening a page 10.4 to 2.2 s of CPU.

## 3. Far shells leave the render tree

- A shell more than half a viewport away gets
  `display: none` (the `hidden` attribute).
  The element stays, so hit tests and links work.
- Margins: back at 0.5 viewport, gone at rest past
  0.75, gone while moving only past 1.5.
  The wide margin while moving stops flicker.
- The in/out test is arithmetic on frame boxes.
  If nothing crosses a margin, write nothing.
- Measured: layers at 60% zoom 134 to 40.
  Wheel pan at 28% about 3x faster.
- Tried and worse: `visibility: hidden` (2x the
  style cost), `content-visibility: hidden` (more
  layers), unmounting (a render per crossing).
- Prior art: tldraw culls shapes outside the view.

## 4. Pictures at the right sharpness

- Keep a small pyramid per frame, like map tiles:
  0.25, 0.5 and 1 output px per frame px.
- WebP at quality 90. Median sizes: 4, 8, 34 KB.
- Ask for the smallest level that covers the
  frame at zoom x devicePixelRatio. Never stretch.
- Only frames in or near view ask for a sharper
  level. The rest keep the smallest one. Otherwise
  zooming out loads hundreds of large pictures.
- Cap a picture at 8 megapixels, 16000 px a side.
- Wait until the camera has rested once before
  asking for anything: a new page starts at the
  last page's zoom.

## 5. Picture URLs are versioned and immutable

- The URL holds the frame's version:
  `.../preview?s=0.5&v=<version>`.
- That response is `immutable` for a year. A
  revisit costs no request.
- Store the version a picture was made from next
  to it. A restart then does not re-render all.
- A request for a newer version than is stored
  waits for the render. Dedupe and cap renders.

## 6. Never show white

Map apps keep the old tile until the new one is in.
Do the same everywhere:

- Picture to live document: keep the picture on
  top until the document says it has painted.
  The frame's runtime posts a message after its
  styles, images and web fonts settle (1.5 s cap)
  and two animation frames pass.
- Picture to a sharper picture: keep the old one
  under the new `<img>` until it has decoded.
- Live document back to picture: start from the
  last picture shown. A URL already loaded can be
  eager and decode sync, so it paints at once.
- Measured: a 68-86 ms white flash on every wake,
  and up to 80% white on a zoom, both gone.

## 7. Boot documents in turn, nearest first

- One new iframe per animation frame. Two only if
  the last frame came on time (within 20 ms).
- Nearest to the center of the view first.
- Make no documents before the camera first rests.
  On load, the camera is about to jump. A
  throwaway iframe cost 350 ms (1.7 s on a slow
  CPU).

## 8. A pan is one transform

- The world is one element with
  `translate() scale()`. A pan writes only that.
- Do not put camera values in CSS variables on a
  big subtree. An inherited custom property
  restyles every element under it.
- Read sizes from a ResizeObserver, never a layout
  read right after style writes.
- Do not re-render the stage's components on
  camera moves. Subscribe outside the render
  path and write the DOM directly.

## 9. Zoom: update chrome in steps

Chrome drawn at a fixed screen size (names,
handles, pins) has to undo the zoom.

- Rewrite the inverse zoom only after it drifts
  10%, and once when the camera rests (120 ms).
- In between, chrome is off by at most 10%.
- A small layer of labels can get the exact zoom
  every step. It is only a few elements.
- Measured: a pinch 1015 to 516 ms, slow frames
  5 to 1.

## 10. The grid: scale while moving, paint at rest

- A dot grid repainted on each zoom step rasters
  the whole view every frame.
- While zooming, scale the grid already painted.
  Repaint once the scale has drifted 1.1x, and at
  rest. Only scale up, so it still covers.
- Measured: a pinch 140 grid tiles down to 24.
- Prior art: map apps scale old tiles mid-zoom.

## 11. Zoom over live documents: pictures

- Each zoom step makes every live document
  re-raster at the new scale.
- At the first zoom step, show each live frame's
  picture and hide its iframe
  (`visibility: hidden`, still mounted). At rest, show the
  document, drop the picture once it painted.
- Keep the document for frames being edited,
  selected, written to, or with no picture yet.
- Measured: frame raster tasks 309 to 30 per
  pinch. Slow frames 46/180 to 0/180.
- Helps on some machines, costs on others. See 13.

## 12. A GPU layer for far frames (experiment)

- Draw every non-live frame as a textured quad on
  one WebGL2 canvas under the world. Names come
  from a text atlas. Hit tests are arithmetic.
- Layers at fit 204 to 9. Layerize time 150 to
  15 ms per pan.
- Only on hardware WebGL2. On a software GL it was
  much slower. Gate it the way Mapbox GL does:
  `failIfMajorPerformanceCaveat`, and no
  SwiftShader or llvmpipe in the renderer name.
- Hard parts: text at devicePixelRatio > 1 (shape
  at device size), canvas size limits, context
  loss. Fall back to DOM shells.
- Advice: leave it for later. 1-3 plus pictures
  get most of the win for far less code.

## 13. Let each browser pick (experiment)

- Experiments 11 and 12 helped on some devices and
  hurt on others.
- Each page load got a random arm. The browser
  counted slow frames per gesture: a frame is slow
  above 1.5x the display interval.
- Explore, then keep what had fewer slow frames
  (20% fewer and 2 points). With epsilon 0.1,
  keep trying the other arm.
- Reports to the server: counts only, no content.
- Advice: build the counting early. It tells you
  what is slow on real devices.

## 14. CSS traps

- `body:has(...) *`: every insertion anywhere
  restyled the whole document (40-70 ms a click).
  Use a plain attribute on body instead.
- An inherited property switched on the root
  (`user-select`, `cursor` on `*`) restyles all.
  Block text selection with a capture-phase
  `selectstart` listener. Set the cursor on one
  cover element.
- Measured: press 15 to 0.8 ms.

## 15. Cheap repeated work

- Frame HTML is immutable per version. Cache any
  answer computed from it (a regex over a whole
  document cost 30 ms per page open).

## 16. The wire

- Turn on WebSocket permessage-deflate (Bun and
  `ws` leave it off). Window 15 bits, no context
  takeover, skip messages under 1 KB.
- Measured: 5.1 MB of frame HTML to 312 KB.
  On 4G, frames on screen 10 s to 5.5 s.

## 17. Agents see cheaply (MCP)

An image costs a model tokens by its pixel area.
Raw HTML is mostly CSS the edit does not touch.

- Screenshots: any scale 0.1-2, a longest-edge
  cap, crop to an element or a region. A 1440x900
  frame is about 1700 tokens at 1x, 430 at 0.5.
- Tall frames: read in slices, not shrunk.
- Wait for `document.fonts.ready` (3 s cap) before
  a screenshot. Without it, 13 of 24 captures
  showed the fallback font.
- Reading HTML: by element id, by text search, or
  by offset. And an outline: up to 64 elements with
  box, text, colour and font, plus the palette.
- Prior art: Playwright MCP's accessibility
  snapshot, Figma's Dev Mode MCP outline.

## How to measure

- Chrome traces on a page of real screens:
  180+ frames. Count main-thread time, slow
  frames, layers, raster tiles.
- No GPU here: use GPU compositing on SwiftShader.
  Plain software compositing misleads.
  `--enable-unsafe-swiftshader --use-angle=swiftshader --enable-gpu-rasterization`
- Interleave A and B runs. A loaded machine moves
  absolute numbers; trust the comparison.
- Screencast zooms and wakes to catch white
  flashes. Numbers do not show them.

## Order to build in

1. One transform stage; 8, 14.
2. Live only in view, shells, pictures: 1, 2, 4,
   5, 6, 7.
3. Shells out of the tree: 3.
4. Zoom chrome and grid: 9, 10.
5. Wire and MCP: 16, 17.
6. Counting slow frames: 13 (just the counting).
7. Later, if numbers ask: 11, 12.
