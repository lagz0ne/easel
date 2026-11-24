import { lookup } from "node:dns/promises";
import { BlockList, connect, createServer, isIP } from "node:net";
import type { Socket } from "node:net";

import { capsule, operation, resource, tag } from "@tinkered/core";
import puppeteer from "puppeteer-core";
import type { Browser } from "puppeteer-core";
import { z } from "zod";

import { compose, composeApp, composeKit } from "@/kit/compose";
import { inlineFonts } from "@/kit/fonts.server";
import { runtimeAddress, runtimeOf, storedFiles } from "@/kit/runtime.server";
import { readKit, readKitAt } from "@/kit/store.server";
import { readiness } from "@/ops/registry";
import { seenView } from "@/queue/store.server";

import { frames, framesApi, maxPicturePixels, maxPictureSide, picturePrefix } from "./contract";
import { imageDataUri, imageDoc } from "./images.server";
import {
  chromiumPath,
  keyMatches,
  loadPictures,
  pictureDatabase,
  pictureKey,
  pictureState,
} from "./keys.server";
import { readPicture, readStill } from "./store.server";

export const drawsAtOnce = 2;
export const slotWaitMs = 5_000;
export const drawLimitMs = 20_000;

const noStore = { "Cache-Control": "no-store" } as const;

export const pictureCache = "private, max-age=31536000, immutable";

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

export const hostLookup = tag<
  (host: string) => Promise<Array<{ address: string; family: number }>>
>({
  label: "pictures.hostLookup",
  default: (host) => lookup(host, { all: true }),
});

export const proxyDial = tag<(address: string) => Socket>({
  label: "pictures.proxyDial",
  default: (address) => connect({ host: address, port: 443 }),
});

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

const forbidden = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n";

const unreachable = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n";

const proxyHeadBytes = 8 * 1024;

export const proxyWaitMs = 10_000;

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
      keep(socket: Socket) {
        open.add(socket);
        socket.on("close", () => open.delete(socket));
        socket.on("error", () => socket.destroy());
      },

      deadline(late: () => void) {
        const stop = new AbortController();
        ctx.clock
          .sleep(proxyWaitMs, AbortSignal.any([stop.signal, ctx.signal]))
          .then(late, () => undefined);
        return () => stop.abort();
      },

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

const drawRuntime = z.object({ prefix: z.string(), files: z.record(z.string(), z.string()) });

const drawInput = z.object({
  html: z.string(),
  w: z.number(),
  h: z.number(),
  scale: z.number(),
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  runtime: drawRuntime.nullable(),
});

const runtimeOrigin = "http://runtime.easel.invalid";

export const drawPage = operation({
  label: "pictures.drawPage",
  input: drawInput,
  depends: { browser: chromiumBrowser },
  run: async ({ browser }, { input, signal }) => {
    const chrome = await browser.open();
    const context = await chrome.createBrowserContext();
    const stopped = Promise.withResolvers<never>();
    stopped.promise.catch(() => undefined);
    const close = () => {
      stopped.reject(new Error("pictures: the draw was stopped"));
      void context.close().catch(() => undefined);
    };
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted) close();

    try {
      const page = await Promise.race([stopped.promise, context.newPage()]);
      page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
      const runtime = input.runtime;
      if (runtime) {
        await Promise.race([stopped.promise, page.setRequestInterception(true)]);
        page.on("request", (request) => {
          const url = request.url();
          if (!url.startsWith(runtime.prefix)) {
            void request.continue().catch(() => undefined);
            return;
          }

          const text = runtime.files[url.slice(runtime.prefix.length)];
          const answer =
            text === undefined
              ? { status: 404, body: "" }
              : { status: 200, contentType: "text/javascript; charset=utf-8", body: text };
          const headers = { "Access-Control-Allow-Origin": "*" };
          void request.respond({ ...answer, headers }).catch(() => undefined);
        });
      }
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
          omitBackground: true,
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

export const drawSlots = resource({
  label: "pictures.slots",
  target: "scope",
  factory: (): { free: number; queue: Array<{ given: boolean; give: () => void }> } => ({
    free: drawsAtOnce,
    queue: [],
  }),
});

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
      quit.abort();
      await drawing;
    }
    return drawn;
  },
});

const routeInput = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.string(),
  s: z.string().optional(),
  k: z.string().optional(),
  kit: z.string().optional(),
  r: z.string().optional(),
});

const scales = new Map([
  ["0.25", 0.25],
  ["0.5", 0.5],
  ["1", 1],
  ["2", 2],
]);

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

const regionQuery = z
  .string()
  .regex(/^\d{1,5},\d{1,5},\d{1,5},\d{1,5}$/)
  .transform((typed) => typed.split(",").map(Number))
  .pipe(z.tuple([z.number(), z.number(), z.number(), z.number()]))
  .transform(([x, y, w, h]) => ({ x, y, w, h }));

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

const numberQuery = /^[1-9]\d{0,8}$/;

