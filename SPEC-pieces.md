# Spec: `pieces`, the design system of the team as code

Status: proposed (2026-11-23, second draft after the brainstorm with the user). It replaces
SPEC-kit § Add to the kit (E8.3): pieces as HTML templates (`kit.put`, `kit.get`, `kit.list`).
That section is not built.

## Objective

The end goal of Round 1 (the user, 2026-11-23): "we can move the design from doop over to easel
and be able to use easel to further develop it". A design is built from a design system. On Doop
ours has 52 tokens, 30 components and 2 389 instances of them. easel has no place for the design
system of a team. So a moved design is a set of copies, and a change of a component does not reach
the frames that use it.

After this spec, the design system of a team is code in its kit: many Tinker capsules (the look,
the texts, primitives, patterns, layouts), each with its dependencies, and re-exported by
capsules. A frame depends on them. The code is the source of truth: the TypeScript check and the
capsule graph control how frames use the design system, and show the effect of each change.

The user decided on 2026-11-23:

- "with tinker primitives, we are upper hand control the code to be written, and we can use the
  code as source of truth". "For color, a tag or data of the shape can be imported to the code, and
  the typecheck will tell the wrong use". "Same to components and pages, they can use dependency
  and reexported by capsule".
- "We don't expect to have a single capsule tho, we expect many capsules".
- "Explore meant you can use some exceptions, not typecheck error. For example, you can use custom
  class or you can use inline texts".
- "we need to do control, or at least branded type for controlling those design system
  primitives. Good thing that we don't need to rigidly limited. We can do shadcn style, or daisy
  etc. tooling to check for duplication, weird styling etc would not be hard to have".
- "codes are real code, can be and should be checked".
- A change of the design system that breaks a frame shows its effect, as a design system change is
  expected to (answer 2 of the brainstorm).

Prior art:

- **Figma libraries.** A team publishes its components, and a change reaches each instance. Here
  the kit version is the library version, as for the look.
- **shadcn/ui and daisyUI.** Components and class names on CSS variables, with variants
  (`class-variance-authority`). The kit runtime has `cva`, `clsx` and `tailwind-merge` now.
- **Branded types** (TypeScript `string & { __brand }`, as Zod `.brand()`). A value of a brand
  comes only from its maker, so the type check finds a raw value where a token must be.
- **A monorepo with project references and CI** (Nx `affected`, Turborepo). A change of a package
  checks each package that depends on it, before the change lands.
- **Storybook.** A component in each of its states, with controls (E10).

## Decisions

1. **Values are data, shapes are code, the types join them.** The values (a color value, the
   words of a text) stay data in the kit version: `look.set` and `texts.set` change them live, with
   no type check. The shapes (the color names, the text keys, the capsules, the props) are code.
   easel makes the types of each kit version from both.
2. **The code lives in easel, in the kit version.** The design system is one folder of files in
   each kit version (`design/`), with many capsules in it. A change is one put of the folder, with
   a base. A team that wants Git keeps the folder in Git and runs `easel design put <dir>` from it.
   Why easel holds it: the live change, the check of each frame that depends on it, and the
   pictures of old kit versions need each version in one place. A Git sync is deferred (as
   GitHub is in Round 1).
3. **The type check runs on each put**, of a frame and of the design system. A type error refuses
   the put in each mode. Measured on 2026-11-23 on this host: one app frame with React, Tinker and
   the kit (185 files, about 100 000 lines) takes 0.28 s with TypeScript 7 (`tsc`), of which the
   check is 0.10 s. A put is not on the critical path of a viewer.

## New behavior

### The design system is capsules

1. The folder `design/` of a kit version holds TS and TSX files (64 files, 512 KiB at most). Each
   file may declare capsules (`capsule` of `@tinkered/core`), resources and tags. A capsule
   depends on other capsules of the folder and on the capsules of `@easel/kit` (`look`, `copy`,
   `ui`), and can re-export them.
2. The entry `design/index.ts` names the capsules that frames may use. A frame imports them from
   `@easel/design`: `import { primitives, patterns } from "@easel/design"`, and names their
   exports in `depends` (`depends: { ui: patterns.pieces }`).
