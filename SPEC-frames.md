# Spec: frames — V1

Module `frames` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md), [ops](SPEC-ops.md) and
[kit](SPEC-kit.md).

## Objective

Hold the canvases, their frames and their share links. A canvas is an endless plane, and a frame
is one HTML document an agent wrote, or one app (a TSX module, [kit](SPEC-kit.md) § App frames),
shown at its own size and place. Agents make and change frames
through the CLI ([cli](SPEC-cli.md)). Every open tab sees each change live
([viewer](SPEC-viewer.md)). A frame can be drawn as a picture, as a browser would draw it, for the
viewer's shells and for agents. A user shares a canvas by a link, with an optional password. A
viewer who opens the link gets a pass, and looks and asks for changes with it
([queue](SPEC-queue.md)). easel keeps each old version of a frame that a request refers to.

A frame shows in the look and the kit of the easel ([kit](SPEC-kit.md)). The document holds only
the frame's content: HTML, kit classes and Tailwind utilities. At each put, easel makes the CSS of
the frame's class names (the make step of [kit](SPEC-kit.md)) and keeps it with the frame version.
When easel shows a frame in a tab, or draws its picture, it composes the document, its made CSS
and the current kit version. So a change of the look reaches each frame, and no frame
is written. What a person saw is a frame version and a kit version: a picture address names both.

Prior art: a put with a base is optimistic concurrency, as HTTP `If-Match` with `412` and
CouchDB's `_rev`: the first write on a version wins, and a later write on the same version is
refused. A picture address signed with an HMAC is a signed URL, as S3's presigned URLs and
imgproxy's signatures. A share link with an optional password is Figma's and Excalidraw's view
link. Old versions are kept by reference, as an OCI registry's garbage collection keeps each blob
that a manifest refers to and removes the rest.

## Journeys

### Make a canvas

1. `easel canvas new "Checkout flow"` prints its key, `checkout-flow`: the name in lower case, each
   run of other characters one dash, no dash at either end, cut at 40. A key that is taken answers
   `taken`; a name with no letter or digit gives no key, and is `invalid` (exit 65).
2. `easel canvas ls` lists the canvases: key, name, when it was made, and whether it is shared.
3. `easel share` and `easel unshare` are in "Share a canvas" below.
4. `easel canvas rm <canvas>` deletes the canvas, with its frames, kept versions, requests and
   messages, and ends its link.

### Make and change frames

1. `easel put <canvas> page.html --name Cart` makes a frame to the right of the others: at y 0,
   80 px right of the rightmost frame's right edge, or at 0,0 when it is the first. It is 1440×900
   unless `--size 390x844` is given. It prints the id and version 1. Every open tab shows it, in
   the look and the kit.
2. `easel ls <canvas>` lists the frames: id, name, box, version, open requests.
3. `easel get <canvas> <id> -o page.html` writes the document and prints the version.
4. `easel put <canvas> page.html --id <id> --base <version>` writes it again and prints the new
   version. The first write on a version wins. If the frame changed since that version, nothing is
   written: it answers `stale` with the current version, and exits 1. The agent gets the frame
   again, makes its change on that version, and puts again.
5. If the document is the one already stored, nothing is written and the version stays: it answers
   `unchanged` with the current version, and exits 0.
6. `--id` needs `--base`. Without it, the CLI says so and exits 64. `--name` and `--size` do not go
   with `--id`: a put with `--id` writes the document only, so the CLI says so and exits 64. An id
   that is not on the canvas answers `gone`: a put never makes a frame with a given id.
7. `easel mv <canvas> <id> --at 0,1200` moves the frame; `--size` resizes it. The version stays.
8. `easel rm <canvas> <id>` deletes the frame. Its requests stay, marked "may be outdated"
   ([queue](SPEC-queue.md)), and so do the versions that they refer to.
9. `easel shot <canvas> <id> -o shot.webp --scale 0.5` draws the current version, in the current
   kit version, as a browser does.
   The scales are 0.25, 0.5, 1 and 2. `--region x,y,w,h` crops to part of it. The CLI gets the
   picture's address from the server and fetches it over HTTP. With no Chromium on the server, it
   says pictures are off, and exits 1.
