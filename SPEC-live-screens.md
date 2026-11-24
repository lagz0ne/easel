# Spec delta: `live-screens`, the design and the app agree

Status: approved by the requirements of 2026-11-24 (E11, V1 to V7; the user: "yes, please work on
this"). The user granted autonomy for this round, so the agent decided the open points below.

It adds to [SPEC-design-loop](SPEC-design-loop.md) rules 3, 6 to 8 and 13. It is the design of E11
in [docs/epics.md](docs/epics.md).

## Objective

The person accepted three designs on `product` (#1 the zoom of the dock as one `100% ⌃` button, #2
a small floating header, #3 an 8 px dot on the Requests button). The agents changed the frame
copies, but the live app did not change, and nothing showed the difference. After this delta:

- after each deploy, the person sees each designed screen beside its live screen (V1 to V3);
- an accept of a design starts the change of the app, and the reply names the live build (V4, V7);
- a check fails when a live screen uses a value that the design system does not have (V6);
- a change of a part of the app reaches each live screen that uses it (V5, its first step).

## Prior art

| Tool                               | What we take                                                                                                                                    | What we leave                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Storybook and Chromatic            | A fixed state of each screen (a story), taken after each build in one fixed browser, and a picture beside the last accepted one (the baseline). | The service: the pictures go to easel, where the person already looks. No accept of a baseline. |
| Percy                              | Freeze the time and the motion before a take, so two takes of one build are the same.                                                           | The review page of Percy.                                                                       |
| Playwright `toHaveScreenshot`      | A take is a page of a real browser at a fixed size; a compare counts the pixels that differ.                                                    | A failed test on a difference: here a difference is news for the person, not a failure.         |
| Figma Code Connect                 | Each design names its code, and each code names its design: here a screen names its designed frame.                                             | Code snippets in the design.                                                                    |
| stylelint-declaration-strict-value | A value of a color, a size or a font must be a value of the design system.                                                                      | The check of the source: we check the values that the browser computed on the live screen.      |

## The decisions

1. **Where the job runs: in GitHub Actions, after the deploy.** The workflow `deploy` gets a job
   `screens`. It starts after the job `live` says that the site serves the build. It runs the
   `dist/server` of the build (an artifact of the job `deploy`), in the Playwright image of the
   gates, so the browser and the fonts are the same each time. Other ways:
   - A service on vibea. It needs no secret outside the machine, but it runs on the slow disks
     beside the live apps, and it needs its own watch of the deploys.
   - Chromatic or Percy. The pictures go to a service outside easel, and the person does not see
     them on the canvas.
2. **The writer is the member `vibea-claude`.** The job uses the secret `EASEL_TOKEN` of the
   environment `production`: the token of `vibea-claude`, put there with `gh secret set` and never
   printed. As Chromatic and Percy do, the token is a secret of the CI. An owner revokes it with
   `easel users revoke vibea-claude`.
3. **The fixed fixture canvas.** The job starts the server of the build on a new database, and makes
   the canvas `Shop redesign`, as the designs show it: the frames `Pricing`, `Checkout, mobile` and
   `Sign-up`, each a fixed HTML document. A viewer named Mai writes the requests in the page of the
   share link, and the fixture's agent claims and resolves them through MCP. The texts are fixed.
   Before a take, the job freezes the clock of the page, stops the motion
   (`prefers-reduced-motion`), and hides the text caret.
4. **The screens are code.** `src/live/screens.ts` lists each live screen: its key, the id and the
   name of its designed frame on `product`, and the steps from the fixture to the screen. The
   first list has three screens, the screens of the accepted designs and the list:

   | Key            | Designed frame on `product`                                   | The state                                            |
   | -------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
   | `requests`     | `a679c2c12a09` E4.4 Follow the requests (F1–F3 F6 P3)         | The board, with the Requests card open.              |
   | `accepted`     | `52b790a2057e` E4.2 Accepted, proof on After (M12 M17)        | A request in the card, its result accepted.          |
   | `opened-again` | `b172c148226c` E4.2 Opened again after an accept, … (M12 M17) | A request opened again after an accept, with a note. |

   Each screen has four takes: `desktop light`, `desktop dark` (1440×900), `phone light` and
   `phone dark` (390×844).

5. **The `Live` page of `product`.** The job makes the page `Live` when it is not there. Each
   screen has one row. The row starts with a picture of the designed frame, then each take has two
   image frames, Before and After. The status frame `Live · status` is at the top left. The frames
   have the name of the designed frame first, so Find (S15) shows the design and its live screens
   together:
   - `<design name> · design`: a picture of the designed frame;
   - `<design name> · live · <take>`: the After;
   - `<design name> · before · <take>`: the Before.

   easel cannot give a frame a new name, and a frame for each build would fill the page. So the
   names stay, and each image has a strip of 40 px under it with its build and its take
   (`build 280 · desktop light`), or the version of the design (`design v4`).

6. **A take, and what the job puts.** For each take of build `n`, the job finds the After of that
   take by its name, and its build in the status frame:
   - No After: it puts the take as the After (`new`).
   - The After is of another build: it puts the image of that After as a new version of the
     Before, then the take as a new version of the After (`next`, V3).
   - The After is of build `n`: it compares the pixels. The same pixels: it puts nothing, and the
     status says `same` (V2). Other pixels: it puts nothing, and the status says `differs`. That
     is a finding, because two takes of one build must be the same.
   - The take fails: it puts nothing, so the last good After stays, and the status names the screen
     and the reason. The job ends red, and keeps a picture of the page in the run.

   Each take of a screen starts from the share link, in a new browser context, with the size, the
   theme, `prefers-reduced-motion` and the text caret off. A request opens by its link
   (`#request-<n>`). A take starts only when the pins of the fixture show. All 12 takes run at
   the same time, so each age on the screen stays `just now`. A take with an older age fails: it
   came too late, and it is not a difference of the build.

7. **The values of a live screen (V6).** During each take, the page reads the computed style of
   each element of easel's own page that shows (not of a frame's document): the colors (text,
   background, border, outline, SVG fill and stroke), the font size and the font family. The look
   of the design system is the token blocks of the frames on `design-system` (`--e-*`, light and
   dark). A value that is not a token value is a finding, with the element where it shows: in the
   status frame, and in `bun run design:proof`. A transparent color is not a value. The job
   gives a warning for it and does not end red: the proof is the check that fails.
8. **The status frame.** `Live · status` is an HTML frame. It shows the build, its commit, each
   screen with each take (`new`, `next`, `same`, `differs`, `failed: <why>`), the build of each
   After and Before, and each value outside the design system. It also holds the same data as
   JSON in `<script type="application/json" id="easel-live">`: the job reads it on its next run,
   and the proof reads it.
9. **An accept starts the change of the app (V4).** A viewer accepts the result of a request on a
   canvas that a `nats` channel covers. Then easel adds one build request on the same frame: its
   author is `easel`, its text starts with `Build:` and names the accepted request and the frame
   version. The build request waits, and goes to the design agents as each request does. The
   agent changes the code of easel to match the frame, ships it, and resolves the build request
   when its build is live. An accept of a build request adds no other request. When the agent
   cannot do it, it releases or declines the build request with the reason, so the person sees why,
   and the design stays accepted.
10. **The reply names a live build (V7).** `request.resolve` takes an optional `build`. easel
    refuses it with `notLive` when the build is over its own build, so a reply never names a build
    that is not live. The result message ends with `Live in build <n>.`. A build request needs a
    build: easel refuses its resolve with no build (`needsBuild`).
11. **A change of a part (V5), the first step.** The live app has one copy of each part (one dock,
    one header, one badge), and the job takes each screen again after each build. So a change of
    the dock shows on each live screen that has the dock, with the next deploy. The designed frames
    are HTML copies; a change of a part on one copy does not reach the others. `design:proof` lists
    each designed frame whose copy of a part differs from the part on `design-system`, as a count,
    not as a finding. Deferred: a part as code that each designed frame imports
    ([SPEC-pieces](SPEC-pieces.md), rule 18), so that a change reaches each designed frame too.
12. **`design:proof` reads easel (D9-8).** It reads `design-system` and `product` through MCP over
    HTTP, with the token of the member `vibea-claude` (`EASEL_CONFIG_HOME`, else
    `~/.config/easel-agent`). It keeps its rules (S1 to S14, T1, R1 to R6, K8), and adds:
    - V1: each screen of `src/live/screens.ts` has its designed frame on `product`, and an After of
      each take on `Live` of the live build;
    - V1: each frame with an accepted request on `product` is a screen of the list, or the list
      says why not;
    - V2: no take of the status frame says `differs`;
    - V6: each value of the status frame is a value of the look of `design-system`.

## What changes

| Part                           | Change                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/live/`                    | The screens, the names of the live frames, the plan of a take, the check of the values.     |
| `scripts/live-screens.ts`      | The job: the fixture, the takes, the puts. `--dry <dir>` writes the takes and puts nothing. |
| `.github/workflows/deploy.yml` | The job `screens`, after `live`.                                                            |
| `scripts/design-proof.ts`      | Reads easel, not Doop; the rules V1, V2, V6.                                                |
| `src/queue`                    | The build request on an accept; `build` on a resolve (V4, V7).                              |
| `services/paseo-adapter`       | The prompt says what a build request asks.                                                  |
| `src/viewer`                   | The accepted designs #1 to #3: the dock zoom, the floating header, the dot.                 |

## Success criteria

1. **V1.** Within 10 minutes of a deploy, `Live` on `product` has the After of each take of each
   screen, and its strip and the status frame name the build of `/api/version`.
2. **V2.** A second run of the job on the same build puts nothing, and its status says `same` for
   each take.
3. **V3.** After a second build, each take has a Before of the first build beside its After.
4. **V4.** An accept on `product` adds a build request within 1 minute, and a design agent starts.
5. **V5.** After the deploy of the dock change, each After with the dock shows the new dock.
6. **V6.** `bun run design:proof` prints OK against easel. A throwaway check with a color that is
   not in the design system fails.
7. **V7.** A resolve that names a build over the live build is refused with `notLive`.

## Boundaries

- Always: the job and the proof write to the live easel only as `vibea-claude`.
- Ask first: a change of a value of the look of `design-system`.
- Never: the job deletes a frame or a canvas. It puts new versions only.

## Out of scope (deferred)

- **The other designed screens.** The first list has 3 screens. Add a screen to the list when its
  design is accepted.
- **Parts as code for the designs** (SPEC-pieces): a change of a part that reaches each designed
  frame.
- **A pixel diff picture.** Before and After show side by side; a picture of the changed pixels
  comes when a person asks for it.
