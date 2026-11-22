import { lookup } from "node:dns/promises";
import { BlockList, connect, createServer, isIP } from "node:net";
import type { Socket } from "node:net";

import { capsule, operation, resource, tag } from "@tinkered/core";
import puppeteer from "puppeteer-core";
import type { Browser } from "puppeteer-core";
import { z } from "zod";

import { compose } from "@/kit/compose";
import { inlineFonts } from "@/kit/fonts.server";
import { readKit, readKitAt } from "@/kit/store.server";
import { readiness } from "@/ops/registry";
import { seenView } from "@/queue/store.server";

import { frames, framesApi, maxPicturePixels, maxPictureSide, picturePrefix } from "./contract";
import {
  chromiumPath,
  keyMatches,
  loadPictures,
  pictureDatabase,
  pictureKey,
  pictureState,
} from "./keys.server";
import { readPicture, readStill } from "./store.server";

// Pictures (SPEC-frames.md § Pictures; the frames-pictures chart). `GET /api/pictures/<canvas>/
// <id>/<version>?s=&k=&kit=&r=` needs no user and no pass: its key is the right to it (fact rule
// 4). The route takes the version and its document in one read, composes it with the kit version
// (`compose`, SPEC-kit fact rule 3), draws it through the one `pictures.render` (fact rule 3), and
// checks the frame and the key again before it sends (judged rule 7). The version is the current
// one in the current kit version, or a kept view: a version and a kit version that a request or a
// message refers to, also of a removed frame, drawn at the frame's last box (K10). A Chromium from
// `EASEL_CHROMIUM` draws, through puppeteer-core; with none, pictures are off: the board carries
// no keys, every picture is 404, and `frame.shot` answers `off`.

/** At most 2 draws at once; a request waits at most 5 s for a slot, and a draw runs at most 20 s. */
export const drawsAtOnce = 2;
export const slotWaitMs = 5_000;
export const drawLimitMs = 20_000;

/** The answers that keep nothing: a refusal, a redirect, a busy server. */
const noStore = { "Cache-Control": "no-store" } as const;

/** A picture of the current version is the same bytes for ever: only the browser that asked keeps it. */
export const pictureCache = "private, max-age=31536000, immutable";

/**
 * Where a drawn document may not reach (judged rule 5): loopback, private, link-local, shared,
 * benchmark, multicast and reserved addresses, both families, and the IPv6 forms that carry an
 * IPv4 address (compatible, translated, NAT64, 6to4, Teredo). An IPv4 address mapped into IPv6 is
 * checked as itself by the list.
 */
const closed = new BlockList();

for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  closed.addSubnet(net, bits, "ipv4");
}

for (const [net, bits] of [
  ["::", 96],
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  closed.addSubnet(net, bits, "ipv6");
}

/** How the proxy resolves a host name: every address it has. A test gives its own. */
export const hostLookup = tag<
  (host: string) => Promise<Array<{ address: string; family: number }>>
>({
  label: "pictures.hostLookup",
  default: (host) => lookup(host, { all: true }),
});

/** How the proxy dials an address it checked, on port 443. A test gives its own. */
export const proxyDial = tag<(address: string) => Socket>({
  label: "pictures.proxyDial",
  default: (address) => connect({ host: address, port: 443 }),
});

/**
 * The addresses to connect to, in order, if every address a host has is public (judged rule 5):
 * an IP literal is itself; a name is resolved, and one closed address closes it. Null: no way
 * there.
 */
export const publicAddress = operation({
  label: "pictures.publicAddress",
  input: z.string(),
  depends: { lookup: hostLookup },
  run: async ({ lookup }, { input }) => {
    const host = input.replace(/^\[(.*)\]$/, "$1");
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host).catch(() => []);
    const open = addresses.every(
      ({ address, family }) => !closed.check(address, family === 6 ? "ipv6" : "ipv4"),
    );
    return open && addresses.length > 0 ? addresses.map(({ address }) => address) : null;
  },
});

/** The proxy's refusal. */
const forbidden = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";

/** The proxy's answer when no checked address of a host connects. */
const unreachable = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n";

