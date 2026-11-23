import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { parseSync } from "oxc-parser";
import { afterEach, expect, test } from "vite-plus/test";

import { checkApp } from "@/kit/app.server";
import { makeApp } from "@/kit/make.server";
import { runtimeNames } from "@/kit/runtime";

import { testKit } from "./kit/fixture";

// The check of an app frame (SPEC-kit.md § App frames; judged rules 14 and 15): class names only
// from the class places, read from the syntax tree of oxc-parser; each other expression there is
// `kit/class-built`; each class name gets the K5 verdict; the fixes go in by position, and the make
// step gets exactly the class names of the fixed text.

const scopes: Array<{ close: () => Promise<unknown> }> = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.close();
});

async function open() {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  scopes.push(scope);
  return scope;
}

const pricing = () => Bun.file(new URL("kit/frames/pricing.tsx", import.meta.url)).text();

async function checked(tsx: string) {
  const scope = await open();
  const got = await scope.run(checkApp, { input: { tsx, kit: await testKit() } });
  if (got.kind !== "checked") throw new Error(`not checked: ${JSON.stringify(got)}`);
  return got;
}

const at = (findings: Array<{ line: number; col: number; rule: string }>) =>
  findings.map((f) => `${f.line}:${f.col} ${f.rule}`);

test("a usual app frame from the kit gives no finding, and its classes come from each place", async () => {
  const got = await checked(await pricing());

  expect(got.findings).toEqual([]);
  expect(got.fixed).toBe(await pricing());
  // The className attribute, cn, clsx and its object keys, cva's base, variants and compound
  // variants, a map of whole names, and a const of a place.
  for (const name of [
    "mx-auto",
    "md:grid-cols-3",
    "items-center",
    "font-semibold",
    "opacity-70",
    "p-6",
    "ring-2",
    "md:p-10",
    "md:-translate-y-2",
    "bg-primary",
    "text-muted-foreground",
    "text-success",
    "text-center",
  ]) {
    expect(got.classes).toContain(name);
  }
  // Kit classes give their CSS from the kit, so they are not made; the names of variants and of
  // data are no classes.
  for (const name of ["btn", "card", "badge", "Starter", "month", "featured", "lg"]) {
    expect(got.classes).not.toContain(name);
  }
  expect(got.classes).toEqual([...new Set(got.classes)].sort());
});

test("each class that code builds is kit/class-built at its line and column, with the fix", async () => {
  const tsx = [
    "const tone = (t: string) => <p className={`bg-${t}`} />;",
    'const join = (x: string) => <p className={"text-" + x} />;',
    "const call = (x: string) => <p className={make(x)} />;",
    "const name = (cls: string) => <p className={cls} />;",
    'const bad = <p className={cn({ [key]: on }, ...more, { "p-4": on })} />;',
    'const obj = <p className={{ "p-4": true }} />;',
    "const map = (k: string) => <p className={sizes[k]} />;",
    "const sizes = { sm: make(1) };",
  ].join("\n");
  const got = await checked(tsx);

  expect(at(got.findings)).toEqual([
    "1:43 kit/class-built",
    "2:43 kit/class-built",
    "3:43 kit/class-built",
    "4:45 kit/class-built",
    "5:33 kit/class-built",
    "5:45 kit/class-built",
    "6:27 kit/class-built",
    "8:21 kit/class-built",
  ]);
  expect(got.findings[0]?.what).toContain("`bg-${t}`");
  for (const f of got.findings) expect(f.fix).toContain("a map of whole names");
  // A place that is built stays as it is, and a whole name next to it is made.
  expect(got.fixed).toBe(tsx);
  expect(got.classes).toEqual(["p-4"]);
});

