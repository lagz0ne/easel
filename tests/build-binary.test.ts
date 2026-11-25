import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";

import { bindingOf, compileBinary, oxcBindings, oxcVisitor } from "@/build/binary.server";

const folder = mkdtempSync(join(tmpdir(), "build-binary-"));
const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;

afterAll(async () => {
  rmSync(folder, { recursive: true, force: true });
  await scope.close();
});

test("the oxc-parser binding comes from the bun target, else from the host; an unknown one is refused", () => {
  expect(scope.run(bindingOf, { input: { target: "bun-linux-arm64", host: "linux-x64" } })).toEqual(
    { kind: "binding", target: "bun-linux-arm64", binding: "linux-arm64-gnu" },
  );
  expect(scope.run(bindingOf, { input: { host: "linux-x64" } })).toEqual({
    kind: "binding",
    target: undefined,
    binding: "linux-x64-gnu",
  });
  expect(scope.run(bindingOf, { input: { target: "bun-windows-x64", host: "linux-x64" } })).toEqual(
    { kind: "unknown" },
  );
});

test("the plugin steps refuse a loader of oxc-parser that changed, so the build stops", () => {
  expect(() =>
    scope.run(oxcBindings, { input: { original: "export const parse = 1;", binding: "x" } }),
  ).toThrow("oxc-parser's loader exports parse: update the plugin");
  expect(() => scope.run(oxcVisitor, { input: "export const walk = 1;" })).toThrow(
    "oxc-parser's Visitor loads its walk in a new way",
  );
});

test("the plugin steps load the binding of the target and the walk of the Visitor without a require at run time", async () => {
  const loader = join(import.meta.dirname, "../node_modules/oxc-parser/src-js");
  const bindings = scope.run(oxcBindings, {
    input: {
      original: await Bun.file(join(loader, "bindings.js")).text(),
      binding: "linux-x64-gnu",
    },
  });
  expect(bindings).toContain(
    'require("@oxc-parser/binding-linux-x64-gnu/parser.linux-x64-gnu.node")',
  );

  const visitor = scope.run(oxcVisitor, {
    input: await Bun.file(join(loader, "visit/index.js")).text(),
  });
  expect(visitor).toContain("walkProgram: staticWalk");
  expect(visitor).not.toContain("createRequire(import.meta.url)");
});

test("a binary of a broken entry fails with the logs of Bun, and a good entry builds", async () => {
  const broken = join(folder, "broken.ts");
  await Bun.write(broken, "export const = ;\n");
  const failed = await scope.run(compileBinary, {
    input: {
      entries: [broken],
      outfile: join(folder, "broken"),
      binding: "linux-x64-gnu",
      sourcemap: false,
    },
  });
  expect(failed.kind).toBe("failed");
  expect(failed.logs.join("\n")).not.toBe("");

  const good = join(folder, "good.ts");
  await Bun.write(good, 'console.log("hi");\n');
  const metafile = join(folder, "meta.json");
  const built = await scope.run(compileBinary, {
    input: {
      entries: [good],
      outfile: join(folder, "good"),
      binding: "linux-x64-gnu",
      sourcemap: false,
      metafile,
    },
  });
  expect(built).toMatchObject({ kind: "built" });
  expect(Bun.spawnSync([join(folder, "good")]).stdout.toString()).toBe("hi\n");
  expect(await Bun.file(metafile).exists()).toBe(true);
}, 120_000);