/** The most a proxy request's head may be, up to its blank line. */
const proxyHeadBytes = 8 * 1024;

/** How long the proxy waits for a client's head, and for each upstream connect. */
export const proxyWaitMs = 10_000;

/**
 * Where a proxy request may go: the addresses to dial, in order, for a `CONNECT` to port 443 of a
 * host whose every address is public. Null for anything else: plain http, another port, a closed
 * host.
 */
export const tunnelTarget = operation({
  label: "pictures.tunnelTarget",
  input: z.string(),
  depends: { publicAddress },
  run: async ({ publicAddress }, { input }) => {
    const asked = /^CONNECT (\[[0-9a-fA-F:.]+\]|[^\s:]+):443 HTTP\/1\.[01]\r\n/.exec(input);
    if (!asked?.[1]) return null;

    return publicAddress.run({ input: asked[1] });
  },
});

/**
 * The proxy's open sockets, both ends of each tunnel: all are destroyed when the scope closes.
 */
const proxySockets = resource({
  label: "pictures.proxySockets",
  target: "scope",
  depends: { dial: proxyDial },
  factory: ({ dial }, ctx) => {
    const open = new Set<Socket>();
    ctx.defer(() => {
      for (const socket of open) socket.destroy();
    });

    return {
      /** Tracks a socket until it closes; an error closes it. */
      keep(socket: Socket) {
        open.add(socket);
        socket.on("close", () => open.delete(socket));
        socket.on("error", () => socket.destroy());
      },

      /** Calls `late` after 10 s, unless the returned stop is called first. */
      deadline(late: () => void) {
        const stop = new AbortController();
        ctx.clock
          .sleep(proxyWaitMs, AbortSignal.any([stop.signal, ctx.signal]))
          .then(late, () => undefined);
        return () => stop.abort();
      },

      /**
       * Joins the client to the first address that connects within 10 s, trying each in turn;
       * none: 502. Once joined, either end closing closes both: nothing more is written.
       */
      tunnel(client: Socket, addresses: readonly string[], rest: Buffer) {
        const [address, ...others] = addresses;
        if (address === undefined) {
          client.end(unreachable);
          return;
        }

        const upstream = dial(address);
        this.keep(upstream);
        const joined = { at: false };
        const stop = this.deadline(() => upstream.destroy());
        upstream.once("connect", () => {
          joined.at = true;
          stop();

          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (rest.length > 0) upstream.write(rest);
          upstream.pipe(client);
          client.pipe(upstream);
          client.resume();
        });

        client.once("close", () => upstream.destroy());
        upstream.once("close", () => {
          stop();
          if (joined.at) client.destroy();
          else if (!client.destroyed) this.tunnel(client, others, rest);
        });
      },
    };
  },
});

/**
 * The egress proxy (judged rule 5, on the network): Chromium sends every connection through it,
 * loopback too, and it is the one line a drawn document meets. It opens only a `CONNECT` tunnel
 * to port 443 of a host whose every address is public, and dials the addresses it checked, so a
 * name that resolves again to a closed one later reaches nothing. A plain http request, a
 * WebSocket in the clear, or any other port is refused. A client that sends no head in 10 s is
 * cut off. The prior art is Stripe's smokescreen.
 */
export const egressProxy = resource({
  label: "pictures.egressProxy",
  target: "scope",
  depends: { tunnelTarget, sockets: proxySockets },
  factory: ({ tunnelTarget, sockets }, ctx) => {
    const server = createServer((client) => {
      sockets.keep(client);
      const headed = sockets.deadline(() => client.destroy());
      client.once("close", headed);

      let head = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0 && head.length > proxyHeadBytes) client.end(forbidden);
        if (end < 0) return;

        headed();
        client.off("data", onData);
        client.pause();
        void tunnelTarget.settle({ input: head.toString("latin1", 0, end + 2) }).then((found) => {
          const addresses = found.status === "success" ? found.value : null;
          if (addresses === null || client.destroyed) client.end(forbidden);
          else sockets.tunnel(client, addresses, head.subarray(end + 4));
        });
      };
      client.on("data", onData);
    });

    let listening: Promise<number> | null = null;
    ctx.defer(() => {
      if (server.listening) server.close();
    });

    return {
      /** The proxy's port on 127.0.0.1, listening from the first ask. */
      port(): Promise<number> {
        listening ??= new Promise<number>((done, fail) => {
          server.once("error", fail);
          server.listen(0, "127.0.0.1", () => {
            const at = server.address();
            if (at === null || typeof at === "string") fail(new Error("pictures: no proxy port"));
            else done(at.port);
          });
        });
        return listening;
      },
    };
  },
});