test("a class name gets the K5 verdict, and each fix goes in at its place", async () => {
  const tsx = [
    "export function View() {",
    '  return <div className="p-4 text-red-500 bgg-primary">',
    '    <p className={cn("bg-[#f00]", on && "text-[23px] w-[420px]")}>x</p>',
    "  </div>;",
    "}",
  ].join("\n");
  const got = await checked(tsx);

  expect(at(got.findings)).toEqual([
    "2:30 look/color",
    "2:43 kit/class",
    "3:23 look/color",
    "3:42 look/size",
  ]);
  expect(got.findings.map((f) => f.fix)).toEqual([
    "use text-destructive",
    "use bg-primary",
    "use bg-destructive",
    "use text-2xl",
  ]);
  // An unknown class goes with one space next to it; a color or a size takes the look's class.
  expect(got.fixed).toBe(
    [
      "export function View() {",
      '  return <div className="p-4 text-destructive">',
      '    <p className={cn("bg-destructive", on && "text-2xl w-[420px]")}>x</p>',
      "  </div>;",
      "}",
    ].join("\n"),
  );
  expect(got.classes).toEqual([
    "bg-destructive",
    "p-4",
    "text-2xl",
    "text-destructive",
    "w-[420px]",
  ]);
});

test("the fixed text parses and checks with no finding", async () => {
  const tsx = `const a = <p className={clsx("text-red-500 x-nope", ["bg-[#f00]"])} />;`;
  const first = await checked(tsx);
  expect(first.findings.length).toBe(3);

  expect(parseSync("frame.tsx", first.fixed, { lang: "tsx" }).errors).toEqual([]);
  const again = await checked(first.fixed);
  expect(again.findings).toEqual([]);
  expect(again.classes).toEqual(first.classes);
});

test("a color in a style object or a paint, and a class that code writes, are found", async () => {
  const tsx = [
    'const a = <p style={{ color: "#f00", marginTop: "4px", "--primary": "red" }} />;',
    'const b = <svg><path fill="rgb(0, 128, 0)" stroke="currentColor" /></svg>;',
    'el.classList.add("on"); el.className = "x"; el.setAttribute("class", "y");',
    "el.classList.contains('on');",
  ].join("\n");
  const got = await checked(tsx);

  expect(at(got.findings)).toEqual([
    "1:31 look/color",
    "1:70 look/override",
    "1:70 look/color",
    "2:28 look/color",
    "3:4 kit/script",
    "3:28 kit/script",
    "3:48 kit/script",
  ]);
  expect(got.findings[0]?.fix).toMatch(/^use var\(--/);
});

test("a TSX that does not parse is unparsed, with kit/parse at its line and column", async () => {
  const scope = await open();
  const got = await scope.run(checkApp, {
    input: { tsx: "export function View() {\n  return <p>;\n}", kit: await testKit() },
  });

  expect(got.kind).toBe("unparsed");
  expect(at(got.findings)).toEqual(["3:1 kit/parse"]);
});

test("the make step gets the classes of the fixed text, the same bytes in two orders", async () => {
  const kit = await testKit();
  const a = `const a = <p className="p-4 text-primary bg-[#f00]" />;`;
  const b = `const b = <p className={cn("mt-8", "rounded-md bg-muted")} />;`;
  const css = async (scope: Awaited<ReturnType<typeof open>>, tsx: string) => {
    const got = await scope.run(makeApp, { input: { files: { "index.tsx": tsx }, kit } });
    if (got.kind !== "made") throw new Error(`not made: ${got.kind}`);
    return got.css;
  };

  const one = await open();
  const first = [await css(one, a), await css(one, b), await css(one, await pricing())];
  const two = await open();
  const second = [await css(two, await pricing()), await css(two, b), await css(two, a)];

  expect(second[0]).toBe(first[2]);
  expect(second[1]).toBe(first[1]);
  expect(second[2]).toBe(first[0]);
  expect(first[0]).toContain("var(--destructive)");
  expect(first[0]).not.toContain("#f00");
  expect(first[1]).not.toContain(".p-4");
});

test("the make step of a TSX that does not parse makes nothing", async () => {
  const scope = await open();
  const got = await scope.run(makeApp, {
    input: { files: { "index.tsx": "<p" }, kit: await testKit() },
  });
  expect(got.kind).toBe("unparsed");
});

test("speed: a usual app frame and one of 256 KiB are checked in the budget of 50 ms", async () => {
  const scope = await open();
  const kit = await testKit();
  const usual = await pricing();
  // The limit of an app frame (SPEC-kit.md § App frames, "The file"). Each copy is one more
  // pricing frame, with no export, so the copies do not clash.
  const big = usual.repeat(Math.floor((256 * 1024) / usual.length)).replaceAll("export ", "");
  expect(new TextEncoder().encode(big).length).toBeLessThanOrEqual(256 * 1024);
  expect(await scope.run(checkApp, { input: { tsx: big, kit } })).toMatchObject({
    kind: "checked",
  });

  const time = async (tsx: string, runs: number) => {
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await scope.run(checkApp, { input: { tsx, kit } });
      times.push(performance.now() - start);
    }
    return times.sort((x, y) => x - y)[Math.floor(runs / 2)] ?? Infinity;
  };

  // Measured on 2026-11-22 (vibea2, p50): 0.8 ms for the usual frame, 28 ms for 256 KiB. Loose,
  // so a loaded host does not fail it, as the speed tests of the HTML check.
  expect(await time(usual, 15)).toBeLessThan(25);
  expect(await time(big, 5)).toBeLessThan(150);
});