10. Each put that saves or answers `unchanged` also answers the findings of the kit check
    ([kit](SPEC-kit.md)): each place that is not in the look or the kit, with its fix. The
    findings do not stop the put. The answer holds the first 20 findings, and `more` counts the
    others. The CLI prints each one on stderr as
    `page.html:<line>:<col> <rule> <what>. Fix: <fix>`, at most 20, then the count. A document
    with `<meta name="easel-kit" content="off">` gets no look, no kit, no made CSS and no
    findings. The check and the make run before the write, against the current kit version; the
    frame version keeps its made CSS and that kit version.

### Share a canvas

1. A user runs `easel share <canvas>`. It prints a link. Anyone with the link can look and ask for
   changes. A new link, or a password change, keeps the requests of the canvas.
2. `easel share <canvas> --password <pw>` does the same, and the link asks for the password. A
   password has at least 8 characters.
3. `easel share` on a canvas that is shared prints the same link. `--password` sets or changes the
   password: every pass on the link ends, and each tab that has the canvas open goes back to the
   password page at once. Setting the same password again is no change: no pass ends, and the
   picture keys stay. `--no-password` removes the password, and the passes stay. With neither
   flag, nothing changes.
4. `easel unshare <canvas>` ends the link. Each tab that has it open shows at once that the link
   has ended. Unshare on a canvas that is not shared answers `unshared` too.
5. Sharing after an unshare makes a new link; the old one stays ended. Only `easel unshare` and
   `easel canvas rm` end a link.

### Open a share link