/**
 * The flags of a Chromium that draws in a container: no sandbox (the container is the bound), no
 * GPU, no WebRTC UDP outside the proxy (the image's managed policy says the same), a small disk
 * cache and at most 512 MB of script heap.
 */
const chromiumArgs = [
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--disk-cache-size=1048576",
  "--js-flags=--max-old-space-size=512",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--disable-background-networking",
  "--disable-sync",
];

/**
 * The one Chromium, started at the first draw (or the first readiness check) and again after it
 * exits. It closes with the server.
 */
export const chromiumBrowser = resource({
  label: "pictures.browser",
  target: "scope",
  depends: { state: pictureState, proxy: egressProxy },
  factory: ({ state, proxy }, ctx) => {
    let started: Promise<Browser> | null = null;
    ctx.defer(async () => {
      const last = started;
      started = null;
      await last?.then((browser) => browser.close()).catch(() => undefined);
    });

    return {
      open(): Promise<Browser> {
        const path = state.current.chromium;
        if (path === null) return Promise.reject(new Error("pictures: no Chromium"));
        if (started) return started;

        // Every connection goes through the egress proxy; `<-loopback>` sends loopback there too.
        const starting = proxy
          .port()
          .then((port) =>
            puppeteer.launch({
              executablePath: path,
              headless: true,
              args: [
                ...chromiumArgs,
                `--proxy-server=http://127.0.0.1:${port}`,
                "--proxy-bypass-list=<-loopback>",
              ],
            }),
          )
          .then((browser) => {
            browser.on("disconnected", () => {
              if (started === starting) started = null;
            });
            return browser;
          });
        started = starting;
        starting.catch(() => {
          if (started === starting) started = null;
        });
        return starting;
      },
    };
  },
});