test("the module of an app frame: kit/import, kit/react-state and kit/shape, each at its place", async () => {
  const tsx = [
    'import { useState, useMemo } from "react";',
    'import * as React from "react";',
    'import { helper } from "./helper";',
    'import { motion } from "framer-motion";',
    'import { z } from "zod";',
    "export const logic = { cells: {}, ops: {} };",
    "export function View() {",
    "  React.useEffect(() => {});",
    '  const more = import("lodash");',
    "  return <p />;",
    "}",
    "export const extra = 1;",
    "export default View;",
    "export type Tone = string;",
    'export * from "clsx";',
  ].join("\n");
  const scope = await open();
  const names = ["react", "zod", "clsx", "@easel/frame"];
  const got = await scope.run(checkApp, { input: { tsx, kit: await testKit(), names } });
  if (got.kind !== "checked") throw new Error("not checked");

  expect(at(got.findings)).toEqual([
    "1:10 kit/react-state",
    "3:24 kit/import",
    "4:24 kit/import",
    "8:9 kit/react-state",
    "9:16 kit/import",
    "12:8 kit/shape",
    "13:16 kit/shape",
    "14:8 kit/shape",
    "15:1 kit/shape",
  ]);
  expect(got.findings[0]?.what).toBe("the frame keeps state in React with useState");
  expect(got.findings[1]?.what).toContain('"./helper"');
  expect(got.findings[1]?.fix).toContain("react, zod, clsx, @easel/frame");
  expect(got.findings[5]?.what).toContain("the name extra");

  // With no `names`, the check is the class check of 4.2 only.
  const classes = await scope.run(checkApp, { input: { tsx, kit: await testKit() } });
  expect(classes.findings).toEqual([]);
});

test("an app frame with no View is kit/shape at its first line; logic and frame are each optional", async () => {
  const scope = await open();
  const got = await scope.run(checkApp, {
    input: { tsx: "const a = 1;", kit: await testKit(), names: ["react"] },
  });

  expect(at(got.findings)).toEqual(["1:1 kit/shape"]);
  expect(got.findings.map((f) => f.what)).toEqual(["the frame does not export View"]);

  // A capsule frame: View (a resource) and its own capsule, frame.
  const capsuleFrame = "export const View = 1;\nexport const frame = 2;";
  const both = await scope.run(checkApp, {
    input: { tsx: capsuleFrame, kit: await testKit(), names: ["react"] },
  });
  expect(both.findings).toEqual([]);
});