3. The capsule graph (`kit.capsules`, SPEC-kit § The capsules) lists each capsule of the folder,
   what it exports, and what it depends on. The graph also lists the frames that depend on each
   capsule. So "where is `StateBadge` used" is one read.

### Branded types

4. The look gives its names as types, from the shape of the look: `ColorName`, `SpaceName`,
   `RadiusName`, `SizeName`. A class of the design system is a brand, `Cls`, made only by the
   helpers of the kit: `cls`, the variants of `cva`, and the classes that the kit makes from the
   look (`bg-primary`, `p-4`). A component of the design system takes `className?: Cls`. So a raw
   string where a class of the design system must be is a type error.
5. A text of the design system is a brand, `Said`, made only by `t` of a part
   (`say(["trial.start"])`). `TextKey` is the union of the text keys of the kit version. A
   component takes `label: Said`, so a raw string is a type error, and a typo in a text key is a
   type error.
6. easel makes `@easel/kit` types for each kit version: the look names and the text keys of that
   version, and the types of `design/`. An agent gets them with `easel design types -o <dir>`, so
   its editor checks as easel does.

### Exploring and ready (SPEC-copy, changed)

7. An exploring frame may use **exceptions**. An exception is an explicit call of
   `@easel/explore`: `custom("bg-[#f00]")` gives a `Cls` for any class, and `inline("Start free
trial")` gives a `Said` for any text. The code still passes the type check.
8. A ready frame imports nothing from `@easel/explore`. That is the whole rule of ready for
   classes and texts. The settle rules of SPEC-copy (`copy/text`, `copy/own`, `copy/key`,
   `look/color`, `look/size`) become this rule plus the type check.
9. The design system itself has no exceptions: `design/` does not import `@easel/explore`.

### A change of the design system

10. `design.put` checks the new folder, then type-checks each frame that depends on a capsule that
    changed (from the graph), against the new types.
    - A ready frame with a type error refuses the put: the answer `breaks` names each frame, its
      file, line and error. Nothing is written. The team changes the frames first, or marks them
      exploring.
    - An exploring frame with a type error does not stop the put. The answer lists it as
      `exploringBroken`, and the frame shows its last good version until a put fixes it.
11. After the put, each live document of a frame that depends on a changed capsule gets a new
    document, as for a new frame version (the page keeps the old iframe until the new one draws).
    A frame that depends on no changed capsule keeps its document. Each picture of such a frame is
    made again for the new kit version.
12. A request keeps the kit version that its viewer saw, so its picture shows the design system as
    it was.

### Checks of styling

13. Two checks of the design system, as findings that do not stop a put (a later version can make
    them stop it):
    - **duplicate**: a frame repeats one list of classes, or one JSX shape, that a component of
      the design system has. The fix names the component.
    - **arbitrary**: an arbitrary value (`p-[13px]`) in `design/`, or an exception in a frame that
      is ready to be marked. The fix names the class of the look.

## Contract

```ts
type DesignFinding = Finding & { frame?: { canvas: string; id: string } }

"design.get":   { kind: "found"; kit: number; rev: number; files: Record<string, string> }
"design.put":   { kind: "updated" | "unchanged"; rev: number; kit: number;
                  exploringBroken: DesignFinding[]; findings: DesignFinding[] }
              | { kind: "stale"; rev: number; kit: number }
              | { kind: "offKit"; findings: DesignFinding[]; more: number }
              | { kind: "breaks"; findings: DesignFinding[]; more: number }
              | { kind: "tooBig"; maxBytes: number }
"design.types": { kind: "found"; kit: number; files: Record<string, string> }
```

- `design.put` takes `{ files: Record<string, string>, base: number }`. `rev` starts at 0 (no
  design system) and each change adds 1.
- A frame put gets the finding rule `type` for a type error, with the error of TypeScript.
- MCP: `get_design`, `put_design`, `design_types`. CLI: `easel design get -o <dir>`,
  `easel design put <dir> --base <rev>`, `easel design types -o <dir>`.

## Model

