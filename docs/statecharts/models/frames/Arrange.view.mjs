const seq = (s) => (Array.isArray(s) ? s : Object.values(s));

const colsOf = (v) => seq(v.cols).map(seq);

export const title = "frames: a section that an agent arranges by relation, and an exact frame";

const column = (col) => col.join(" over ");

const pushed = (v) => {
  const cols = colsOf(v);
  if (!v.exactOn || cols.length === 0) return false;
  const width = cols.reduce(
    (x, col) => x + Math.max(...col.map((f) => (f === "b" && v.wide ? 2 : 1))) + 1,
    0,
  );
  return width - 1 > 3;
};

export const state = (v) => {
  const parts = [
    colsOf(v).length === 0 ? "No section" : `Section: ${colsOf(v).map(column).join(", then ")}`,
    v.wide ? "b is wide" : null,
    v.exactOn ? "exact frame d" : null,
    pushed(v) ? "the section goes below d" : null,
  ];
  return parts.filter(Boolean).join("; ");
};

export const group = (v) => {
  if (colsOf(v).length === 0) return "empty";
  return pushed(v) ? "around" : "flow";
};

export const colors = { empty: "tan", flow: "blue", around: "teal" };

const added = (from, to) => {
  const had = new Set(colsOf(from).flat());
  return (
    colsOf(to)
      .flat()
      .find((f) => !had.has(f)) ?? "a frame"
  );
};

const removed = (from, to) => {
  const has = new Set(colsOf(to).flat());
  return (
    colsOf(from)
      .flat()
      .find((f) => !has.has(f)) ?? "a frame"
  );
};

const placeOf = (v, f) => {
  const cols = colsOf(v);
  const i = cols.findIndex((col) => col.includes(f));
  return { cols, i, k: cols[i]?.indexOf(f) ?? -1 };
};

const after = (from, to) => {
  const f = added(from, to);
  const { cols, i } = placeOf(to, f);
  return `put ${f} --after ${cols[i - 1]?.[0] ?? "?"}`;
};

const below = (from, to) => {
  const f = added(from, to);
  const { cols, i, k } = placeOf(to, f);
  return `put ${f} --below ${cols[i]?.[k - 1] ?? "?"}`;
};

const steps = {
  PutSection: (from, to) => `put ${added(from, to)} --section`,
  PutAfter: after,
  PutBelow: below,
  Grow: () => "b gets wider: the columns after it move",
  Shrink: () => "b gets narrower",
  Remove: (from, to) => `delete ${removed(from, to)}: no hole stays`,
  ExactOn: () => "put d --at 4,0",
  ExactOff: () => "delete d",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