/** A region of a frame and a scale, as the route checked them. */
const drawInput = z.object({
  html: z.string(),
  w: z.number(),
  h: z.number(),
  scale: z.number(),
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

/**
 * One draw: a browser context of its own (its own cookies, cache and storage), and in it a page at
 * the frame's size and the scale. A dialog is dismissed. The document is loaded, its fonts are
 * ready, and the region is taken as WebP. The context closes after, or at the signal, and every
 * page in it with it, a popup too. The network is the egress proxy's.
 */
export const drawPage = operation({
  label: "pictures.drawPage",
  input: drawInput,
  depends: { browser: chromiumBrowser },
  run: async ({ browser }, { input, signal }) => {
    const chrome = await browser.open();
    const context = await chrome.createBrowserContext();
    // A stop ends the draw at once, wherever it is: a step of Chromium's may never answer once
    // its context is closing.
    const stopped = Promise.withResolvers<never>();
    stopped.promise.catch(() => undefined);
    const close = () => {
      stopped.reject(new Error("pictures: the draw was stopped"));
      void context.close().catch(() => undefined);
    };
    // The listener first, then the check: a stop that came while the context was made closes it.
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted) close();

    try {
      const page = await Promise.race([stopped.promise, context.newPage()]);
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
      // Each step races the stop: the page is sized, the document loaded, its fonts ready, then
      // the region is taken.
      await Promise.race([
        stopped.promise,
        page.setViewport({ width: input.w, height: input.h, deviceScaleFactor: input.scale }),
      ]);
      await Promise.race([
        stopped.promise,
        page.setContent(input.html, { waitUntil: "load", timeout: drawLimitMs }),
      ]);
      await Promise.race([
        stopped.promise,
        page.evaluate(() => document.fonts.ready.then(() => undefined)),
      ]);
      const shot = await Promise.race([
        stopped.promise,
        page.screenshot({
          type: "webp",
          quality: 90,
          clip: {
            x: input.region.x,
            y: input.region.y,
            width: input.region.w,
            height: input.region.h,
          },
        }),
      ]);

      return new Uint8Array(shot);
    } finally {
      signal.removeEventListener("abort", close);
      await context.close().catch(() => undefined);
    }
  },
});

/** The draw slots: how many are free, and who waits for one, first come first served. */
export const drawSlots = resource({
  label: "pictures.slots",
  target: "scope",
  factory: (): { free: number; queue: Array<{ given: boolean; give: () => void }> } => ({
    free: drawsAtOnce,
    queue: [],
  }),
});

/**
 * `pictures.render`: the one way a picture is drawn (fact rule 3). It takes a slot, waiting at
 * most 5 s (`busy` past that), and draws, at most 20 s (`late` past that: the draw is stopped).
 * The slot goes to the next in line when the draw has ended.
 */
export const render = operation({
  label: "pictures.render",
  input: drawInput,
  depends: { slots: drawSlots, drawPage },
  run: async ({ slots, drawPage }, { input, clock, signal }) => {
    if (slots.free > 0) {
      slots.free -= 1;
    } else {
      const turn = Promise.withResolvers<void>();
      const waiter = { given: false, give: turn.resolve };
      slots.queue.push(waiter);

      const stop = new AbortController();
      const waited = await Promise.race([
        turn.promise.then(() => "slot" as const),
        clock
          .sleep(slotWaitMs, AbortSignal.any([stop.signal, signal]))
          .catch(() => undefined)
          .then(() => "late" as const),
      ]);
      stop.abort();

      if (waited === "late" && !waiter.given) {
        slots.queue.splice(slots.queue.indexOf(waiter), 1);
        return { kind: "busy" as const };
      }
    }

    // `settle`, not `run`: a draw that fails or is stopped is this run's answer, not its failure.
    const quit = new AbortController();
    const drawing = Promise.resolve(
      drawPage.settle({ input, signal: AbortSignal.any([quit.signal, signal]) }),
    );
    void drawing.finally(() => {
      const next = slots.queue.shift();
      if (next) {
        next.given = true;
        next.give();
      } else {
        slots.free += 1;
      }
    });
    const stop = new AbortController();
    const drawn = await Promise.race([
      drawing.then((result) =>
        result.status === "success"
          ? { kind: "drawn" as const, webp: result.value }
          : { kind: "late" as const },
      ),
      clock
        .sleep(drawLimitMs, AbortSignal.any([stop.signal, signal]))
        .catch(() => undefined)
        .then(() => ({ kind: "late" as const })),
    ]).finally(() => stop.abort());
    if (drawn.kind !== "drawn") {
      // Stopped: the draw ends at its signal (its context closes); wait for that, so no draw
      // outlives the request and its slot is back before the 503 goes out.
      quit.abort();
      await drawing;
    }
    return drawn;
  },
});

/** The route's raw input: its path params and query, each a string; each is checked in `run`. */
const routeInput = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.string(),
  s: z.string().optional(),
  k: z.string().optional(),
  kit: z.string().optional(),
  r: z.string().optional(),
});

/** A scale as the address writes it: 0.25, 0.5, 1 or 2, and no other spelling. */
const scales = new Map([
  ["0.25", 0.25],
  ["0.5", 0.5],
  ["1", 1],
  ["2", 2],
]);

/** A picture's address on this server, as a path: what `frame.shot` answers, and a 307's Location. */
const pictureAddress = operation({
  label: "pictures.address",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    version: z.number(),
    s: z.string().optional(),
    k: z.string(),
    kit: z.number(),
    r: z.string().optional(),
  }),
  run: (_, { input: at }) =>
    `${picturePrefix}${at.canvas}/${at.id}/${at.version}?s=${at.s ?? ""}&k=${at.k}&kit=${at.kit}${at.r === undefined ? "" : `&r=${at.r}`}`,
});

