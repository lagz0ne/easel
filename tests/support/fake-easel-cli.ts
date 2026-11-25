import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

const dir = process.env.FAKE_EASEL_DIR ?? "";
const stateFile = join(dir, "state.json");

const state = z
  .object({
    n: z.number(),
    calls: z.array(z.array(z.string())),
    pages: z.array(z.object({ key: z.string(), name: z.string() })),
    frames: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        page: z.string().nullable(),
        version: z.number(),
        w: z.number(),
        h: z.number(),
      }),
    ),
    sections: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        page: z.string(),
        gap: z.number(),
        columns: z.array(z.array(z.string())),
      }),
    ),
  })
  .parse(
    existsSync(stateFile)
      ? JSON.parse(readFileSync(stateFile, "utf8"))
      : { n: 0, calls: [], pages: [], frames: [], sections: [] },
  );

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    json: { type: "boolean" },
    o: { type: "string", short: "o" },
    id: { type: "string" },
    base: { type: "string" },
    name: { type: "string" },
    size: { type: "string" },
    page: { type: "string" },
    section: { type: "string" },
    after: { type: "string" },
    below: { type: "string" },
    gap: { type: "string" },
  },
});

state.calls.push(process.argv.slice(2));

const [command, , ...rest] = positionals;
const next = (prefix: string) => `${prefix}${++state.n}`;
const frameOf = (id: string) => state.frames.find((frame) => frame.id === id);
const stored = (id: string) => join(dir, "frames", id);

const unplace = (id: string) => {
  for (const section of state.sections) {
    section.columns = section.columns
      .map((column) => column.filter((each) => each !== id))
      .filter((column) => column.length > 0);
  }
};

const columnOf = (id: string) => {
  for (const section of state.sections) {
    const at = section.columns.findIndex((column) => column.includes(id));
    if (at >= 0) return { section, at };
  }
  return null;
};

type Frame = (typeof state.frames)[number];

const sectionNamed = (page: string, name: string) => {
  const found = state.sections.find((each) => each.page === page && each.name === name);
  if (found) return found;

  const made = { key: next("s"), name, page, gap: 0, columns: [] };
  state.sections.push(made);
  return made;
};

const placeInSection = (frame: Frame, page: string, name: string) => {
  unplace(frame.id);
  sectionNamed(page, name).columns.push([frame.id]);
  frame.page = page;
};

const placeNear = (frame: Frame, near: string, after: boolean) => {
  unplace(frame.id);
  const found = columnOf(near);
  if (!found) throw new Error(`fake easel: ${near} is in no section`);

  const column = found.section.columns[found.at] ?? [];
  if (after) found.section.columns.splice(found.at + 1, 0, [frame.id]);
  else column.splice(column.indexOf(near) + 1, 0, frame.id);
  frame.page = found.section.page;
};

const sizeOf = (size: string) => {
  const [w = 0, h = 0] = size.split("x").map(Number);
  return { w, h };
};

const place = (id: string) => {
  const frame = frameOf(id);
  if (!frame) throw new Error(`fake easel: no frame ${id}`);

  if (values.size) Object.assign(frame, sizeOf(values.size));
  const near = values.after ?? values.below;
  if (near) return placeNear(frame, near, Boolean(values.after));
  if (values.page && values.section) return placeInSection(frame, values.page, values.section);
  if (values.page) frame.page = values.page;
};

const put = (file: string) => {
  mkdirSync(join(dir, "frames"), { recursive: true });
  if (values.id) {
    const frame = frameOf(values.id);
    if (!frame || String(frame.version) !== values.base) throw new Error("fake easel: stale base");
    frame.version += 1;
    copyFileSync(file, stored(frame.id));
    return { id: frame.id, version: frame.version };
  }

  const id = next("f");
  state.frames.push({ id, name: values.name ?? id, page: null, version: 1, w: 0, h: 0 });
  copyFileSync(file, stored(id));
  place(id);
  return { id, version: 1 };
};

const answers: Record<string, () => unknown> = {
  pages: () => ({ pages: state.pages }),
  page: () => {
    const key = next("p");
    state.pages.push({ key, name: positionals[3] ?? "" });
    return { key };
  },
  ls: () => ({ rev: state.n, frames: state.frames }),
  get: () => {
    copyFileSync(stored(rest[0] ?? ""), values.o ?? "");
    return {};
  },
  put: () => put(rest[0] ?? ""),
  move: () => {
    place(rest[0] ?? "");
    return {};
  },
  layout: () => ({ sections: state.sections.filter((section) => section.page === values.page) }),
  section: () => {
    const found = state.sections.find((each) => each.name === rest[0] && each.page === values.page);
    if (found) found.gap = Number(values.gap);
    return {};
  },
};

const answer = answers[command ?? ""]?.();
writeFileSync(stateFile, JSON.stringify(state));
process.stdout.write(`${JSON.stringify(answer ?? null)}\n`);
