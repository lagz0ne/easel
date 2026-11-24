import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { arrangeGap, clearance, sectionHead, sectionSpace } from "@/frames/arrange";
import { findingsOf, layoutPage, type SectionRow } from "@/frames/arrange.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const s = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => s.close());
  return s;
}

const flow = (key: string, ord: number, more: Partial<SectionRow> = {}): SectionRow => ({
  key,
  name: key.toUpperCase(),
  ord,
  atX: null,
  atY: null,
  wrap: null,
  gap: arrangeGap,
  ...more,
});

const at = (id: string, section: string, col: number, row: number, w = 100, h = 50) => ({
  id,
  section,
  col,
  row,
  w,
  h,
});

test("ten frames of a flow in a section go from left to right, in their order, one gap apart", async () => {
  const s = await scope();
  const slots = Array.from({ length: 10 }, (_, i) => at(`f${i}`, "flow", i, 0, 390, 844));
  const laid = s.run(layoutPage, {
    input: { sections: [flow("flow", 0)], slots: slots.toReversed(), fixed: [] },
  });

  const xs = slots.map((one) => laid.places.find((p) => p.id === one.id)?.x);
  expect(xs).toEqual(slots.map((_, i) => i * (390 + arrangeGap)));
  expect(new Set(laid.places.map((p) => p.y))).toEqual(new Set([sectionHead]));
  expect(laid.sections[0]).toMatchObject({
    x: 0,
    y: 0,
    w: 10 * 390 + 9 * arrangeGap,
    h: sectionHead + 844,
    columns: slots.map((one) => [one.id]),
  });
});

test("a frame that gets 300 px wider moves each column after it by 300 px", async () => {
  const s = await scope();
  const slots = [at("a", "flow", 0, 0), at("b", "flow", 1, 0), at("c", "flow", 2, 0)];
  const sections = [flow("flow", 0)];
  const before = s.run(layoutPage, { input: { sections, slots, fixed: [] } });
  const wider = slots.map((one) => (one.id === "b" ? { ...one, w: one.w + 300 } : one));
  const after = s.run(layoutPage, { input: { sections, slots: wider, fixed: [] } });

  const xOf = (laid: typeof before, id: string) => laid.places.find((p) => p.id === id)?.x ?? -1;
  expect(xOf(after, "a")).toBe(xOf(before, "a"));
  expect(xOf(after, "b")).toBe(xOf(before, "b"));
  expect(xOf(after, "c")).toBe(xOf(before, "c") + 300);
});

test("a column stacks its frames from top to bottom, and the widest frame sets its width", async () => {
  const s = await scope();
  const slots = [
    at("top", "s", 0, 0, 200, 50),
    at("under", "s", 0, 1, 300, 60),
    at("next", "s", 1, 0),
  ];
  const laid = s.run(layoutPage, { input: { sections: [flow("s", 0)], slots, fixed: [] } });

  expect(laid.places).toEqual([
    { id: "top", x: 0, y: sectionHead },
    { id: "under", x: 0, y: sectionHead + 50 + arrangeGap },
    { id: "next", x: 300 + arrangeGap, y: sectionHead },
  ]);
  expect(laid.sections[0]?.h).toBe(sectionHead + 50 + arrangeGap + 60);
});

test("a wrap puts a new line of columns under the tallest column of the line before", async () => {
  const s = await scope();
  const slots = [at("a", "g", 0, 0, 100, 80), at("b", "g", 1, 0, 100, 40), at("c", "g", 2, 0)];
  const laid = s.run(layoutPage, {
    input: { sections: [flow("g", 0, { wrap: 2, gap: 20 })], slots, fixed: [] },
  });

  expect(laid.places.find((p) => p.id === "c")).toEqual({
    id: "c",
    x: 0,
    y: sectionHead + 80 + 20,
  });
  expect(laid.sections[0]).toMatchObject({ w: 220, wrap: 2, gap: 20 });
});

test("sections go from top to bottom in their order, a section space apart", async () => {
  const s = await scope();
  const slots = [at("a", "one", 0, 0), at("b", "two", 0, 0)];
  const laid = s.run(layoutPage, {
    input: { sections: [flow("two", 1), flow("one", 0), flow("none", 2)], slots, fixed: [] },
  });

  expect(laid.sections.map((one) => [one.key, one.y])).toEqual([
    ["one", 0],
    ["two", sectionHead + 50 + sectionSpace],
  ]);
});

test("a section in the flow goes below an exact frame that it would come near, and a placed section stays", async () => {
  const s = await scope();
  const fixed = [{ id: "x", x: 500, y: 10, w: 100, h: 300 }];
  const slots = [at("a", "flow", 0, 0, 600, 50), at("p", "placed", 0, 0)];
  const sections = [flow("flow", 0), flow("placed", 1, { atX: 3000, atY: 40 })];
  const laid = s.run(layoutPage, { input: { sections, slots, fixed } });

  expect(laid.sections.find((one) => one.key === "flow")?.y).toBe(310 + clearance);
  expect(laid.sections.find((one) => one.key === "placed")).toMatchObject({
    x: 3000,
    y: 40,
    at: true,
  });
  expect(laid.places.find((p) => p.id === "p")).toEqual({ id: "p", x: 3000, y: 40 + sectionHead });
});

test("the check lists the frames that touch and the strays of a section", async () => {
  const s = await scope();
  const frames = [
    { id: "a", x: 0, y: 0, w: 100, h: 100, section: null },
    { id: "b", x: 110, y: 0, w: 100, h: 100, section: null },
    { id: "c", x: 400, y: 0, w: 100, h: 100, section: null },
    { id: "m", x: 1000, y: 1120, w: 100, h: 100, section: "s" },
    { id: "in", x: 1050, y: 1010, w: 30, h: 30, section: null },
  ];
  const box = { x: 1000, y: 1000, w: 300, h: 220, at: true, wrap: null, gap: 80 };
  const sections = [{ key: "s", name: "Sign in", ...box, columns: [["m"]] }];
  const found = s.run(findingsOf, { input: { frames, sections } });

  expect(found).toEqual([{ touch: ["a", "b"] }, { stray: "in", section: "Sign in" }]);
});

test("speed: the layout and the check of a page of 200 frames in 10 sections take less than 5 ms", async () => {
  const s = await scope();
  const sections = Array.from({ length: 10 }, (_, n) => flow(`s${n}`, n, { wrap: 5 }));
  const slots = Array.from({ length: 200 }, (_, i) => at(`f${i}`, `s${i % 10}`, i, 0, 390, 844));
  const arrangeOnce = () => {
    const start = performance.now();
    const laid = s.run(layoutPage, { input: { sections, slots, fixed: [] } });
    const boxes = laid.places.map((p) => ({ ...p, w: 390, h: 844, section: "s0" }));
    s.run(findingsOf, { input: { frames: boxes, sections: laid.sections } });
    return performance.now() - start;
  };
  const warmUpRuns = 20;
  const timedRuns = 31;
  for (let run = 0; run < warmUpRuns; run++) arrangeOnce();
  const times = Array.from({ length: timedRuns }, arrangeOnce).sort((a, b) => a - b);
  const p50 = times[Math.floor(timedRuns / 2)] ?? Infinity;

  console.log(`speed: the layout and the check of 200 frames, warm: p50 ${p50.toFixed(2)} ms`);
  expect(p50).toBeLessThan(5);
});
