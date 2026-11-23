import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { afterEach, expect, test } from "vite-plus/test";

import { make, makeFrame } from "@/kit/make.server";
import { sources } from "@/kit/source.server";

import { frame, testKit } from "./kit/fixture";

const root = new URL("..", import.meta.url);
const scopes: Array<{ close: () => Promise<unknown> }> = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.close();
});

async function open() {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  scopes.push(scope);
  return scope;
}

async function cssOf(scope: Awaited<ReturnType<typeof open>>, html: string) {
  const got = await scope.run(makeFrame, { input: { html, kit: await testKit() } });
  if (got.kind !== "made") throw new Error(`not made: ${got.kind}`);
  return got.css;
}

const a = `<p class="p-4 text-primary">a</p>`;
const b = `<p class="mt-8 bg-muted rounded-md">b</p>`;

test("the same frames made in two orders give the same bytes for each frame", async () => {
  const one = await open();
  const first = [await cssOf(one, a), await cssOf(one, b), await cssOf(one, await frame("list"))];
  const two = await open();
  const list = await cssOf(two, await frame("list"));
  const second = [await cssOf(two, b), await cssOf(two, a)];

  expect(list).toBe(first[2]);
  expect(second[0]).toBe(first[1]);
  expect(second[1]).toBe(first[0]);
  expect(first[1]).toContain(".mt-8");
  expect(first[1]).not.toContain(".p-4");
  expect(second[1]).not.toContain(".mt-8");
});

test("a frame gets only the layer utilities, with look values as var(), and no look value defined", async () => {
  const scope = await open();
  const css = await cssOf(
    scope,
    `<p class="p-4 bg-primary/50 text-sm font-bold md:flex btn">x</p>`,
  );

  expect(css).toContain("@layer utilities");
  expect(css).toContain("padding: calc(var(--spacing) * 4)");
  expect(css).toContain("var(--primary)");
  expect(css).toContain("font-size: var(--text-sm)");
  expect(css).toContain("font-weight: 700");
  expect(css).not.toMatch(/--primary:/);
  expect(css).not.toContain(".btn");
  expect(css).not.toContain("@layer base");
  expect(css).not.toContain("@layer components");
});

test("the classes that the check finds are not made", async () => {
  const scope = await open();
  const got = await scope.run(makeFrame, {
    input: {
      html: `<p class="p-[13px] bg-[#f00] text-red-500 text-[23px] bgg-primary">x</p>`,
      kit: await testKit(),
    },
  });
  if (got.kind !== "made") throw new Error(`not made: ${got.kind}`);

  expect(got.findings.map((f) => f.rule)).toEqual([
    "look/color",
    "look/color",
    "look/size",
    "kit/class",
  ]);
  expect(got.css).toContain("padding: 13px");
  for (const out of ["#f00", "red-500", "23px", "bgg"]) expect(got.css).not.toContain(out);
});

test("a frame with the kit off gets no CSS", async () => {
  const scope = await open();
  const got = await scope.run(makeFrame, {
    input: {
      html: `<meta name="easel-kit" content="off"><p class="p-4">x</p>`,
      kit: await testKit(),
    },
  });
  expect(got).toEqual({ kind: "off" });
});

test("make gives the same bytes in two runs and in a new process", async () => {
  const scope = await open();
  const source = scope.run(sources, { input: await testKit() }).frame;
  const classNames = ["p-4", "text-primary", "md:grid-cols-2", "hover:bg-muted"];
  const here = await scope.run(make, { input: { source, classNames } });
  const again = await scope.run(make, { input: { source, classNames: [...classNames].reverse() } });

  const child = Bun.spawn(["bun", "tests/kit/make-once.ts"], {
    cwd: root.pathname,
    stdin: new TextEncoder().encode(JSON.stringify({ source, classNames })),
    stdout: "pipe",
    stderr: "inherit",
  });
  const there = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);

  expect(again).toBe(here);
  expect(there).toBe(here);
  expect(here).toContain(".md\\:grid-cols-2");
});

test("the pin: Tailwind is 4.3.5 and its design system still answers the check", async () => {
  const pkg = await Bun.file(new URL("package.json", root)).json();
  const installed = await Bun.file(new URL("node_modules/tailwindcss/package.json", root)).json();
  expect(pkg.dependencies.tailwindcss).toBe("4.3.5");
  expect(installed.version).toBe("4.3.5");

  const scope = await open();
  const source = scope.run(sources, { input: await testKit() }).kit;
  const system = await __unstable__loadDesignSystem(source);
  expect(typeof system.parseCandidate).toBe("function");
  expect(typeof system.candidatesToCss).toBe("function");

  expect(system.candidatesToCss(["bg-primary", "text-red-500", "btn", "text-7xl"])).toEqual([
    ".bg-primary {\n  background-color: var(--primary);\n}\n",
    null,
    null,
    ".text-7xl {\n  font-size: var(--text-7xl);\n}\n",
  ]);
  expect(system.candidatesToCss(["text-[23px]", "[color:red]"])).toEqual([
    ".text-\\[23px\\] {\n  font-size: 23px;\n}\n",
    ".\\[color\\:red\\] {\n  color: red;\n}\n",
  ]);
  expect(system.parseCandidate("hover:bg-[#f00]/50")).toMatchObject([
    {
      kind: "functional",
      root: "bg",
      value: { kind: "arbitrary", value: "#f00" },
      modifier: { kind: "named", value: "50" },
      variants: [{ kind: "static", root: "hover" }],
    },
  ]);
  expect(system.parseCandidate("[color:red]")).toMatchObject([
    { kind: "arbitrary", property: "color", value: "red" },
  ]);
});

test("the pin: Lightning CSS and its native builds for the 3 release targets are one version", async () => {
  const pkg = await Bun.file(new URL("package.json", root)).json();
  for (const name of [
    "lightningcss",
    "lightningcss-darwin-arm64",
    "lightningcss-linux-arm64-gnu",
    "lightningcss-linux-x64-gnu",
  ]) {
    expect({ name, version: pkg.dependencies[name] }).toEqual({ name, version: "1.33.0" });
  }
});

test("speed: a usual frame is checked and made well under the budget of 50 ms", async () => {
  const scope = await open();
  const kit = await testKit();
  const html = await frame("dashboard");
  await cssOf(scope, html);

  const times: number[] = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    await scope.run(makeFrame, { input: { html, kit } });
    times.push(performance.now() - start);
  }
  times.sort((x, y) => x - y);
  const p50 = times[7] ?? Infinity;
  expect(p50).toBeLessThan(25);
});

test("speed: a frame of 1 MiB is checked and made in the budget, with room for a loaded host", async () => {
  const scope = await open();
  const kit = await testKit();
  const one = await frame("dashboard");
  const html = one.repeat(Math.ceil((1024 * 1024) / one.length));
  await cssOf(scope, one);

  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await scope.run(makeFrame, { input: { html, kit } });
    times.push(performance.now() - start);
  }
  times.sort((x, y) => x - y);
  expect(times[1] ?? Infinity).toBeLessThan(200);
});
