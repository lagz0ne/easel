import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";
import { z } from "zod";

import { liveArgs, liveEnvs } from "@/live/args";
import { liveScreens } from "@/live/run.server";
import { screens } from "@/live/screens";
import { waitDefaults } from "@/live/settings";

const root = join(import.meta.dirname, "..");
const folder = mkdtempSync(join(tmpdir(), "live-screens-"));
const binary = join(folder, "easel");
const support = join(import.meta.dirname, "support");
const kept = join(folder, "kept");
const fakeDir = join(folder, "state");

mkdirSync(kept);
mkdirSync(join(fakeDir, "frames"), { recursive: true });

writeFileSync(
  binary,
  `#!/bin/sh
case "$1" in
  serve|login|agree) exec "${process.execPath}" "${join(support, "fake-live-easel.ts")}" "$@" ;;
  *) exec "${process.execPath}" "${join(support, "fake-easel-cli.ts")}" "$@" ;;
esac
`,
);

chmodSync(binary, 0o755);

const dot = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const designFrames = screens.map((screen) => ({
  id: screen.design.id,
  name: screen.design.name,
  page: "designs",
  version: 1,
  w: 1,
  h: 1,
}));

for (const frame of designFrames) writeFileSync(join(fakeDir, "frames", frame.id), dot);

writeFileSync(
  join(fakeDir, "frames", "ds1"),
  "<style data-doop-tokens>:root{--primary:#2563eb;--font-sans:Inter;--text-sm:14px}</style>",
);

writeFileSync(
  join(fakeDir, "state.json"),
  JSON.stringify({
    n: 0,
    calls: [],
    pages: [],
    frames: [...designFrames, { id: "ds1", name: "Tokens", page: null, version: 1, w: 1, h: 1 }],
    sections: [],
  }),
);

const said: string[] = [];
const output = { write: (text: string) => said.push(text) };
const env = { ...process.env, FAKE_EASEL_DIR: fakeDir };
const config = { output, binary, writerEnv: env, fixtureEnv: env, kept, warn: true };

const scope = await createScope({
  capsules: [exits({ file: process.env.TINKER_EXITS }), liveScreens(config)],
}).ready;

const shortWaits = { ...waitDefaults, pins: 300 };

const strict = await createScope({
  capsules: [
    exits({ file: process.env.TINKER_EXITS }),
    liveScreens({
      ...config,
      writerEnv: { ...env, FAKE_EASEL_REFUSE: "ls" },
      pins: 9,
      waits: shortWaits,
    }),
  ],
}).ready;

afterAll(async () => {
  await scope.close();
  await strict.close();
  rmSync(folder, { recursive: true, force: true });
});

const fakeState = z.object({
  frames: z.array(z.object({ id: z.string(), name: z.string(), version: z.number() })),
});

const framesNow = () =>
  fakeState.parse(JSON.parse(readFileSync(join(fakeDir, "state.json"), "utf8"))).frames;

const linesOf = () => said.join("").split("\n").filter(Boolean);

const requests = screens[0];

const afterName = `${requests.design.name} · live · desktop light`;

test("the args: help, a wrong one, and a run with the writer and the fixture env", () => {
  const base = { root, env: {} };
  expect(liveArgs.parse({ ...base, args: ["--help"] })).toEqual({ kind: "help" });
  expect(liveArgs.parse({ ...base, args: ["--build", "0", "--commit", "abc"] })).toEqual({
    kind: "wrong",
  });
  expect(
    liveArgs.parse({ ...base, args: ["--build", "3", "--commit", "abc", "--screen", "nope"] }),
  ).toEqual({ kind: "wrong" });

  const ran = liveArgs.parse({
    root,
    args: ["--build", "3", "--commit", "abc", "--take", "phone dark", "--dry", "out"],
    env: { HOME: "/home/x", EASEL_TOKEN: "t", RUNNER_TEMP: "/r", GITHUB_ACTIONS: "true" },
  });
  expect(ran).toMatchObject({
    kind: "run",
    binary: join(root, "dist/server"),
    input: { build: 3, commit: "abc", dry: "out", take: "phone dark" },
    writerEnv: { EASEL_CONFIG_HOME: "/home/x/.config/easel-agent" },
    fixtureEnv: { HOME: "/home/x" },
    kept: "/r",
    warn: true,
  });

  const signedIn = liveEnvs.parse({ EASEL_TOKEN: "t", EASEL_SERVER: "s" });
  expect(signedIn.writerEnv).toEqual({ EASEL_TOKEN: "t", EASEL_SERVER: "s" });
  expect(signedIn.fixtureEnv).toEqual({});
  expect(signedIn.warn).toBe(false);
});

