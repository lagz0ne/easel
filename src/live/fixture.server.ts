import { readFileSync } from "node:fs";
import { join } from "node:path";

import { operation } from "@tinkered/core";
import type { Subprocess } from "bun";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";

import {
  fixtureAnswers,
  fixtureAsks,
  fixtureEnv,
  fixtureFrames,
  fixtureName,
  keptDir,
  liveBinary,
  liveWaits,
  reopenNote,
  setupViewport,
  viewerName,
} from "./settings";

export type Fixture = {
  server: Subprocess;
  link: string;
  state: Awaited<ReturnType<BrowserContext["storageState"]>>;
};

const tab = z.custom<Page>();

const signedIn = z.object({ url: z.string(), token: z.string(), home: z.string() });

const toolAnswer = z.object({
  result: z.object({ isError: z.boolean().optional(), structuredContent: z.unknown() }).optional(),
  error: z.unknown().optional(),
});

export const fixtureTool = operation({
  label: "liveScreens.fixtureTool",
  input: z.object({
    at: signedIn,
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  run: async (_, { input: { at, name, args } }) => {
    const response = await fetch(`${at.url}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${at.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const body = toolAnswer.parse(await response.json());
    if (!body.result || body.result.isError) {
      throw new Error(`live-screens: ${name} failed: ${JSON.stringify(body)}`);
    }
    return body.result.structuredContent;
  },
});

export const fixtureUp = operation({
  label: "liveScreens.fixtureUp",
  input: z.object({ url: z.string(), log: z.string() }),
  depends: { waits: liveWaits },
  run: async ({ waits }, { input: { url, log }, clock }) => {
    const until = clock.currentTimeMillis() + waits.start;
    while (clock.currentTimeMillis() < until) {
      const ok = await fetch(`${url}/api/health`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) return;

      await clock.sleep(100);
    }
    throw new Error(`live-screens: the fixture server did not start (log: ${log})`);
  },
});

export const fixtureLogin = operation({
  label: "liveScreens.fixtureLogin",
  input: z.object({ url: z.string(), log: z.string(), home: z.string() }),
  depends: { binary: liveBinary, env: fixtureEnv },
  run: async ({ binary, env }, { input: { url, log, home } }) => {
    const code = /setup code: (\S+)/.exec(readFileSync(log, "utf8"))?.[1];
    if (!code) throw new Error(`live-screens: no setup code (log: ${log})`);

    const login = Bun.spawnSync([binary, "login", url, "--name", "claude-1", "--setup", code], {
      env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    });
    const hosts =
      login.exitCode === 0 ? readFileSync(join(home, ".config/easel/hosts.json"), "utf8") : "";
    const token = /"token":\s*"([^"]+)"/.exec(hosts)?.[1];
    if (!token) {
      throw new Error(`live-screens: easel login --setup failed: ${login.stderr.toString()}`);
    }
    return token;
  },
});

export const fixtureAgree = operation({
  label: "liveScreens.fixtureAgree",
  input: z.object({ home: z.string(), key: z.string(), n: z.number() }),
  depends: { binary: liveBinary, env: fixtureEnv },
  run: async ({ binary, env }, { input: { home, key, n } }) => {
    const done = Bun.spawnSync([binary, "agree", key, String(n)], {
      env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    });
    if (done.exitCode !== 0) {
      const said = `${done.stdout.toString()}${done.stderr.toString()}`;
      throw new Error(`live-screens: easel agree ${n} failed: ${said}`);
    }
  },
});

export const fixtureAnswer = operation({
  label: "liveScreens.fixtureAnswer",
  input: z.object({ at: signedIn, key: z.string(), n: z.number(), text: z.string() }),
  depends: { fixtureTool },
  run: async ({ fixtureTool }, { input: { at, key, n, text } }) => {
    const next = await fixtureTool.run({
      input: { at, name: "next_request", args: { canvas: key, n } },
    });
    const { claim } = z.object({ claim: z.string() }).parse(next);
    await fixtureTool.run({ input: { at, name: "resolve_request", args: { claim, text } } });
  },
});

export const markedOpen = operation({
  label: "liveScreens.markedOpen",
  input: tab,
  depends: { waits: liveWaits },
  run: async ({ waits }, { input: page }) => {
    await page.waitForFunction(
      () => performance.getEntriesByName("easel:open", "mark").length > 0,
      undefined,
      { timeout: waits.open },
    );
  },
});

export const fixtureAsk = operation({
  label: "liveScreens.fixtureAsk",
  input: z.object({
    page: tab,
    n: z.number(),
    frame: z.string(),
    text: z.string(),
    spot: z.object({ x: z.number(), y: z.number() }),
  }),
  depends: { markedOpen, viewer: viewerName, waits: liveWaits },
  run: async (deps, { input: { page, n, frame, text, spot } }) => {
    await page.getByRole("button", { name: "Request", exact: true }).click();
    const shell = page.getByRole("group", { name: frame, exact: true });
    const box = await shell.boundingBox();
    if (!box) throw new Error(`live-screens: the frame ${frame} does not show`);

    await shell.click({ position: { x: box.width * spot.x, y: box.height * spot.y } });
    await page.getByRole("textbox", { name: "Request" }).fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const named = page.getByRole("textbox", { name: "Your name" });
    const pin = page.locator(`button.e-pin[aria-label="Request #${n}"]`);
    await named.or(pin).first().waitFor({ timeout: deps.waits.pin });
    if (await named.isVisible()) {
      await named.fill(deps.viewer);
      await page.getByRole("button", { name: "Send", exact: true }).click();
    }

    await pin.waitFor({ state: "attached", timeout: deps.waits.pin });
    await page.reload();
    await deps.markedOpen.run({ input: page });
    await pin.waitFor({ state: "attached", timeout: deps.waits.pin });
  },
});

export const openList = operation({
  label: "liveScreens.openList",
  input: tab,
  depends: { waits: liveWaits },
  run: async ({ waits }, { input: page }) => {
    const list = page.getByRole("heading", { name: "Requests", level: 2 });
    for (let i = 0; i < waits.tries; i++) {
      if (await list.isVisible().catch(() => false)) return;

      await page.getByRole("button", { name: /^Requests/ }).click();
      await list.waitFor({ timeout: waits.list }).catch(() => undefined);
    }
    await list.waitFor({ timeout: 1_000 });
  },
});

export const openLinked = operation({
  label: "liveScreens.openLinked",
  input: z.object({ page: tab, n: z.number() }),
  run: async (_, { input: { page, n } }) => {
    await page.getByRole("region", { name: `Request #${n}` }).waitFor();
  },
});

export const openRequest = operation({
  label: "liveScreens.openRequest",
  input: z.object({ page: tab, n: z.number() }),
  depends: { openList },
  run: async ({ openList }, { input: { page, n } }) => {
    await openList.run({ input: page });
    await page.getByRole("button", { name: new RegExp(`#${n} `) }).click();
    await page.getByRole("region", { name: `Request #${n}` }).waitFor();
  },
});

export const fixtureAccept = operation({
  label: "liveScreens.fixtureAccept",
  input: z.object({ page: tab, n: z.number() }),
  depends: { openRequest, waits: liveWaits },
  run: async ({ openRequest, waits }, { input: { page, n } }) => {
    await openRequest.run({ input: { page, n } });
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await page
      .getByRole("region", { name: `Request #${n}` })
      .getByText("accepted the result")
      .waitFor({ timeout: waits.pin });
  },
});

export const noteSent = operation({
  label: "liveScreens.noteSent",
  input: z.object({ page: tab, note: z.string() }),
  run: async (_, { input: { page, note } }) => {
    const card = page.getByRole("region", { name: "Request #2" });
    const reopened = await card.getByText("opened it again").count();
    const messages = await card.getByText(note, { exact: true }).count();
    return reopened > 0 && messages > 0;
  },
});

export const sendNote = operation({
  label: "liveScreens.sendNote",
  input: z.object({ page: tab, note: z.string() }),
  depends: { waits: liveWaits },
  run: ({ waits }, { input: { page, note } }) => {
    const field = page.getByRole("textbox", { name: "Note" });
    const timeout = waits.step;
    return field
      .isVisible()
      .then((shown) =>
        shown
          ? undefined
          : page.getByRole("button", { name: "Open again", exact: true }).click({ timeout }),
      )
      .then(() => field.fill(note, { timeout }))
      .then(() => page.getByRole("button", { name: "Send", exact: true }).click({ timeout }))
      .then(
        () => true,
        () => false,
      );
  },
});

export const openAgain = operation({
  label: "liveScreens.openAgain",
  input: tab,
  depends: { noteSent, sendNote, note: reopenNote, waits: liveWaits },
  run: async (deps, { input: page }) => {
    const { note, waits } = deps;
    for (let i = 0; i < waits.tries; i++) {
      if (await deps.noteSent.run({ input: { page, note } })) return;

      await deps.sendNote.run({ input: { page, note } });
      await page.waitForTimeout(waits.retry);
    }

    const sent = await deps.noteSent.run({ input: { page, note } });
    if (!sent) throw new Error("live-screens: the note of #2 was not sent");
  },
});

export const playFixture = operation({
  label: "liveScreens.playFixture",
  input: z.object({ page: tab, at: signedIn, key: z.string() }),
  depends: {
    fixtureAsk,
    fixtureAgree,
    fixtureAnswer,
    fixtureAccept,
    openAgain,
    asks: fixtureAsks,
    answers: fixtureAnswers,
  },
  run: async (deps, { input: { page, at, key } }) => {
    for (const ask of deps.asks) await deps.fixtureAsk.run({ input: { page, ...ask } });

    for (const ask of deps.asks) {
      await deps.fixtureAgree.run({ input: { home: at.home, key, n: ask.n } });
    }

    for (const { n, text } of deps.answers) {
      await deps.fixtureAnswer.run({ input: { at, key, n, text } });
    }

    for (const { n } of deps.answers) await deps.fixtureAccept.run({ input: { page, n } });

    await deps.openAgain.run({ input: page });
  },
});

export const seedFixture = operation({
  label: "liveScreens.seedFixture",
  input: signedIn,
  depends: { fixtureTool, name: fixtureName, frames: fixtureFrames },
  run: async ({ fixtureTool, name, frames }, { input: at }) => {
    const made = await fixtureTool.run({ input: { at, name: "create_canvas", args: { name } } });
    const { key } = z.object({ key: z.string() }).parse(made);
    for (const frame of frames) {
      await fixtureTool.run({ input: { at, name: "put_frame", args: { canvas: key, ...frame } } });
    }

    const shared = await fixtureTool.run({
      input: { at, name: "share_canvas", args: { canvas: key } },
    });
    const { path } = z.object({ path: z.string() }).parse(shared);
    return { key, link: `${at.url}${path}` };
  },
});

export const readyFixture = operation({
  label: "liveScreens.readyFixture",
  input: z.object({ browser: z.custom<Browser>(), work: z.string(), url: z.string() }),
  depends: {
    fixtureUp,
    fixtureLogin,
    seedFixture,
    markedOpen,
    playFixture,
    viewport: setupViewport,
    kept: keptDir,
  },
  run: async (deps, { input: { browser, work, url } }) => {
    const log = join(work, "server.log");
    await deps.fixtureUp.run({ input: { url, log } });
    const home = join(work, "home");
    const token = await deps.fixtureLogin.run({ input: { url, log, home } });
    const at = { url, token, home };
    const { key, link } = await deps.seedFixture.run({ input: at });

    const setup = await browser.newContext({ viewport: deps.viewport });
    const page = await setup.newPage();
    await page.goto(link);
    await deps.markedOpen.run({ input: page });
    await deps.playFixture.run({ input: { page, at, key } }).catch(async (error: unknown) => {
      const kept = join(deps.kept, "easel-live-fixture.png");
      await page.screenshot({ path: kept });
      throw new Error(`live-screens: the fixture failed (a picture is in ${kept})`, {
        cause: error,
      });
    });

    const state = await setup.storageState();
    await setup.close();
    return { link, state };
  },
});

export const startFixture = operation({
  label: "liveScreens.startFixture",
  input: z.object({
    browser: z.custom<Browser>(),
    work: z.string(),
    build: z.number(),
    chromium: z.string(),
  }),
  depends: { readyFixture, binary: liveBinary, env: fixtureEnv },
  run: async (deps, { input: { browser, work, build, chromium } }): Promise<Fixture> => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port;
    await probe.stop(true);

    const url = `http://127.0.0.1:${port}`;
    const log = join(work, "server.log");
    const server = Bun.spawn([deps.binary, "serve"], {
      env: {
        ...deps.env,
        BUILD: String(build),
        PORT: String(port),
        PUBLIC_ORIGIN: url,
        NODE_ENV: "production",
        EASEL_DB: join(work, "easel.db"),
        EASEL_CHROMIUM: chromium,
        OTEL_SERVICE_NAME: "easel-live-screens",
      },
      stdout: Bun.file(log),
      stderr: Bun.file(log),
    });

    const ready = await deps.readyFixture
      .run({ input: { browser, work, url } })
      .catch(async (error: unknown) => {
        server.kill();
        await server.exited;
        throw error;
      });
    return { server, ...ready };
  },
});

export const stopFixture = operation({
  label: "liveScreens.stopFixture",
  input: z.custom<Subprocess>(),
  run: async (_, { input: server }) => {
    server.kill();
    await server.exited;
  },
});
