import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { builtPlaces } from "@/kit/lint.server";

const root = new URL("..", import.meta.url).pathname;
const scopes: Array<{ close: () => Promise<unknown> }> = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.close();
});

test(
  "Oxlint with the easel plugin reports each built class at its line and column",
  {
    timeout: 60_000,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "easel-kit-lint-"));
    try {
      const frame = [
        "const a = (t: string) => <p className={`bg-${t}`} />;",
        'const b = (x: string) => <p className={cn("p-4", on && "flex", "text-" + x)} />;',
        'const tone = { info: "bg-info" };',
        'export const c = (k: "info") => <p className={clsx(tone[k], { hidden: !k })} />;',
      ].join("\n");
      await writeFile(join(dir, "frame.tsx"), frame);
      const plugin = join(root, "src/kit/lint.server.ts");
      const config = {
        jsPlugins: [{ name: "easel", specifier: plugin }],
        rules: { "easel/class-built": "error" },
      };
      await writeFile(join(dir, "oxlintrc.json"), JSON.stringify(config));

      const ran = Bun.spawnSync(
        [
          "bun",
          "--bun",
          join(root, "node_modules/.bin/oxlint"),
          "-c",
          "oxlintrc.json",
          "-f",
          "json",
          "frame.tsx",
        ],
        { cwd: dir, stdout: "pipe", stderr: "pipe" },
      );
      expect(ran.stderr.toString()).toBe("");
      const report: {
        diagnostics: Array<{
          code: string;
          labels: Array<{ span: { line: number; column: number } }>;
        }>;
      } = JSON.parse(ran.stdout.toString());
      const built = report.diagnostics
        .filter((d) => d.code === "easel(class-built)")
        .map((d) => `${d.labels[0]?.span.line}:${d.labels[0]?.span.column}`);

      expect(built).toEqual(["1:40", "2:64"]);
      expect(ran.exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("the rule reads a source with the walk of the check; one that does not parse has none", async () => {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  scopes.push(scope);

  expect(scope.run(builtPlaces, { input: "const d = <p className={a + b} />;" })).toEqual([
    { text: "a + b", at: 24 },
  ]);
  expect(scope.run(builtPlaces, { input: "const c = <p className={`p-4" })).toEqual([]);
});