/** A refusal: no body, never stored; a 503 says when to try again. */
const refusal = operation({
  label: "pictures.refusal",
  input: z.union([z.literal(400), z.literal(404), z.literal(503)]),
  run: (_, { input: status }) =>
    new Response(null, {
      status,
      headers: status === 503 ? { ...noStore, "Retry-After": "1" } : noStore,
    }),
});

const box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

/** `r=x,y,w,h`: four whole numbers of at most 5 digits. */
const regionQuery = z
  .string()
  .regex(/^\d{1,5},\d{1,5},\d{1,5},\d{1,5}$/)
  .transform((typed) => typed.split(",").map(Number))
  .pipe(z.tuple([z.number(), z.number(), z.number(), z.number()]))
  .transform(([x, y, w, h]) => ({ x, y, w, h }));

/**
 * The scale and region a picture's query asks for (`region` null: the whole frame); null when
 * either is malformed.
 */
const readAsk = operation({
  label: "pictures.ask",
  input: z.object({ s: z.string().optional(), r: z.string().optional() }),
  run: (_, { input }) => {
    const scale = scales.get(input.s ?? "");
    const region = regionQuery.nullable().safeParse(input.r ?? null);
    if (scale === undefined || !region.success) return null;

    return { scale, region: region.data };
  },
});

/**
 * The part of the frame to draw: the region, or the whole frame. Null when it is off the frame,
 * under a pixel either way, or its picture at the scale is past 16000 px a side or 8 MP.
 */
const pictureBox = operation({
  label: "pictures.box",
  input: z.object({ region: box.nullable(), w: z.number(), h: z.number(), scale: z.number() }),
  run: (_, { input }) => {
    const at = input.region ?? { x: 0, y: 0, w: input.w, h: input.h };
    const onFrame =
      Math.min(at.w, at.h) >= 1 && Math.max(at.x + at.w - input.w, at.y + at.h - input.h) <= 0;
    const [wide, high] = [at.w * input.scale, at.h * input.scale];
    const small = Math.max(wide, high) <= maxPictureSide && wide * high <= maxPicturePixels;
    return onFrame && small ? at : null;
  },
});

/** A version or a kit version as the address writes it: 1 to 999999999, no other spelling. */
const numberQuery = /^[1-9]\d{0,8}$/;

/** The current kit version; the store has one from the first start (`kitStart`). */
const kitNow = operation({
  label: "pictures.kitNow",
  depends: { readKit },
  run: async ({ readKit }) => {
    const now = await readKit.run();
    if (now === null) throw new Error("pictures: no kit version: kitStart runs first");

    return now;
  },
});

/**
 * The kit version to draw a stored version in: the one asked, when it is the current kit version
 * and the version is the current one, or when a request or a message refers to the two (a kept
 * view). Else null: no kit version asked, or another one.
 */
const viewKit = operation({
  label: "pictures.viewKit",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    version: z.number(),
    current: z.number().nullable(),
    kit: z.number().nullable(),
    now: z.number(),
  }),
  depends: { seenView },
  run: async ({ seenView }, { input }) => {
    const { kit, ...at } = input;
    if (kit === null || kit > input.now) return null;
    if (input.version === input.current && kit === input.now) return kit;

    const seen = await seenView.run({ input: { ...at, kit } });
    return seen ? kit : null;
  },
});

/** A version and a kit version as the address writes them; null when either is malformed. */
const addressed = operation({
  label: "pictures.addressed",
  input: z.object({ version: z.string(), kit: z.string().optional() }),
  run: (_, { input }) => {
    if (!numberQuery.test(input.version) || !numberQuery.test(input.kit ?? "1")) return null;

    return {
      version: Number(input.version),
      kit: input.kit === undefined ? null : Number(input.kit),
    };
  },
});

/**
 * The look to draw a version in (`viewKit`), as stored, or null; and the current kit version, for
 * a redirect.
 */
const viewLook = operation({
  label: "pictures.viewLook",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    version: z.number(),
    current: z.number().nullable(),
    kit: z.number().nullable(),
  }),
  depends: { kitNow, viewKit, readKitAt },
  run: async ({ kitNow, viewKit, readKitAt }, { input }) => {
    const now = await kitNow.run();
    const shown = await viewKit.run({ input: { ...input, now: now.version } });
    if (shown === null || shown === now.version) return { now: now.version, look: shown && now };

    return { now: now.version, look: await readKitAt.run({ input: shown }) };
  },
});