A change of the design system moves the documents of the live frames that depend on it, and can be
refused by a ready frame. That is new state. So a TLA+ model and its chart come first
(`design-change`): two frames (ready and exploring) that depend on one capsule, a third that does
not, a `design.put` that breaks or not, a frame put at the same time, and the old iframe until the
new one draws. Its rules:

- No ready frame has a type error against the current kit version.
- Each live frame that depends on a changed capsule shows the new kit version in the end.
- A frame that depends on no changed capsule keeps its document.

## Fact rules

1. Only `design.put` writes `design/`. A kit version never changes.
2. A change of the design system writes no frame and no frame version.
3. Each ready frame passes the type check against the current kit version, and imports nothing
   from `@easel/explore`.
4. The type check and the capsule graph read the code. Nothing of a frame or of `design/` runs on
   the server.

## Success criteria

1. **The move.** The design system of the Doop canvas `easel · Design system` is `design/`: its
   tokens as look values, and its 29 components in capsules (primitives, patterns, layout). Each
   component has a frame that shows it with controls for its variants (E10). Each frame looks as
   its copy from Doop: SSIM 0.95 or more on `easel shot` at scale 0.5.
2. **A screen from the design system.** The E4 popover of `easel · Product design` is a ready app
   frame. It uses only `@easel/design`, the look and the texts, and it matches its Doop copy as in
   criterion 1.
3. **A change reaches each frame.** After one `design.put` that changes `StateBadge`, each live
   frame that depends on it shows the change within 2 seconds, and each picture in view within
   10 seconds. No frame version changed.
4. **A change shows its effect.** A `design.put` that renames a prop of `StateBadge` is refused
   `breaks`, with each ready frame that uses the old name.
5. **Exceptions.** An exploring frame with `custom("bg-[#f00]")` and `inline("Hi")` is created and
   shows both. `frame.ready` on it answers `unsettled`, with the two exceptions.
6. **The type check.** A frame put with a type error is refused with the line and the error. A put
   of a usual frame takes 0.5 s at most on this host.
7. **An agent finds the design system.** A new agent with only the MCP tools makes a frame with a
   request row. It uses `RequestRow` from the capsule list and writes no new row.
8. The model holds its rules. The speed gate stays green, and a frame that uses no design system
   loads no more bytes than today.

## Testing strategy

- A server test for each kind of the three calls and for the 4 fact rules.
- A test of the type check of a frame (a type error, a raw string for a `Said`, a raw class for a
  `Cls`, an exception in a ready frame), and of the effect check of `design.put`.
- A browser test: a `design.put` gives a new document to a live frame that depends on the changed
  capsule, within 2 seconds, and not to the other frames.
- `scripts/statecharts.sh --check design-change`.
- The move: a script puts `design/` and the frames, shots each frame, and compares it with its copy
  from Doop.
- `offload -- bun run speed`, before and after.

## Boundaries

- Always: the design system changes through the kit version, as the look and the texts do.
- Ask first: a second folder, or the design system of another team.
- Never: run the code of a frame or of `design/` on the server. Never let `design/` import
  `@easel/explore` or a frame.

## Out of scope (deferred)

- **HTML pieces** (SPEC-kit § Add to the kit). Capsules replace them. Add HTML pieces when an
  agent makes HTML frames that must share a part.
- **A frame that depends on another frame** (a flow of screens, the prototype clicks of Doop: 803
  on 82 frames). It needs the board worker (SPEC-kit § App frames, item 7). Add it when a reviewer
  asks for a flow of frames.
- **A Git sync of `design/`.** Add it when a team keeps its design system in Git and a put from CI
  is not enough.
- **A catalogue page** made by easel from the graph. A frame of each component with controls is
  the catalogue for Round 1.
- **The duplicate and arbitrary checks as refusals.** Add them when a team asks for a strict design
  system.

## Open questions

1. **The 10 colors of our Doop design with no look name** (accent, on-accent, accent-bg, faint,
   divider, card, scrim, focus-halo, shadow-low, shadow-mid). I recommend new look names, in the
   pattern of `success` and `success-soft`. They change the look names, which SPEC-kit says are
   fixed. With the look names as types (rule 4), a team's own names are one more step: a later
   version can let `design/` add look names.
