import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { routes } from "~/components/requests/index.server";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { framesRun, pictureFetch } from "@/cli/frames";
import type { FramesCommand } from "@/cli/frames";
import { frames } from "@/frames";
import { maxImageBytes, maxImagePixels, maxImageSide } from "@/frames/contract";
import { imageRoute } from "@/frames/images.server";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";

import { pngOf } from "./support/images";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

async function boot() {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const stop = new AbortController();
  const services = [access.login, access.user, access.owner, frames.api];
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({ services }),
      routes({ stop: stop.signal, table: { "GET /api/images/{canvas}/{sha}": imageRoute } }),
    ],
  }).ready;
  closers.push(() => (stop.abort(), server.close()));
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";
  const route = server.resolve(routes).fetch;
  const asked: string[] = [];
  const send = async (request: Request) => {
    asked.push(request.url);
    const answer = await route(request, server);
    if (!answer) throw new Error(`no route answers ${request.url}`);
    return answer;
  };

  return { server, clock, setupCode, send, asked };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function ann(srv: Srv, options: { json?: boolean; fetch?: typeof srv.send } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-images-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const scope = await createScope({
    clock: srv.clock,
    tags: [pictureFetch(options.fetch ?? srv.send)],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({
        peer: srv.server,
        headers: { "x-easel-peer": "198.51.100.1" },
        meta: cli.bearer,
      }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json: options.json ?? true,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const run = (command: FramesCommand) => scope.run(framesRun, { input: command });

  expect(
    await scope.run(cli.run, {
      input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
    }),
  ).toBe(0);
  expect(await run({ kind: "canvas new", name: "Flow" })).toBe(0);
  out.splice(0);
  err.splice(0);

  return {
    run,
    file: (name: string, bytes: Uint8Array | string) => {
      const path = join(dir, name);
      writeFileSync(path, bytes);
      return path;
    },
    at: (name: string) => join(dir, name),
    printed: () => [...out.splice(0), ...err.splice(0)].join(""),
    lines: () =>
      [...out.splice(0), ...err.splice(0)]
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

test("easel put shot.png makes an image frame at the size of the image, and get -o writes the PNG that easel keeps", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const shot = a.file("shot.png", await pngOf(390, 844));

  expect(await a.run({ kind: "put", canvas: "flow", file: shot, name: "Phone" })).toBe(0);
  const [made] = a.lines();
  expect(made).toMatchObject({ kind: "created", version: 1, findings: [] });

  expect(await a.run({ kind: "ls", canvas: "flow" })).toBe(0);
  expect(a.lines()).toMatchObject([{ frames: [{ id: made.id, name: "Phone", w: 390, h: 844 }] }]);

  const out = a.at("got.png");
  expect(await a.run({ kind: "get", canvas: "flow", id: made.id, out })).toBe(0);
  expect(a.lines()).toMatchObject([
    { kind: "found", frame: { id: made.id, image: { mimeType: "image/png" } }, file: out },
  ]);
  expect(await new Bun.Image(readFileSync(out)).metadata()).toEqual({
    width: 390,
    height: 844,
    format: "png",
  });
  expect(srv.asked).toEqual([expect.stringMatching(/^https:\/\/easel\.test\/api\/images\/flow\//)]);
});

test("easel put of an image on --id and --base writes a new version", async () => {
  const srv = await boot();
  const a = await ann(srv);
  await a.run({ kind: "put", canvas: "flow", file: a.file("one.png", await pngOf(30, 20)) });
  const [made] = a.lines();

  const two = a.file("two.jpg", await new Bun.Image(await pngOf(50, 40)).jpeg().bytes());
  expect(await a.run({ kind: "put", canvas: "flow", file: two, id: made.id, base: "1" })).toBe(0);
  expect(a.lines()).toMatchObject([{ kind: "updated", id: made.id, version: 2 }]);
});

test("easel get of an image frame with no -o prints its type, size and bytes, and fetches nothing", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });
  await a.run({ kind: "put", canvas: "flow", file: a.file("one.png", await pngOf(30, 20)) });
  const id = /[0-9a-f]{12}/.exec(a.printed())?.[0] ?? "";

  expect(await a.run({ kind: "get", canvas: "flow", id })).toBe(0);
  expect(a.printed()).toMatch(
    new RegExp(`^${id} v1: an image, image/png 30x20, \\d+ bytes; -o <file> writes it\\n$`),
  );
  expect(srv.asked).toEqual([]);
});

test("easel get -o of an image that cannot be fetched exits 69 and writes no file", async () => {
  const srv = await boot();
  const down = async () => new Response(null, { status: 503, headers: { "Retry-After": "0" } });
  const a = await ann(srv, { fetch: down });
  await a.run({ kind: "put", canvas: "flow", file: a.file("one.png", await pngOf(30, 20)) });
  const [made] = a.lines();

  const out = a.at("got.png");
  expect(await a.run({ kind: "get", canvas: "flow", id: made.id, out })).toBe(69);
  expect(a.lines()).toEqual([{ kind: "failed", status: 503 }]);
  expect(() => readFileSync(out)).toThrow();
});

test("easel put of an image with --size is bad usage, exits 64, and sends nothing", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const shot = a.file("shot.webp", await pngOf(30, 20));

  expect(await a.run({ kind: "put", canvas: "flow", file: shot, size: "390x844" })).toBe(64);
  expect(a.lines()[0]).toMatchObject({
    usage: "--size does not go with an image: the frame takes the size of the image",
  });
  await a.run({ kind: "ls", canvas: "flow" });
  expect(a.lines()).toEqual([{ kind: "found", frames: [] }]);
});

test("easel put of an image over 10 MiB exits 1 tooBig, and sends nothing", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });
  const big = a.file("big.png", new Uint8Array(maxImageBytes + 1));

  expect(await a.run({ kind: "put", canvas: "flow", file: big })).toBe(1);
  expect(a.printed()).toBe(
    `the image is too big: over ${maxImageBytes} bytes. Make it smaller, or take a part of it\n`,
  );
  await a.run({ kind: "ls", canvas: "flow" });
  expect(a.printed()).toMatch(/^no frame on flow yet/);
});

test("easel put of an SVG named .png exits 1 badImage and says that SVG is refused", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });
  const svg = a.file("fake.png", '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

  expect(await a.run({ kind: "put", canvas: "flow", file: svg })).toBe(1);
  expect(a.printed()).toBe(
    "badImage: nothing was written; its bytes are not the PNG, JPEG or WebP that its name says (SVG and other formats are refused)\n",
  );
});

test("easel put of an image over the pixel limit exits 1 badImage and names the limits", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });
  const wide = a.file("wide.png", await pngOf(maxImageSide + 1, 1));

  expect(await a.run({ kind: "put", canvas: "flow", file: wide })).toBe(1);
  expect(a.printed()).toBe(
    `badImage: nothing was written; it is over ${maxImageSide} px on a side, or over ${maxImagePixels} pixels\n`,
  );
});

test("easel put of bytes that do not decode exits 1 badImage unreadable", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const broken = a.file(
    "broken.png",
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  );

  expect(await a.run({ kind: "put", canvas: "flow", file: broken })).toBe(1);
  expect(a.lines()).toEqual([
    { kind: "badImage", reason: "unreadable", maxSide: maxImageSide, maxPixels: maxImagePixels },
  ]);
});