const kitNow = operation({
  label: "pictures.kitNow",
  depends: { readKit },
  run: async ({ readKit }) => {
    const now = await readKit.run();
    if (now === null) throw new Error("pictures: no kit version: kitStart runs first");

    return now;
  },
});

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

const readRow = z.object({
  current: z.number().nullable(),
  gen: z.number(),
  doc: z
    .object({
      html: z.string(),
      css: z.string().nullable(),
      js: z.string().nullable(),
      kit: z.number().nullable(),
      image: z.string().nullable(),
      w: z.number(),
      h: z.number(),
    })
    .nullable(),
});

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
      const { root: look, css: kitCss, texts } = view.look;
      return { ...doc, look, kitCss, texts, gen, version: asked };
    }
    if (current === null || asked > current) return refusal.run({ input: 404 });

    const k = pictureKey.run({ input: { canvas: at.canvas, id: at.id, gen, version: current } });
    const location = pictureAddress.run({ input: { ...at, version: current, k, kit: view.now } });
    return new Response(null, { status: 307, headers: { ...noStore, Location: location } });
  },
});

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

const imagePictureDoc = operation({
  label: "pictures.imageDoc",
  input: z.object({ canvas: z.string(), sha: z.string() }),
  depends: { imageDataUri, imageDoc },
  run: async ({ imageDataUri, imageDoc }, { input }) => {
    const src = await imageDataUri.run({ input });
    if (src === null) throw new Error(`pictures: the image ${input.sha} is not stored`);

    return { html: imageDoc.run({ input: { src, name: "" } }), runtime: null };
  },
});

const pictureDoc = operation({
  label: "pictures.doc",
  input: z.object({
    canvas: z.string(),
    html: z.string(),
    css: z.string().nullable(),
    js: z.string().nullable(),
    kit: z.number().nullable(),
    image: z.string().nullable(),
    look: composeKit,
  }),
  depends: { compose, composeApp, runtimeOf, runtimeAddress, storedFiles, imagePictureDoc },
  run: async (units, { input }) => {
    const { html, css, js, kit, look } = input;
    if (input.image !== null) {
      const sha = input.image;
      return units.imagePictureDoc.run({ input: { canvas: input.canvas, sha } });
    }
    if (js === null || kit === null) {
      return { html: units.compose.run({ input: { html, css, kit: look } }), runtime: null };
    }

    const runtime = await units.runtimeOf.run({ input: kit });
    const files = runtime && (await units.storedFiles.run({ input: { kit, sha: runtime.sha } }));
    if (!runtime || !files) throw new Error(`pictures: kit version ${kit} has no runtime`);

    const at = units.runtimeAddress.run({ input: { kit, sha: runtime.sha } });
    const address = `${runtimeOrigin}${at}`;
    const link = { address, imports: runtime.imports };
    const doc = units.composeApp.run({ input: { js, css: css ?? "", kit: look, runtime: link } });
    return { html: doc, runtime: { prefix: address, files } };
  },
});

const drawPicture = operation({
  label: "pictures.draw",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    version: z.number(),
    html: z.string(),
    css: z.string().nullable(),
    js: z.string().nullable(),
    kit: z.number().nullable(),
    image: z.string().nullable(),
    look: z.string(),
    kitCss: z.string(),
    texts: z.record(z.string(), z.unknown()),
    w: z.number(),
    h: z.number(),
    gen: z.number(),
    scale: z.number(),
    region: box.nullable(),
  }),
  depends: { readStill, render, pictureBox, refusal, pictureDoc, inlineFonts },
  run: async ({ readStill, render, pictureBox, refusal, pictureDoc, inlineFonts }, { input }) => {
    const region = pictureBox.run({ input });
    if (region === null) return refusal.run({ input: 400 });

    const look = {
      look: inlineFonts.run({ input: input.look }),
      css: input.kitCss,
      texts: input.texts,
    };
    const { html, runtime } = await pictureDoc.run({ input: { ...input, look } });
    const drawn = await render.run({
      input: { html, runtime, w: input.w, h: input.h, scale: input.scale, region },
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

export const shotFrame = operation({
  label: "frame.shot.do",
  input: framesApi["frame.shot"].input,
  depends: { state: pictureState, cells: frames.atScope.controller, pictureAddress, kitNow },
  run: async ({ state, cells, pictureAddress, kitNow }, { input }) => {
    if (state.current.chromium === null) return { kind: "off" as const };
    const [frame] = cells.where({ canvas: input.canvas, id: input.id }).get();
    if (frame?.k === undefined) return { kind: "gone" as const };

    const kit = (await kitNow.run()).version;
    const r =
      input.region && `${input.region.x},${input.region.y},${input.region.w},${input.region.h}`;
    const at = { ...input, version: frame.version, s: `${input.scale}`, k: frame.k, kit, r };
    const url = pictureAddress.run({ input: at });
    return { kind: "ready" as const, url, version: frame.version, kit };
  },
});

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
