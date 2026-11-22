import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { testKit } from "./kit/fixture";

// The kit in the compiled binary: Tailwind and the native build of Lightning CSS
// (src/kit/lightningcss.server.ts) go into a binary that `bun build --compile` makes with the
// flags of `build:server`. The binary runs from an empty folder, so it reads nothing from
// node_modules: it makes CSS, and the Lightning CSS check finds a color in a style attribute.

const root = new URL("..", import.meta.url).pathname;

test("a compiled binary makes the CSS of a frame and checks it", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "easel-kit-binary-"));
  const empty = await mkdtemp(join(dir, "run-"));

  try {
    const build = Bun.spawnSync(
      [
        "bun",
        "build",
        "tests/kit/binary-probe.ts",
        "--compile",
        "--bytecode",
        "--format=esm",
        "--minify",
        "--define",
        `process.env.NODE_ENV="production"`,
        "--outfile",
        join(dir, "probe"),
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    expect(build.stderr.toString()).not.toContain("error");
    expect(build.exitCode).toBe(0);

    const html = `<p class="p-4 text-red-500" style="color:#f00">a</p>`;
    const run = Bun.spawnSync([join(dir, "probe")], {
      cwd: empty,
      stdin: new TextEncoder().encode(JSON.stringify({ html, kit: await testKit() })),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);

    const made = JSON.parse(run.stdout.toString());
    expect(made.kind).toBe("made");
    expect(made.css).toContain(".p-4");
    expect(made.css).not.toContain("red-500");
    expect(made.findings.map((f: { line: number; col: number }) => `${f.line}:${f.col}`)).toEqual([
      "1:15",
      "1:36",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