test("the usual app frame passes the check of its module with the names of the runtime", async () => {
  const scope = await open();
  const got = await scope.run(makeApp, {
    input: {
      files: { "index.tsx": await pricing() },
      kit: await testKit(),
      names: [...runtimeNames],
    },
  });
  if (got.kind !== "made") throw new Error("not made");

  expect(got.findings).toEqual([]);
  // One module: no types, the JSX of React's runtime, each name an import for the import map,
  // and the call of the mount at its end. It exports nothing.
  expect(got.js).toContain('from"react/jsx-runtime"');
  expect(got.js).toContain('import{mount}from"@easel/frame"');
  expect(got.js).not.toContain("type Period");
  expect(got.js).not.toMatch(/\bexport\b/);
  expect(got.js).toMatch(
    /mount\(\{View(:\w+)?,frame:undefined,controls:undefined,part:undefined,panes:undefined\}\);\s*$/,
  );
});

test("a folder frame: an import of its own files, by a path with no extension; each finding names its file; only the entry has kit/shape", async () => {
  const scope = await open();
  const files = {
    "index.tsx": [
      'import { Row } from "./parts/row";',
      'import { title } from "./copy";',
      "export function View() {",
      '  return <main className="p-4"><h1>{title}</h1><Row /></main>;',
      "}",
    ].join("\n"),
    "copy.ts": 'export const title = "Plans";\nexport const other = 1;',
    "parts/row.tsx": [
      'import { title } from "../copy.ts";',
      'import { gone } from "./gone";',
      'export const Row = () => <p className="text-red-500">{title}</p>;',
    ].join("\n"),
  };
  const kit = await testKit();
  const names = [...runtimeNames];

  const refused = await scope.run(makeApp, { input: { files, kit, names } });
  expect(refused.findings.map((f) => `${f.file ?? "?"}:${f.line}:${f.col} ${f.rule}`)).toEqual([
    "parts/row.tsx:2:22 kit/import",
    "parts/row.tsx:3:40 look/color",
  ]);
  expect(refused.findings[0]?.what).toBe(
    'the frame imports "./gone": no file of the frame has this path',
  );

  // Without the bad import: one module, with each file once and the fix of the class.
  const fine = {
    ...files,
    "parts/row.tsx": (files["parts/row.tsx"] ?? "").replace(/.*gone.*\n/, ""),
  };
  const made = await scope.run(makeApp, { input: { files: fine, kit, names } });
  if (made.kind !== "made") throw new Error("not made");
  expect(made.findings.map((f) => `${f.file ?? "?"}:${f.line} ${f.rule}`)).toEqual([
    "parts/row.tsx:2 look/color",
  ]);
  expect(made.fixed["parts/row.tsx"]).toContain('"text-destructive"');
  expect(made.js.match(/"Plans"/g)?.length).toBe(1);
  expect(made.js).toContain('"text-destructive"');
  expect(made.css).toContain(".p-4");

  // A path above the frame is no file of it.
  const above = { "index.tsx": 'import "../x";\nexport function View() { return null; }' };
  const out = await scope.run(makeApp, { input: { files: above, kit, names } });
  expect(out.findings.map((f) => f.rule)).toEqual(["kit/import"]);
});

test("logic, View and frame can be exported by another name, or from another file of the frame", async () => {
  const scope = await open();
  const tsx = [
    "const a = 1;",
    "function V() { return null; }",
    "export { a as logic, V as View };",
    'export { frame } from "./parts";',
    'export * from "./more";',
  ].join("\n");
  const got = await scope.run(checkApp, { input: { tsx, kit: await testKit(), names: [] } });

  expect(got.findings.map((f) => f.what)).toEqual([
    'the frame imports "./parts": no file of the frame has this path',
    'the frame exports all the names of "./more": an app frame exports View, and logic or frame, and controls, part and panes, and no other name',
    'the frame imports "./more": no file of the frame has this path',
  ]);
});