/** A picture's version, read with its canvas's key generation: as `readPicture` answers it. */
const readRow = z.object({
  current: z.number().nullable(),
  gen: z.number(),
  doc: z
    .object({ html: z.string(), css: z.string().nullable(), w: z.number(), h: z.number() })
    .nullable(),
});

/**
 * Where a picture address with a good key goes: the document to draw, with its made CSS, the kit
 * version's look and CSS, and the box, when the version is stored and the two are the current
 * ones or a kept view. Else 404 for a removed frame or a version not yet made; 307 to the address
 * of the current version in the current kit version for any other version or kit version.
 */
const placePicture = operation({
  label: "pictures.place",
  input: routeInput.extend({ asked: z.number(), kit: z.number().nullable(), row: readRow }),
  depends: { viewLook, pictureKey, pictureAddress, refusal },
  run: async ({ viewLook, pictureKey, pictureAddress, refusal }, { input }) => {
    const { asked, row, ...at } = input;
    const { current, doc, gen } = row;
    const view = await viewLook.run({
      input: { canvas: at.canvas, id: at.id, version: asked, current, kit: at.kit },
    });
    if (doc && view.look) {
      return { ...doc, look: view.look.root, kitCss: view.look.css, gen, version: asked };
    }
    if (current === null || asked > current) return refusal.run({ input: 404 });

    const k = pictureKey.run({ input: { canvas: at.canvas, id: at.id, gen, version: current } });
    const location = pictureAddress.run({ input: { ...at, version: current, k, kit: view.now } });
    return new Response(null, { status: 307, headers: { ...noStore, Location: location } });
  },
});

/**
 * The version and the kit version a picture address names, when its key is good (`placePicture`).
 * Else 404 with pictures off, a malformed version or kit version, a missing frame or a wrong key.
 */
const findPicture = operation({
  label: "pictures.find",
  input: routeInput,
  depends: {
    state: pictureState,
    addressed,
    readPicture,
    pictureKey,
    keyMatches,
    placePicture,
    refusal,
  },
  run: async (units, { input }) => {
    const { state, readPicture, pictureKey, keyMatches, refusal } = units;
    const asked = units.addressed.run({ input });
    if (state.current.chromium === null || asked === null) return refusal.run({ input: 404 });

    const at = { canvas: input.canvas, id: input.id };
    const row = await readPicture.run({ input: { ...at, version: asked.version } });
    const want = pictureKey.run({ input: { ...at, gen: row.gen, version: asked.version } });
    if (!keyMatches.run({ input: { sent: input.k ?? "", want } })) {
      return refusal.run({ input: 404 });
    }

    return units.placePicture.run({
      input: { ...input, asked: asked.version, kit: asked.kit, row },
    });
  },
});

/**
 * Draws the box of the frame, composed with the kit version (`compose`): 400 off the frame or past the limits; 503 with no slot or past
 * 20 s; 404 when the version is not there any more (its frame was deleted and it is not kept) or
 * its keys changed during the draw; else the picture.
 */
const drawPicture = operation({
  label: "pictures.draw",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    version: z.number(),
    html: z.string(),
    css: z.string().nullable(),
    look: z.string(),
    kitCss: z.string(),
    w: z.number(),
    h: z.number(),
    gen: z.number(),
    scale: z.number(),
    region: box.nullable(),
  }),
  depends: { readStill, render, pictureBox, refusal, compose, inlineFonts },
  run: async ({ readStill, render, pictureBox, refusal, compose, inlineFonts }, { input }) => {
    const region = pictureBox.run({ input });
    if (region === null) return refusal.run({ input: 400 });

    const kit = { look: inlineFonts.run({ input: input.look }), css: input.kitCss };
    const html = compose.run({ input: { html: input.html, css: input.css, kit } });
    const drawn = await render.run({
      input: { html, w: input.w, h: input.h, scale: input.scale, region },
    });
    switch (drawn.kind) {
      case "busy":
      case "late":
        return refusal.run({ input: 503 });
      case "drawn":
        break;
    }

    const still = await readStill.run({
      input: { canvas: input.canvas, id: input.id, version: input.version },
    });
    if (!still.live || still.gen !== input.gen) return refusal.run({ input: 404 });
    return new Response(drawn.webp, {
      status: 200,
      headers: { "Content-Type": "image/webp", "Cache-Control": pictureCache },
    });
  },
});

