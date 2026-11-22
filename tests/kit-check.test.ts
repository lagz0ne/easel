import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { check } from "@/kit/check.server";

import { bad, frame, testKit } from "./kit/fixture";

// K5 (SPEC-kit.md § Rules, judged rule 12): the check finds what is not in the look or the kit,
// at its line and column, with the fix. It finds nothing in a frame made only from the kit.

const scopes: Array<{ close: () => Promise<unknown> }> = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.close();
});

async function open() {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  scopes.push(scope);
  return scope;
}

test("k5-bad gives each planted finding at its line and column, in document order", async () => {
  const scope = await open();
  const got = await scope.run(check, { input: { html: await bad(), kit: await testKit() } });
  if (got.kind !== "checked") throw new Error(`not checked: ${got.kind}`);

  expect(got.findings.map((f) => `${f.line}:${f.col} ${f.rule}`)).toEqual([
    "3:37 look/color",
    "4:13 look/color",
    "7:15 look/color",
    "8:15 kit/class",
    "8:42 kit/class",
    "9:16 look/color",
    "9:59 look/size",
    "10:13 look/color",
    "12:52 look/color",
    "13:3 kit/piece",
    "16:3 look/color",
    "18:3 look/override",
    "22:43 kit/script",
  ]);

  const fix = (line: number, col: number) =>
    got.findings.find((f) => f.line === line && f.col === col)?.fix;
  expect(fix(3, 37)).toBe("use text-destructive");
  expect(fix(4, 13)).toBe("use bg-destructive");
  expect(fix(7, 15)).toBe("use [color:var(--destructive)]");
  expect(fix(8, 15)).toBe("use font-semibold");
  expect(fix(8, 42)).toBe("use bg-primary");
  expect(fix(9, 16)).toBe("use shadow-destructive");
  expect(fix(9, 59)).toBe("use text-2xl");
  expect(fix(12, 52)).toBe("use var(--primary)");
  expect(fix(16, 3)).toMatch(/^use var\(--/);
  for (const f of got.findings) {
    expect(f.what.length).toBeGreaterThan(0);
    expect(f.fix.length).toBeGreaterThan(0);
  }
});

test("each name that the check finds is out of the classes to make; the allowed ones stay", async () => {
  const scope = await open();
  const got = await scope.run(check, { input: { html: await bad(), kit: await testKit() } });
  if (got.kind !== "checked") throw new Error(`not checked: ${got.kind}`);

  for (const out of ["text-red-500", "bg-[#f00]", "[color:red]", "font-semibld", "bgg-primary"]) {
    expect(got.classes).not.toContain(out);
  }
  for (const out of ["shadow-[0_0_2px_red]", "text-[23px]", "text-blue-500", "btn"]) {
    expect(got.classes).not.toContain(out);
  }
  for (const kept of [
    "p-[13px]",
    "w-[420px]",
    "grid-cols-[2fr_1fr]",
    "text-[var(--primary)]",
    "bg-primary/50",
    "hover:bg-muted",
    "data-[state=open]:flex",
    "aria-expanded:bg-muted",
  ]) {
    expect(got.classes).toContain(kept);
  }
  expect(got.classes).toEqual([...got.classes].sort());
});

test("a frame made only from the kit and Tailwind (A+T) gives no finding", async () => {
  const scope = await open();
  const kit = await testKit();
  for (const name of ["form", "list", "dashboard"]) {
    const got = await scope.run(check, { input: { html: await frame(name), kit } });
    if (got.kind !== "checked") throw new Error(`not checked: ${got.kind}`);
    expect({ name, findings: got.findings }).toEqual({ name, findings: [] });
    expect(got.classes.length).toBeGreaterThan(5);
  }
});

test("class names come from class attributes as the HTML tokenizer reads them", async () => {
  const scope = await open();
  const html = [
    `<p CLASS='text-red-500' class="bgg-primary">a</p>`,
    `<p class=text-red-500>b</p><textarea><p class="text-red-500"></textarea>`,
    `<!-- <p class="text-red-500"> --><p title="class=text-red-500">c</p>`,
  ].join("\n");
  const got = await scope.run(check, { input: { html, kit: await testKit() } });
  if (got.kind !== "checked") throw new Error(`not checked: ${got.kind}`);

  expect(got.findings.map((f) => `${f.line}:${f.col} ${f.rule}`)).toEqual([
    "1:11 look/color",
    "2:10 look/color",
  ]);
});

test("a class that a script writes is a finding; a read of classList is not", async () => {
  const scope = await open();
  const html = [
    `<button onclick="this.className = 'on'">A</button>`,
    `<script>el.classList.contains("x"); el.setAttribute("class", "y");</script>`,
    `<script type="application/json">{"x": "a.classList.add(1)"}</script>`,
  ].join("\n");
  const got = await scope.run(check, { input: { html, kit: await testKit() } });
  if (got.kind !== "checked") throw new Error(`not checked: ${got.kind}`);

  expect(got.findings.map((f) => `${f.line}:${f.col} ${f.rule}`)).toEqual([
    "1:23 kit/script",
    "2:40 kit/script",
  ]);
  expect(got.findings[0]?.fix).toContain("data-state");
});

test("a color of a wide space is found and shown by its space", async () => {
  const scope = await open();
  const html = [
    `<p style="color: lab(50 40 30)">a</p>`,
    `<p style="color: color(display-p3 0 0.6 0)">b</p>`,
  ].join("\n");
  const got = await scope.run(check, { input: { html, kit: await testKit() } });
  if (got.kind !== "checked") throw new Error(`not checked: ${got.kind}`);

  expect(got.findings.map((f) => `${f.line}:${f.col} ${f.rule} ${f.what}`)).toEqual([
    "1:11 look/color the color lab(50 40 30) in a style attribute is not in the look",
    "2:11 look/color the color color(display-p3 0 0.6 0) in a style attribute is not in the look",
  ]);
  expect(got.findings.every((f) => /^use var\(--[a-z-]+\)$/.test(f.fix))).toBe(true);
});

test("a frame with the kit off is not checked", async () => {
  const scope = await open();
  const html = `<meta name="easel-kit" content="off"><p class="text-red-500" style="color:red">x</p>`;
  const got = await scope.run(check, { input: { html, kit: await testKit() } });
  expect(got).toEqual({ kind: "off" });
});

test("the design system is made one time for each kit version", async () => {
  const scope = await open();
  const html = `<p class="btn">x</p>`;
  const one = await scope.run(check, { input: { html, kit: await testKit(7) } });
  // A kit version never changes: the same number with other pieces still reads the first one.
  const same = await scope.run(check, {
    input: { html, kit: { ...(await testKit(7)), css: "" } },
  });
  const next = await scope.run(check, {
    input: { html, kit: { ...(await testKit(8)), css: "" } },
  });

  expect(one).toMatchObject({ kind: "checked", findings: [] });
  expect(same).toMatchObject({ kind: "checked", findings: [] });
  expect(next).toMatchObject({
    kind: "checked",
    findings: [{ rule: "kit/class", line: 1, col: 11 }],
  });
});