1. A viewer opens the link. The page asks for no name here: the first request asks for it
   ([viewer](SPEC-viewer.md#open-the-link)), and `share.name` sets it on the pass that the tab
   holds.
2. If the link has a password, the page shows textbox `Password` and button `Open`. A wrong one
   gives an `alert`. After 5 wrong tries in a minute from one address, the `alert` says to wait,
   and the page takes no password, not even the right one, until a minute has passed since the
   5th of them. Wrong tries from another address, or on another link, do not count.
3. The canvas shows ([viewer](SPEC-viewer.md)). The page has no control that changes a frame.
4. An ended or unknown link shows a page that says so, and nothing else.

## Contract

Every call but `share.open` and `share.name` is refused `{ signIn: true }` without a live user
token. `share.open` needs nothing but the link. `share.name` needs a live pass for the canvas that
it names. In V1 any signed-in user may read and write any canvas: one server is
one team.

```ts
type CanvasInfo = { key: string; name: string; created: number; shared: boolean }
type FrameInfo = { id: string; name: string; x: number; y: number; w: number; h: number; version: number }
type Frame = FrameInfo & { html: string }

// a user
"canvas.create":  { kind: "created"; key: string } | { kind: "taken" }
"canvas.list":    { canvases: CanvasInfo[] }
"canvas.delete":  { kind: "deleted" } | { kind: "gone" }
"canvas.share":   { kind: "shared"; path: string } | { kind: "gone" }
"canvas.unshare": { kind: "unshared" } | { kind: "gone" }

"frame.list":   { kind: "found"; frames: FrameInfo[] } | { kind: "gone" }
"frame.get":    { kind: "found"; frame: Frame } | { kind: "gone" }
"frame.put":    { kind: "created" | "updated" | "unchanged"; id: string; version: number;
                  findings: Finding[]; more: number }                  // Finding: SPEC-kit
              | { kind: "stale"; id: string; version: number } | { kind: "gone" }
              | { kind: "tooBig"; maxBytes: number }                  // a document over 1 MiB
              | { kind: "offKit"; findings: Finding[]; more: number } // an app frame, refused
"frame.move":   { kind: "moved" } | { kind: "gone" }
"frame.delete": { kind: "deleted" } | { kind: "gone" }
"frame.shot":   { kind: "ready"; url: string; version: number; kit: number } | { kind: "off" }
              | { kind: "gone" }

// a viewer
"share.open": { kind: "open"; canvas: string; pass: string } | { kind: "locked" } | { kind: "wrong" }
            | { kind: "slow"; retryIn: number } | { kind: "gone" }
"share.name": { kind: "named"; name: string }
```

The success kinds are these, and only these. The CLI exits 0 on them, and MCP sets no `isError`;
every other kind exits 1 and sets `isError`.

| Call                            | Success kinds                     |
| ------------------------------- | --------------------------------- |
| `canvas.create`                 | `created`                         |
| `canvas.list`                   | (every answer)                    |
| `canvas.delete`, `frame.delete` | `deleted`                         |
| `canvas.share`                  | `shared`                          |
| `canvas.unshare`                | `unshared`                        |
| `frame.list`, `frame.get`       | `found`                           |
| `frame.put`                     | `created`, `updated`, `unchanged` |
| `frame.move`                    | `moved`                           |
| `frame.shot`                    | `ready`                           |
| `share.open`                    | `open`                            |
| `share.name`                    | `named`                           |

Inputs:

- `canvas.create` takes `{ name }`, 1 to 200 characters. Its key is the name's slug: `[a-z0-9-]`, 1
  to 40 characters, each run of dashes one dash. A key a canvas has answers `taken`. A name whose
  slug is empty is `invalid`: rpc's input fault, not an answer kind.
- `frame.put` takes `{ canvas, html, name?, size?, id?, base? }`. `id` and `base` come together or
  not at all; one without the other is `invalid`, and so is `name` or `size` with `id`. Without
  them, the put makes a frame.
- An app frame (build order item 4 of [frame-apps](docs/decisions/frame-apps.md); not built yet):
  `frame.put` takes `tsx` in place of `html`, of at most 256 KiB: a larger one answers `tooBig`
  with `maxBytes` 262144 (SPEC-kit § App frames, "The file"). `easel put` sends a file whose
  name ends in `.tsx` as `tsx`. A frame is one kind for each version: a put of the other kind on
  an id is a new version of that frame. A finding of `kit/parse`, `kit/import`,
  `kit/react-state` or `kit/shape` answers `offKit` with its findings and writes nothing. The
  frame version keeps the TSX as written, its JS, its made CSS and its kit version. `frame.get`
  answers the TSX as `tsx`.
- `tooBig` is measured on the document's encoded size, its UTF-8 bytes, not its string length.
  The made CSS is not counted; it is at most 256 KiB, and a document whose CSS would be more
  answers `tooBig` too, with `maxBytes` 262144. The
  cmd sets the socket's `maxPayload` to 2 MiB, so a document a little over 1 MiB gets the
  `tooBig` answer and not a closed socket. The CLI checks the same limit before it sends.
- The CLI also checks the document as it goes on the socket, JSON-encoded: each `"`, `\` and
  control character takes 2 to 6 bytes there. Over 2 MiB less 64 KiB (`maxSentDocBytes`), the CLI
  answers `tooBig` and sends nothing, so a document of quotes under 1 MiB does not close the
  socket.
- `frame.shot` takes `{ canvas, id, scale, region? }` and answers the picture's address for the
  current version. It draws nothing; the address does.
- `canvas.share` takes `{ canvas, password? }`. A string of 8 to 1024 characters sets or changes
  the password, `null` removes it, and no field keeps it as it is. A password out of those bounds
  is `invalid`, and `easel share --password` with one is bad usage (64), as is `--password` with
  `--no-password`.
- `canvas.share` answers the link's page as a path, `/s/<link>`. `easel share` prints it joined
  to the server URL it called, so the server needs no public origin (decision C4).
- `share.open` takes `{ link, password?, name? }`. `name` is optional: the page sends it only if
  the browser kept one. It is 1 to 40 characters; `password`, 1 to 1024. A password on a link
  that has none is no try: the link opens.
- `share.name` takes `{ canvas, name }`, with the name 1 to 40 characters, trimmed, as
  `share.open` takes it. The pass in the call's meta is the proof: the `mayName` guard judges it
  as `mayRead` judges a read. No pass, a pass that is not live, or a pass for another canvas is
  refused `{ ended: true }`; a pass that a new password ended is refused `{ locked: true }`. A
  pass takes a name only once: a later name does not replace it, and `named` gives the name that
  the pass holds. So the page gives the name at the first request with no new `share.open`: it
  does not ask the password again, and the browser never keeps the password.
- A `share.open` with no password, on a link that has one, answers `locked`. It is not a try, and
  is never locked out.
- The flood limit: every `share.open` counts, any link, password or not, at most 30 a minute per
  client address (the address and the sliding minute of `login.start`'s limit, keyed as in
  decisions D7 and A8, an IPv6 address by its /64). Past it, `share.open` answers `slow` with
  `retryIn`. The page stays on Opening and calls again after `retryIn` plus up to 1 s, so tabs
  slowed together do not call together. It never shows the wait page. A password try past it
  answers `slow` as a try past 5 wrong ones does, and the password page says to wait.
- A link keeps at most 1000 passes. An open past that ends the link's oldest pass, which is
  refused `{ ended: true }` on its next read. A page whose pass is refused that way calls
  `share.open` once more. It shows the ended page only if the link is gone or the new pass is
  refused too.
- A try is a `share.open` with a password. Tries count per client address and link, in the minute
  from the first wrong one. Wrong tries 1 to 5 in that minute answer `wrong`. The 5th wrong try
  starts a lock of 1 minute from the 5th try (OWASP's lockout guidance; GitHub and GOV.UK do the
  same). In the lock, every try answers `slow` with `retryIn`, the time left to the lock's end,
  even with the right password. A try in the lock is not counted. After the lock, the count
  starts again. Apart from the flood limit, `slow` answers only a try.

`pass` is what the tab sends from then on. It is a separate 128-bit random value, not the link.
The server keeps it only as its SHA-256 digest, with the link it was given on and the viewer's
name, if the page sent one with `share.open` or later with `share.name`. A pass ends when its link ends or its link's password is set or
changed. Setting the same password again changes nothing: it ends no pass, and keeps the key
generation.

Refusals: `{ signIn: true }` (no user token, or a revoked one), `{ ended: true }` (the pass's link
has ended), `{ locked: true }` (the pass ended because the password was set or changed; the page
shows the password page). When a pass ends, the server sends its refusal at once to each live
watch that holds it.

The board (`easel.board`, read by the viewer) has the cells `frames`, `docs`, `kept` and `removed`, keyed by
canvas, and the cell `kit` of [kit](SPEC-kit.md). A document in the cell `docs` is
`{ html, css, version }`: `css` is the made CSS of that frame version, as stored. It is null for a
document that turns the kit off, and for a version stored before the kit; the page shows that
document as it is. The document of an app frame is `{ js, css, kit, version }`: its JS, its made
CSS, and the kit version of its runtime (build order item 5).
A frame on the board carries its picture key `k`. The cell `kept` carries the key of each kept
view (§ Pictures). The cell `removed` keeps each removed frame: `{ canvas, id, name, x, y, w, h,
removed }`, its name and its last box, and when it was removed, so the viewer shows the requests
of a removed frame where it was ([viewer](SPEC-viewer.md)). Every board read runs the `mayRead`
guard: a user, or a live pass for that canvas.

No call here waits on the server: each answers at once, except a draw, which stops after 20 s
(under the 50 s cap on any wait, SPEC.md).

### Pictures

A picture is `GET /api/pictures/<canvas>/<id>/<version>?s=<scale>&k=<key>&kit=<kit version>`, with
`&r=x,y,w,h` for a region. The draw composes the document of that version with that kit version
(`compose`, [kit](SPEC-kit.md)), so it needs no network for the look and the kit. For an app
frame, the draw also answers each request for the runtime of that kit version from its stored
bytes, and takes the picture after the first render ([kit](SPEC-kit.md) § App frames, "The
picture of an app frame").

A **kept view** is a kept version with the kit version that a request or a message refers to: the
kit version of the tab when the viewer asked, at the claim, or at the result
([queue](SPEC-queue.md)).

- `key` is HMAC-SHA-256 of the server's secret, the canvas, the id, the version and the canvas's
  key generation, in base64url. The secret is 256 random bits, made at the first start and kept
  under `/data`. The key generation goes up when the canvas's link ends or its password is set or
  changed (not when the same password is set again), and the board's keys are written again
  then. So the keys a viewer held stop working
  when their pass does.
- For the current version and the current kit version, it answers a WebP of them with
  `Cache-Control: private, max-age=31536000, immutable`. The board's cell `kit` names the current
  kit version, and the tab puts it in the address with the frame's key, so a change of the kit
  version gives each frame a new address. The key does not name the kit version.
- For a kept view, it answers a WebP of that version in that kit version, as for the current
  version, also after its frame was removed. It draws it at the
  frame's box, or at the last box of a removed frame. The board carries a key for each kept
  version in the cell `kept`: `{ canvas, id, version, k }`. The kit version of a kept view is in
  the request or the message that refers to it. The current version is not there: its key is on
  the frame.
- For another older version, or another kit version, or an address with no kit version, it
  answers `307` to the address of the current version and kit version, with its key and
  `Cache-Control: no-store`. A kit version that is not a number from 1 answers 404.
- A wrong key, a version not yet made, or a deleted frame with no kept version at that address
  answers 404. A scale outside
  0.25, 0.5, 1 and 2 answers 400, and so does a region off the frame or a picture over the limits
  of judged rule 6. With pictures off, every picture answers 404 and the board carries no keys.
  Each answer but a picture has `Cache-Control: no-store`.
- At most 2 draws run at once. A request that waits 5 s for a slot answers 503 with
  `Retry-After: 1`, and so does a draw that runs past 20 s or fails. `easel shot` tries 3 times,
  then exits 69. A 404 exits 1, and a 400 exits 65.
- `EASEL_CHROMIUM` names the Chromium; the image sets it to `/usr/bin/chromium`. Unset, pictures
  are off and the `chromium` readiness check holds; set to a path with no Chromium that runs, the
  check fails. Chromium reaches the network only through the server's egress proxy, which opens a
  tunnel to port 443 of a public address and nothing else (judged rule 5). It dials the addresses
  it checked, in turn, and gives each connect 10 s, and a client 10 s to send its request. WebRTC
  sends no UDP outside the proxy (a flag and the image's managed policy). Each draw has a browser
  context of its own, closed with the draw, popups included; a dialog is dismissed.
- Known risk: Chromium runs with `--no-sandbox`, as the server's user, in the server's container.
  A Chromium exploit in a drawn document would run as the server. The authors of documents are
  signed-in users only, and the container is the boundary. The follow-up is Chromium in a
  container of its own.
- `bumpKeys` raises a canvas's key generation and writes its frames' cells, and the keys of its
  kept versions, again with new keys.
  `easel unshare` and a password set or changed call it.

## Rules

The statecharts [frames-writes](docs/statecharts/frames-writes.md),
[frames-pictures](docs/statecharts/frames-pictures.md) (with a kept version:
[frames-pictures-kept](docs/statecharts/frames-pictures-kept.md)) and
[frames-share](docs/statecharts/frames-share.md) check these rules, and name each by its rule
number or section.

### Fact rules (the code graph decides)

1. Every call above but `share.open` and `share.name` runs the `user` guard first. `share.open`
   runs no guard; `share.name` runs the `mayName` guard.
2. Every operation that writes `frames`, `docs` or kept versions calls a store operation:
   `saveFrame`, `saveBox`, `dropFrame`, `dropCanvas` or `bumpKeys`.
3. `pictureRoute` draws through the one `pictures.render`. `frame.shot` does not draw.
4. `pictureRoute` depends on `pictureKey`, not on a user or a pass.
5. The store's start hook writes cells only from rows it read.
6. Every board read runs the `mayRead` guard: a user, or a live pass for that canvas.
7. The viewer's calls are `share.open`, `share.name` and the viewer calls of the queue
   (`request.add`, `edit`, `answer`, `accept`, `reopen`, `close`) only. No viewer call writes `frames` or `docs`.

### Judged rules (need reading the code)

1. A `stale`, `gone`, `taken`, `tooBig`, `offKit` or `unchanged` answer writes nothing.
2. A put on an id is one conditional write. One statement checks the base, compares the document
   and raises the version (`UPDATE … WHERE version = :base AND html IS NOT :html`), with no await
   between the check and the write. When it changes no row, the same transaction reads the row to
   answer `stale`, `unchanged` or `gone`. Of two puts on one version, the first wins and the other
   answers `stale`, so no write is lost.
3. A frame's `version` goes up by one on each change of its document, and only then: the same
   document answers `unchanged`.
4. A write saves its row before it sets its cell. The cell is set from the row as stored at that
   moment, so the board never shows a version that is not stored, and never goes back to an older
   one. If the row write throws, the cell is unchanged. A delete drops the row and the cell
   together.
5. A document drawn for a picture may load only `https` from public hosts, and `data:`. It may not
   load `http`, `file:`, or a loopback, private or link-local address. The one exception is the
   runtime of an app frame's kit version: the draw answers it from its stored bytes, and it does
   not go to the network.
6. No picture is larger than 8 megapixels or 16000 px on a side.
7. A picture answer is the drawing of the version and the kit version that its address names. The server takes that
   version and its document in one read, draws them, and checks the frame and the key again before
   it sends. An older version's address answers a redirect, never a picture, unless the version
   is kept. A deleted frame with no kept version there, or a key from before the link ended,
   answers 404, also when it happens during the draw.
8. A picture answer is `private`, so only the browser that asked keeps it: after a delete, no
   shared cache serves it.
9. A picture key is compared in constant time.
10. A share password is kept only as an argon2id hash (`Bun.password`), and has at least 8
    characters.
11. A share link names 128 random bits. It is kept readable, so that `easel share` can print it
    again (`easel canvas ls` says only that a canvas is shared). A pass is 128 other random bits, kept only as its
    SHA-256 digest. A pass is found by an indexed lookup of its digest, not by a constant-time
    compare: the digest of a 128-bit random value leaks nothing a timing could use, and it is how
    services commonly look up tokens they keep only hashed (GitHub's tokens, for one).
12. `canvas.share` on a shared canvas keeps its link. Setting or changing the password ends every
    pass on the link; removing it, or setting the same password again, ends none and keeps the key
    generation. Only `canvas.unshare` and `canvas.delete` end a link.
    An ended link stays ended, and sharing again makes a new one.
13. Unshare, a canvas delete, or a new password sends the refusal to each live watch of each pass
    it ends, before it answers. An ended pass is also refused on its next call or read.
14. Wrong passwords count per client address and link. The address is the one Traefik adds to
    `X-Forwarded-For`, never one the client sent. The server reads `X-Forwarded-For` only from
    the proxies in `EASEL_TRUSTED_PROXIES`; without it, every viewer behind Traefik is one
    address. In the minute from the first wrong try, wrong tries 1 to 5 answer `wrong`. The 5th
    starts a lock of 1 minute from the 5th try: in it, every try answers `slow` with `retryIn`,
    the time left to the lock's end, even with the right password. After the lock, the count
    starts again. Another address, or another link, is not slowed by them.
    An open with no password answers `locked`, is not a try, and is never locked out. Past the
    flood limit (30 a minute per address, any link) it answers `slow` with `retryIn`. The page
    stays on Opening and calls again after `retryIn` plus up to 1 s. It never shows the wait
    page.
15. A link, a pass and a share password never reach a span attribute, a log record, or the text of
    an `invalid` fault. Pages send `Referrer-Policy: no-referrer`, and the page's own
    `<meta name="referrer">` says the same, so a link does not leave in a `Referer` header.
    The proxy's access logs (Traefik's) do hold the path `/s/<link>`: whoever reads them can open
    the link.
16. A version that a request or a message refers to is kept until its canvas is removed. The kit
    version that it refers to is kept too ([kit](SPEC-kit.md), judged rule 4). A put
    that replaces a kept version saves the old document first, in the same transaction. A frame
    delete keeps the kept versions of the frame. Nothing else keeps an old version.
17. A put saves the document as the agent wrote it, and its made CSS beside it, in one row. An
    app frame's version also keeps its JS, made from the fixed text of the check, in that row. The
    make step runs before the conditional write, never between its check and its write. The look
    and the kit are never written into the document: only `compose` adds them, when easel shows
    or draws the frame. The made CSS of a stored frame version is never made again.
18. The findings of a put come from the one `check` of [kit](SPEC-kit.md), on the document and
    the current kit version. They change nothing that the put writes.

## Success Criteria

- An agent runs every journey above through the CLI with `--json`.
- Every contract kind and refusal is reached by a test; `tinker check` is OK.
- A test runs each share journey end to end at the rpc level: share, share again (the same link),
  the same password again (no pass ends), a new password (each live watch gets `{ locked: true }`),
  unshare (each live watch gets `{ ended: true }` at once), `share.open` answering `open`,
  `locked`, `wrong`, `slow` and `gone`, and the lockout at one address while another opens.
- Frames tests share behaviour at the rpc level: `share.open`'s answers and the pushed refusals.
  The page states that follow (the password page, the ended page) are the
  [viewer](SPEC-viewer.md)'s, which replays them as page tests.
- Each rule in the three statecharts is reached by a test that replays its path.
- After a restart, every canvas, frame and share link is back as it was (SQLite under `/data`).
- Each judged rule is judged OK with a file:line.
- After a change of the look, a test gets the picture of a frame and finds the new look; the
  picture of a kept view shows its own kit version.
- A test puts a document with findings: it is saved, and the answer holds each finding.

## Out of Scope (Deferred)

- Frame history and undo. Only the versions that requests refer to are kept (judged rule 16).
- Groups, links between frames, and z-order beyond the order frames were made.
- Assets uploaded beside a document: a document inlines what it needs, or loads it over https.
- Share links that expire by time.