/**
 * `GET /api/pictures/{canvas}/{id}/{version}`: the picture (SPEC-frames § Pictures). A scale
 * outside the four, a malformed region, or a region off the frame or past 8 MP or 16000 px a
 * side is 400. With pictures off, a wrong key, a missing frame, a version not yet made, or a
 * malformed kit version, 404. A kept view is drawn as the current one is, in its own kit version.
 * Another version or kit version, or none: 307 to the current one, with its key; of a removed
 * frame, 404. No slot in 5 s, or a draw past 20 s:
 * 503 with `Retry-After: 1`. A frame deleted or a link ended during the draw: 404.
 */
export const pictureRoute = operation({
  label: "pictures.route",
  input: routeInput,
  depends: { readAsk, findPicture, drawPicture, refusal },
  run: async ({ readAsk, findPicture, drawPicture, refusal }, { input }) => {
    const ask = readAsk.run({ input });
    if (ask === null) return refusal.run({ input: 400 });

    const found = await findPicture.run({ input });
    if (found instanceof Response) return found;

    const at = { canvas: input.canvas, id: input.id, ...ask };
    return drawPicture.run({ input: { ...found, ...at } });
  },
});

/**
 * `frame.shot`: the address of the frame's current version in the current kit version, with the
 * key the board carries for it. It draws nothing (fact rule 3). `off`: the server has no
 * Chromium; `gone`: no such frame.
 */
export const shotFrame = operation({
  label: "frame.shot.do",
  input: framesApi["frame.shot"].input,
  depends: { state: pictureState, cells: frames.atScope.controller, pictureAddress, kitNow },
  run: async ({ state, cells, pictureAddress, kitNow }, { input }) => {
    if (state.current.chromium === null) return { kind: "off" as const };
    const frame = cells.of({ canvas: input.canvas, id: input.id }).get();
    if (frame?.k === undefined) return { kind: "gone" as const };

    const kit = (await kitNow.run()).version;
    const r =
      input.region && `${input.region.x},${input.region.y},${input.region.w},${input.region.h}`;
    const at = { ...input, version: frame.version, s: `${input.scale}`, k: frame.k, kit, r };
    const url = pictureAddress.run({ input: at });
    return { kind: "ready" as const, url, version: frame.version, kit };
  },
});

/**
 * The readiness check `chromium` (SPEC-ops): with `EASEL_CHROMIUM` unset, pictures are off by
 * choice, and it holds. Set, the Chromium there must start.
 */
export const chromiumCheck = operation({
  label: "pictures.chromiumCheck",
  depends: { state: pictureState, browser: chromiumBrowser },
  run: async ({ state, browser }) => {
    if (state.current.asked === null) {
      return { ok: true, detail: "pictures off: no EASEL_CHROMIUM" };
    }
    if (state.current.chromium === null) {
      return { ok: false, detail: "pictures off: no Chromium at EASEL_CHROMIUM" };
    }
    return browser.open().then(
      () => ({ ok: true, detail: "Chromium runs" }),
      () => ({ ok: false, detail: "Chromium does not start" }),
    );
  },
});

/**
 * The server's side of pictures, filled by the cmd. Install it before `framesServer`: the board's
 * keys need the secret. `chromium`: `EASEL_CHROMIUM`, or null; `database`: `EASEL_DB`, beside
 * which the secret is kept.
 */
export const picturesServer = capsule({
  label: "picturesServer",
  config: { chromium: chromiumPath, database: pictureDatabase },
  tags: [readiness({ name: "chromium", op: chromiumCheck })],
  hooks: {
    async start({ run, next }) {
      await run(loadPictures, {}, { role: "setup", explain: "Finds Chromium and the secret" });
      await next();
    },
  },
});
