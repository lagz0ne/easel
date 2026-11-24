# Spec delta: `words`, the person reviews and translates the texts

Status: approved on 2026-11-24 by the requirements of the user of that day ("Now onto the custom
controller, copies, i18n, screen and flows"). The user granted autonomy ("granted bypass"), so the
agent approved this delta against L9, L10, L11, L13 and L14, and did not ask again.

Module `words` of [MAP-round-1.md](MAP-round-1.md). Requirements: L9, L10, L11, L13 and L14 of
[E9](docs/epics.md#e9-one-voice). It adds to [SPEC-copy.md](SPEC-copy.md) (the texts of the team by
text key, built CP-1 to CP-5).

## Objective

Round 1 is one person and the agents. The agents do all the work. The person reads, comments,
accepts and decides. The texts are a part of the design that the person reviews, as the look is.

Today the texts of the team are in one place (`easel texts ls`), but the person cannot see the
words that the frames show. Most frames on `product` and `design-system` are HTML frames that came
from Doop, with no text key. Nothing tells which text a frame uses, which text no frame uses, or
which text has no translation. A frame in `vi` shows the `en` text with no mark.

After this delta, the person opens one page of easel and sees each text of each frame: the texts
of the team with their uses, the texts that no frame uses, the texts with no translation, and the
texts with no text key. From a use, the person opens the frame. An agent gives the `vi` texts, and
the person sees each text beside its translation. With one pick of the locale, each live frame
shows `vi`, and each text with no translation shows its `en` text with a mark.

## Decisions and prior art

1. **A text of an app frame** is a text key that its code names in `say` (both forms of SPEC-copy
   rule 4), an own text of a part, and a literal text of its JSX. easel reads the code, and does
   not run it (SPEC-copy judged rule 1). A frame that uses the pieces of `ui` uses the texts of
   `ui`. Prior art: the extractors of i18next (`i18next-parser`) and FormatJS read the keys from
   the code with no run. `eslint-plugin-i18next` (`no-literal-string`) finds a literal text in JSX.
2. **A text of an HTML frame** is a text in its markup: the text of the body, and the attributes
   `placeholder`, `title`, `alt` and `aria-label`. easel does not read `head`, `script`, `style`,
   `template` and `noscript`. The phrase elements (`a`, `b`, `strong`, `em`, `i`, `code`, `kbd`,
   `small` and the like) stay in one text with the words around them. Each other element starts a
   new text. Prior art: the HTML parsers of Crowdin and Lokalise take the text nodes and the
   attributes `alt`, `title` and `placeholder`, and keep the inline tags in one segment. easel
   reads the markup and does not run it. So a text that CSS hides is in the list, and a text that a
   script writes is not. No frame on `product` or `design-system` writes its text with a script.
3. **A text with no letter is not a word**: a number, a time, a symbol (`3`, `12:04`, `→`). It is
   not in the list, and it needs no translation. Prior art: the default `words.exclude` of
   `eslint-plugin-i18next`.
4. **An HTML frame can show a text of the team**: an element with `data-easel-text="<text key>"`
   shows the text of that key in the locale, in place of its own content. Its own content stays as
   the text before the page applies the text of the team. Prior art: the `data-i18n` attribute of
   `loc-i18next`, and `i18n="@@id"` of Angular.
5. **An image frame** is a picture. easel cannot read the words in it. The page gives the count of
   image frames, so the person knows that their words are not in the list. Prior art: the text
   review of Figma reads the text layers only, not the images.
6. **A text with no key** (an own text) is listed once for each set of words, with each frame that
   shows it. It has no translation in any locale, and the page says so. Prior art: Ditto and the
   Figma plugin of Ditto list "unlinked" text beside the texts of the library.
7. **Not used** is a text of the team that no current version of a frame on any canvas uses. No
   call removes a text key (SPEC-copy): removal stays deferred.
8. **Not translated** is a text of the team with no `vi` text. `en` is the first language: each
   text key has an `en` text (SPEC-copy fact rule 4). Prior art: the "untranslated" filter and the
   progress count of each language in Crowdin, Lokalise and Phrase.
9. **The mark in a frame.** In `vi`, a live frame shows the `en` text of a text with no `vi` text,
   and a mark under it: a wavy line, as a spelling mark. The page draws the mark with the CSS
   Custom Highlight API, so the mark does not change the DOM or the layout of the frame. In an HTML
   frame, each text with no key also has the mark. In an app frame, `t` puts the `en` text between
   U+2068 and U+2069 (the Unicode isolates, which show nothing). The page finds them and marks the
   text between. Prior art: the in-context review of Tolgee and Phrase marks each string in the
   running app, and Tolgee finds its strings by invisible characters. Fluent puts the isolates
   around each value that it inserts. The `missingKeyHandler` and `fallbackLng` of i18next show the
   text of the first language.
10. **One pick.** The locale pick of the dock shows when the texts of the team have a `vi` text, or
    a live app frame offers locales (today: only the second). The pick reaches each live frame: an
    app frame draws in a new scope (as today), and an HTML frame gets a new document. The board
    switch `locale` of SPEC-pieces rule 11 is the work of another agent (X6). It takes this pick
    over, and this delta does not build it.
11. **A picture keeps the first language.** A frame that is not live shows its picture, in `en`
    and with its own words, as the chart [kit-frame-axes](docs/statecharts/kit-frame-axes.md) says.
    A frame that the person can read (in view, at a zoom to read) is live. Add a locale to the
    picture address when a person reviews a language at a zoom that is too small to read.
12. **One place for the person, the same answer for the agents.** The page `/texts` is for a
    signed-in person, with the look of `src/design` (as the home page), and the home page links to
    it. The call `texts.uses` gives the same answer to the page, to the CLI
    (`easel texts uses`) and to MCP (`list_text_uses`).
13. **No new work on the open of a canvas** (Q3). easel reads the texts of the frames only when a
    person or an agent asks for `texts.uses`. A live HTML frame gets the script of the texts only
    when it has `data-easel-text`, or the pick is not `en`.

## Current behavior

- `texts.list` gives each text of the team and `noVi`. It does not tell where a text is used.
- The check of an app frame reads `say` (`kit.textFindings`). Nothing reads the text of an HTML
  frame.
- The locale pick of the dock shows only when a live app frame posts its axes. No frame on the live
  easel is an app frame, so the pick does not show.
- An HTML frame shows its own markup in each locale. An app frame in `vi` shows the `en` text of a
  text with no `vi` text, with no mark.
- A link to a canvas opens its first page, or the page of `?page=`. It does not go to a frame.

## New behavior

### The texts of the frames

1. `texts.uses` reads the current version of each frame on each canvas, and the texts of the team
   of the current kit version. With `canvas`, it reads the frames of that canvas only.
2. A **use** is one frame that shows a text: its canvas, its id, its name and its page.
3. The answer has four lists, and two counts:
   - `texts`: each text of the team, with its `en` text, its `vi` text if it has one, and its
     uses. A text with no use is **not used**.
   - `unknown`: each text key that a frame uses and the team does not have, with its uses.
   - `own`: each text with no key, once for each set of words, with its uses.
   - `missing.vi`: each text key of the team with no `vi` text.
   - `frames`: the count of frames that easel read; `pictures`: the count of image frames.
4. The words of a text with no key have their white space made into one space, and no space at
   the start or the end. Two texts with the same words are one text with two uses. The order is
   by the count of uses, then by the words.

### The page

5. `/texts` shows the page "Texts" to a signed-in person. A person who is not signed in sees the
   sign-in of the home page. The home page links to it ("Texts"), in its head.
6. The head of the page gives the counts: the texts of the team, how many are not used, how many
   have no `vi` text, the texts with no key, the frames read, and the image frames.
7. The table of the texts of the team has a row for each text key: the text key, the `en` text,
   the `vi` text, and the uses. A row with no `vi` text shows "Not translated". A row with no use
   shows "Not used". So the person sees each text beside its translation (L14).
8. Each use is a link to `/c/<canvas>#frame-<id>`. The canvas opens on the page of that frame
   (the viewer finds it with `share.frame`), and the view goes to the frame and puts it in the
   middle (L10).
9. A list of the texts with no key follows, with the uses of each, and the note "A text with no key
   has no translation". A list of the unknown text keys comes before it when there is one.

### The texts in a frame

10. An element of an HTML frame with `data-easel-text="<text key>"` shows the text of that key in
    the locale, else its `en` text. A plural shows `other`, or the form for the number in
    `data-easel-count`. `{count}` takes that number. A text key that the team does not have keeps
    the own content of the element.
11. In `vi`, a live frame marks each text with no translation:
    - an element with `data-easel-text` whose text key has no `vi` text;
    - each other text of an HTML frame (it has no key);
    - in an app frame, each text that `t` gives in `en` because its text key has no `vi` text.
12. The mark is a wavy line under the text, in the warning color. It changes no layout. In `en`, no
    text has a mark.
13. The locale pick of the dock shows `en` and `vi` when a text of the team has a `vi` text. A
    pick composes each live frame again, if the frame has text keys or the pick is not `en`.
14. After `texts.set`, each live HTML frame with `data-easel-text` gets a new document with the new
    texts, within 1 second (as L5 for an app frame).

## Contract

```ts
type Use = { canvas: string; id: string; name: string; page: string }

"texts.uses": input { canvas?: CanvasKey }
  output { kind: "found"; kit: number; rev: number; frames: number; pictures: number;
           texts: Array<{ key: TextKey; en: Text; vi?: Text; uses: Use[] }>;
           unknown: Array<{ key: string; uses: Use[] }>;
           own: Array<{ text: string; uses: Use[] }>;
           missing: { vi: TextKey[] } }
```

- The MCP gets `list_text_uses`. The CLI gets `easel texts uses [--canvas <k>] [--json]`. Its text
  output gives each text of the team with its uses (or `not used`), then the missing `vi` texts,
  then the count of texts with no key.
- The kit runtime: `t` in a locale that is not `en` gives `"\u2068" + en + "\u2069"` for a text
  of the team with no text in that locale. A new runtime reaches a frame after `easel kit accept`
  and a put of the frame (SPEC-kit § App frames).

## Model

The live document of an HTML frame is new state: it depends on the version, the pick, and now on
the texts of the team. So a TLA+ model and its chart come first, as
[words-frame](docs/statecharts/words-frame.md). The model has one HTML frame with a text key and
one with none, a put, `texts.set`, the pick, and the view. Its rules:

- A frame with no text key in `en` is never composed again for a change of the texts or for the
  pick `en` (rule 13, Q3).
- A live document in `vi` marks the texts that its inputs do not translate, and no other.
- A live frame comes to show the current version, texts and pick, unless it leaves the view.
- A second config composes with no revision of the texts. It breaks the third rule, so the check
  is seen to work.

## Fact rules

1. `texts.uses` writes nothing: no frame, no kit version, no cell.
2. `texts.uses` runs the `user` guard first, as each call of `kit`.
3. Each text of the team is in `texts` one time. A text with no use has `uses: []`.
4. The page reads the texts only through `texts.uses`. It has no other read of the frames.

## Judged rules

1. easel reads the code and the markup of a frame. It does not run them on the server.
2. The script of the texts in a live frame changes the text of an element with `data-easel-text`
   only. It adds no element and no class to the frame.

## Success criteria

1. **L9.** On a canvas with an HTML frame, an app frame and an image frame, `/texts` shows each
   text of the HTML frame and of the app frame, and the count of image frames. A test compares the
   list with the texts of the fixture, one for one.
2. **L10.** On `/texts`, a click on a use opens the canvas on the page of the frame, with the frame
   in the middle of the view. A test clicks it and finds the frame live.
3. **L11.** A text of the team that no frame uses shows "Not used". After a put of a frame that
   uses it, the next read shows the use.
4. **L13.** `/texts` gives the count of texts with no `vi` text, and each one. In `vi`, a live HTML
   frame marks its text with a key and no `vi` text, and its texts with no key. A live app frame
   marks the `en` text of a text key with no `vi` text. In `en`, nothing has a mark.
5. **L14.** After `set_texts` gives a `vi` text for each text key, `/texts` shows each `en` text
   beside its `vi` text, and "Not translated" is gone. One pick of `vi` in the dock shows each live
   frame with its text keys in `vi`.
6. The live proof on `easel.vibea.dev`, as the member `vibea-claude`: the `vi` texts given by MCP,
   the page with each text, its uses, a not used mark and the missing count, and a frame in `vi`
   with a mark. The screenshots are in `~/work/tmp/2026-11-24-words/`.
7. The model holds its rules, and its second config breaks.
8. The speed gate stays green: the `open` step is in its budget, and not slower than its base.
9. `tinker check` finds no exit of `texts.uses` that a test does not reach.

## Testing strategy

- A server test of `texts.uses`: the texts of an HTML frame, an app frame (`say` in both forms, an
  own text, JSX text, `ui`), an image frame, `data-easel-text`, a text key that the team does not
  have, not used, `missing.vi`, and `canvas`.
- A CLI test of `easel texts uses`, and the MCP table (one more tool).
- A browser test of `/texts`: the counts, the table, "Not used", "Not translated", the list of texts
  with no key, and a use that opens the frame.
- A browser test of the viewer: an HTML frame with `data-easel-text` in `en` and in `vi`, the marks,
  and a new document after `texts.set`.
- A test of `say`: the isolates around a text with no `vi` text, and none in `en`.
- `scripts/statecharts.sh --check words-frame words-frame-no-rev`.

## Boundaries

- Always: read the frames on request only. One answer for the page, the CLI and MCP.
- Ask first: a new table, a new cell on the board, or a write to a frame for a translation.
- Never: run the code of a frame on the server. Never change a frame to show a mark.

## Out of scope (deferred)

- **Remove a text key** (the failure end of E9.3). Add it with a rule for the ready frames that use
  it, when the person asks to remove a text that is not used.
- **A text key for each own text of an HTML frame.** The agent adds `data-easel-text` when it
  moves a frame to the texts of the team. Add a tool that proposes the keys when an agent asks for
  it.
- **A locale in the picture address** (decision 11).
- **More locales than `en` and `vi`** (as SPEC-copy).
- **The board switch `locale`** (SPEC-pieces rule 11, X6): another agent builds it.
- **An edit of a text on the page.** The person decides, and an agent writes with `texts.set`
  (Round 1: the agents do all the work).
- **L2**, a check that refuses a text with no key: the page lists these texts now.
