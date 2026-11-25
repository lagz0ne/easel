import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";

import { embedClient, generateMigrations } from "@/build/files.server";
import { serverLeaks, testLeaks } from "@/build/leaks.server";

const folder = mkdtempSync(join(tmpdir(), "build-checks-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;

let made = 0;

const metafile = async (meta: unknown) => {
  made += 1;
  const path = join(folder, `meta-${made}.json`);
  await Bun.write(path, JSON.stringify(meta));
  return path;
};

test("a prod build with a testing module is a leak, and a build without one is clean", async () => {
  const clean = await metafile({ inputs: { "src/todo/index.ts": {} } });
  const leaky = await metafile({ inputs: { "src/todo/todo.testing.ts": {} } });

  expect(await scope.run(testLeaks, { input: [clean, leaky] })).toEqual({
    kind: "leaks",
    lines: [`test code in ${leaky}: src/todo/todo.testing.ts`],
  });
  expect(await scope.run(testLeaks, { input: [clean] })).toEqual({
    kind: "clean",
    text: `prod builds clean: no test code in ${clean}`,
  });
});

test("a page build that takes a server module or a node builtin is a leak; the other inputs of the build do not count", async () => {
  const leaky = await metafile({
    inputs: {
      "cmds/browser.tsx": { imports: [{ path: "node:fs" }] },
      "src/queue/store.server.ts": {},
      "cmds/server.ts": {},
    },
    outputs: {
      "index.js": {
        entryPoint: "cmds/index.html",
        inputs: { "cmds/browser.tsx": {}, "src/queue/store.server.ts": {} },
      },
    },
  });
  const clean = await metafile({ inputs: { "cmds/browser.tsx": {}, "tinker/base/main.ts": {} } });

  expect(await scope.run(serverLeaks, { input: leaky })).toEqual({
    kind: "leaks",
    lines: [
      "server code in client: src/queue/store.server.ts",
      "server code in client: cmds/browser.tsx -> node:fs",
    ],
  });
  expect(await scope.run(serverLeaks, { input: clean })).toEqual({
    kind: "clean",
    text: "client build clean: 2 modules, none from the server side",
  });
});

test("migrations: a folder with no drizzle config generates nothing, and a config that drizzle-kit cannot read fails with its name", async () => {
  const empty = join(folder, "empty");
  mkdirSync(empty);
  expect(scope.run(generateMigrations, { input: empty })).toEqual({
    kind: "generated",
    configs: 0,
  });

  const broken = join(folder, "broken");
  mkdirSync(broken);
  await Bun.write(join(broken, "drizzle.config.ts"), "throw new Error('no config');\n");
  expect(scope.run(generateMigrations, { input: broken })).toMatchObject({
    kind: "failed",
    config: "drizzle.config.ts",
  });
}, 60_000);

test("embed writes one file import for each built client file, and an empty table before a build", async () => {
  const client = join(folder, "client");
  const outFile = join(folder, "client-files.gen.ts");
  const input = { clientDir: client, outFile, importDir: "../dist/client" };

  expect(await scope.run(embedClient, { input })).toBe(0);
  expect(readFileSync(outFile, "utf8")).toContain("export default {} as unknown");

  await Bun.write(join(client, "index.html"), "<html></html>");
  await Bun.write(join(client, "assets/app.js"), "");
  expect(await scope.run(embedClient, { input })).toBe(2);
  const text = readFileSync(outFile, "utf8");
  expect(text).toContain(`import f0 from "../dist/client/assets/app.js" with { type: "file" };`);
  expect(text).toContain(`  "/index.html": f1,`);
});