test("a first run puts each take as new, the designs and the status; a second run of the same build puts nothing", async () => {
  said.length = 0;
  const first = await scope.run(liveScreens.liveScreensRun, {
    input: { build: 7, commit: "abc" },
  });
  const made = linesOf();
  expect(made.filter((line) => line.includes(": failed"))).toEqual([]);
  expect(first).toMatchObject({ takes: 12, bad: 0 });
  expect(made).toContain("live-screens: requests desktop light: new");
  expect(made.some((line) => line.startsWith("live-screens: V6 "))).toBe(true);
  expect(made.some((line) => line.startsWith("::warning::"))).toBe(true);
  expect(made.at(-1)).toMatch(/^live-screens: build 7: 12 of 12 takes good, \d+ values .*: OK$/);

  const names = framesNow().map((frame) => frame.name);
  expect(names).toContain("Live · status");
  expect(names).toContain(`${requests.design.name} · design`);
  expect(names).toContain(afterName);

  said.length = 0;
  const versions = framesNow().map((frame) => frame.version);
  const second = await scope.run(liveScreens.liveScreensRun, {
    input: { build: 7, commit: "abc" },
  });
  expect(linesOf().filter((line) => /: (failed|differs)/.test(line))).toEqual([]);
  expect(second).toMatchObject({ takes: 12, bad: 0 });
  expect(linesOf()).toContain("live-screens: requests desktop light: same");
  expect(linesOf().filter((line) => line.endsWith(": new"))).toEqual([]);
  const status = framesNow().findIndex((frame) => frame.name === "Live · status");
  expect(framesNow().map((frame, at) => (at === status ? 0 : frame.version))).toEqual(
    versions.map((version, at) => (at === status ? 0 : version)),
  );
}, 240_000);

test("other pixels on the same build say differs and keep both; a newer build moves the After to the Before", async () => {
  const after = framesNow().find((frame) => frame.name === afterName);
  writeFileSync(join(fakeDir, "frames", after?.id ?? ""), dot);

  said.length = 0;
  const only = { screen: "requests", take: "desktop light" };
  const differs = await scope.run(liveScreens.liveScreensRun, {
    input: { build: 7, commit: "abc", ...only },
  });
  expect(differs).toMatchObject({ takes: 1, bad: 1 });
  expect(linesOf()).toContain(
    "live-screens: requests desktop light: differs: a take of the same build has other pixels",
  );
  expect(existsSync(join(kept, "easel-live-requests-desktop-light-after.png"))).toBe(true);

  said.length = 0;
  const next = await scope.run(liveScreens.liveScreensRun, {
    input: { build: 8, commit: "def", ...only },
  });
  expect(next).toMatchObject({ takes: 1, bad: 0 });
  expect(linesOf()).toContain("live-screens: requests desktop light: next");
  const names = framesNow().map((frame) => frame.name);
  expect(names).toContain(`${requests.design.name} · before · desktop light`);
}, 240_000);

test("a dry run writes the takes and the status and puts nothing; a take that does not come says failed, and a look that easel refuses is not read", async () => {
  const dry = join(folder, "dry");
  const before = framesNow();
  said.length = 0;

  const ran = await scope.run(liveScreens.liveScreensRun, {
    input: { build: 9, commit: "abc", dry, screen: "accepted" },
  });
  expect(ran).toMatchObject({ takes: 4, bad: 0 });
  const files = readdirSync(dry);
  expect(files).toContain("status.html");
  expect(files).toContain("accepted-phone-dark.png");
  expect(framesNow()).toEqual(before);

  said.length = 0;
  const failed = await strict.run(liveScreens.liveScreensRun, {
    input: { build: 9, commit: "abc", dry, screen: "requests", take: "phone light" },
  });
  expect(failed).toMatchObject({ takes: 1, bad: 1 });
  expect(
    linesOf().some((line) => line.startsWith("live-screens: requests phone light: failed: ")),
  ).toBe(true);
  expect(existsSync(join(kept, "easel-live-requests-phone-light.png"))).toBe(true);
  expect(linesOf()).toContain(
    "live-screens: the look of design-system was not read: no check of the values",
  );
}, 240_000);
