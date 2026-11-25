import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { buildRuntime } from "@/kit/runtime.server";

import { testKit } from "./kit/fixture";

const root = new URL("..", import.meta.url).pathname;

test(
  "a compiled binary makes the CSS of a frame and of an app frame, and checks both",
  {
    timeout: 120_000,
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "easel-kit-binary-"));
    const empty = await mkdtemp(join(dir, "run-"));
    const kit = await testKit();
    const run = (input: object) => {
      const ran = Bun.spawnSync([join(dir, "probe")], {
        cwd: empty,
        stdin: new TextEncoder().encode(JSON.stringify(input)),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(ran.stderr.toString()).toBe("");
      expect(ran.exitCode).toBe(0);
      return JSON.parse(ran.stdout.toString());
    };
    const places = (made: { findings: Array<{ line: number; col: number }> }) =>
      made.findings.map((f) => `${f.line}:${f.col}`);

    try {
      const build = Bun.spawnSync(
        [
          "bun",
          "cmds/build-binary.ts",
          "--entry",
          "tests/kit/binary-probe.ts",
          "--outfile",
          join(dir, "probe"),
        ],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
      );
      expect(build.stderr.toString()).not.toContain("error");
      expect(build.exitCode).toBe(0);

      const html = run({ html: `<p class="p-4 text-red-500" style="color:#f00">a</p>`, kit });
      expect(html.kind).toBe("made");
      expect(html.css).toContain(".p-4");
      expect(html.css).not.toContain("red-500");
      expect(places(html)).toEqual(["1:15", "1:36"]);

      const tsx = run({
        tsx: 'export function View() {\n  return <p className={cn("p-4", `bg-${x}`, "text-red-500")} />;\n}',
        kit,
      });
      expect(tsx.kind).toBe("made");
      expect(tsx.css).toContain(".p-4");
      expect(tsx.css).toContain("var(--destructive)");
      expect(places(tsx)).toEqual(["2:34", "2:46"]);
      expect(tsx.fixed["index.tsx"]).toContain('"text-destructive"');
      expect(tsx.js).toContain('from"react/jsx-runtime"');
      expect(tsx.js).toContain('"text-destructive"');
      expect(tsx.js).toContain('import{mount}from"@easel/frame"');

      const scope = createScope();
      const built = await scope.run(buildRuntime);
      await scope.close();
      expect(run({ runtime: true })).toEqual({
        sha: built.sha,
        files: Object.keys(built.files).length,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
