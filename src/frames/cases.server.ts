import type { Database } from "bun:sqlite";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { readKit } from "@/kit/store.server";

import { caseFrameNameOf, caseList, maxCases, valuesOfCase } from "./cases";
import { framesApi } from "./contract";
import {
  arrangeAfter,
  groupOf,
  layoutOf,
  readCaseFrames,
  removeFrameRow,
  seatCaseFrames,
  showArranged,
  showPages,
  showRemoved,
  sourceRow,
} from "./store.server";

const readSource = operation({
  label: "frames.readSource",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, id, db } }) =>
    sourceRow
      .nullable()
      .parse(
        db
          .query(
            "SELECT id, name, page, x, y, section, source FROM frames_frames WHERE canvas = ? AND id = ?",
          )
          .get(canvas, id),
      ),
});

const listRow = z.object({ list: z.string(), rev: z.number() });

const storedList = z.string().transform((text) => {
  try {
    return caseList.safeParse(JSON.parse(text)).data ?? [];
  } catch {
    return [];
  }
});

const readList = operation({
  label: "frames.readList",
  input: z.object({
    canvas: z.string(),
    source: z.string(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, source, db } }) => {
    const found = listRow
      .nullable()
      .parse(
        db
          .query("SELECT list, rev FROM frames_cases WHERE canvas = ? AND source = ?")
          .get(canvas, source),
      );
    return found === null
      ? { rev: 0, cases: [] }
      : { rev: found.rev, cases: storedList.parse(found.list) };
  },
});

const sectionName = z.object({ name: z.string() });

export const listCases = operation({
  label: "cases.list.do",
  input: framesApi["cases.list"].input,
  depends: {
    connection: bunSqlite.connection,
    readSource,
    readList,
    readCaseFrames,
  },
  run: async ({ connection, readSource, readList, readCaseFrames }, { input }) => {
    const db = connection.db.$client;
    const { canvas, frame } = input;
    const source = readSource.run({ input: { canvas, id: frame, db } });
    if (source === null) return { kind: "gone" as const };
    if (source.source !== null) return { kind: "CaseFrame" as const, source: source.source };

    const { rev, cases } = readList.run({
      input: { canvas, source: frame, db },
    });
    const frames = readCaseFrames
      .run({ input: { canvas, source: frame, db } })
      .map((one) => ({ name: one.case_name, id: one.id }));
    const named = sectionName
      .nullable()
      .parse(
        db
          .query("SELECT name FROM frames_sections WHERE canvas = ? AND page = ? AND key = ?")
          .get(canvas, source.page, source.section),
      );
    return {
      kind: "found" as const,
      rev,
      section: named?.name ?? null,
      cases,
      frames,
    };
  },
});

const fixtureNamesNow = operation({
  label: "frames.fixtureNamesNow",
  depends: { readKit },
  run: async ({ readKit }) => {
    const kit = await readKit.run();
    return new Set(Object.values(kit?.fixtures ?? {}).flatMap((named) => Object.keys(named)));
  },
});

export const checkCases = operation({
  label: "frames.checkCases",
  input: z.object({
    cases: caseList,
    fixtures: z.custom<ReadonlySet<string>>(),
  }),
  run: (_, { input: { cases, fixtures } }) => {
    if (cases.length > maxCases) {
      return {
        kind: "CasesTooMany" as const,
        cases: cases.length,
        max: maxCases,
      };
    }

    const seen = new Set<string>();
    for (const one of cases) {
      if (seen.has(one.name)) {
        const reason = "a case before it has this name";
        return {
          kind: "CaseInvalid" as const,
          case: one.name,
          field: "name" as const,
          reason,
        };
      }
      seen.add(one.name);
      if (one.fixture !== undefined && !fixtures.has(one.fixture)) {
        const reason = `no cell has the fixture "${one.fixture}" (fixtures.list)`;
        return {
          kind: "CaseInvalid" as const,
          case: one.name,
          field: "fixture" as const,
          reason,
        };
      }
    }
    return { kind: "good" as const };
  },
});

const writeCaseFrames = operation({
  label: "frames.writeCaseFrames",
  input: z.object({
    canvas: z.string(),
    source: sourceRow,
    cases: caseList,
    db: z.custom<Database>(),
  }),
  depends: { readCaseFrames, removeFrameRow },
  run: (deps, { input: { canvas, source, cases, db }, clock, random }) => {
    const { readCaseFrames, removeFrameRow } = deps;
    const before = readCaseFrames.run({
      input: { canvas, source: source.id, db },
    });
    const wanted = new Set(cases.map((one) => one.name));
    const removed = before
      .filter((one) => !wanted.has(one.case_name))
      .flatMap((one) => removeFrameRow.run({ input: { canvas, id: one.id, db } }) ?? []);

    const known = new Map(before.map((one) => [one.case_name, one.id]));
    const made = clock.currentTimeMillis();
    const frames = cases.map((one) => {
      const values = JSON.stringify(valuesOfCase.parse(one));
      const title = caseFrameNameOf.parse({
        source: source.name,
        name: one.name,
      });
      const id = known.get(one.name);
      if (id !== undefined) {
        db.query(
          "UPDATE frames_frames SET case_values = ?, name = ? WHERE canvas = ? AND id = ?",
        ).run(values, title, canvas, id);
        return { name: one.name, id };
      }

      const fresh = random.uuid().replaceAll("-", "").slice(0, 12);
      db.query(
        `INSERT INTO frames_frames (canvas, id, name, page, x, y, w, h, version, html, made, css,
           kit, js, status, image, source, case_name, case_values)
         SELECT canvas, ?, ?, page, x, y, w, h, version, html, ?, css, kit, js, status, image,
           id, ?, ?
         FROM frames_frames WHERE canvas = ? AND id = ?`,
      ).run(fresh, title, made, one.name, values, canvas, source.id);
      return { name: one.name, id: fresh };
    });
    return { frames, removed };
  },
});

export const setCases = operation({
  label: "cases.set.do",
  input: framesApi["cases.set"].input,
  depends: {
    connection: bunSqlite.connection,
    fixtureNamesNow,
    checkCases,
    readSource,
    readList,
    groupOf,
    writeCaseFrames,
    seatCaseFrames,
    arrangeAfter,
    showArranged,
    showRemoved,
    showPages,
    layoutOf,
  },
  run: async (deps, { input }) => {
    const { connection, fixtureNamesNow, checkCases, readSource, readList } = deps;
    const { groupOf, writeCaseFrames, arrangeAfter } = deps;
    const db = connection.db.$client;
    const { canvas, frame, cases } = input;
    const fixtures = await fixtureNamesNow.run();
    const checked = checkCases.run({ input: { cases, fixtures } });
    if (checked.kind !== "good") return checked;

    const answer = db.transaction(() => {
      const source = readSource.run({ input: { canvas, id: frame, db } });
      if (source === null) return { kind: "gone" as const };
      if (source.source !== null) return { kind: "CaseFrame" as const, source: source.source };

      const now = readList.run({ input: { canvas, source: frame, db } });
      if (input.base !== undefined && input.base !== now.rev) {
        return { kind: "changed" as const, rev: now.rev };
      }

      const grouped = cases.length > 0 || source.section !== null;
      if (grouped) groupOf.run({ input: { canvas, source, db } });
      const written = writeCaseFrames.run({
        input: { canvas, source, cases, db },
      });
      if (grouped) {
        deps.seatCaseFrames.run({
          input: { canvas, source: frame, frames: written.frames, db },
        });
      }
      const rev = now.rev + 1;
      db.query(
        `INSERT INTO frames_cases (canvas, source, list, rev) VALUES (?, ?, ?, ?)
         ON CONFLICT (canvas, source) DO UPDATE SET list = excluded.list, rev = excluded.rev`,
      ).run(canvas, frame, JSON.stringify(cases), rev);
      const { page } = source;
      const done = arrangeAfter.run({
        input: { canvas, pages: [page], changed: true, db },
      });
      return { kind: "set" as const, rev, page, done, ...written };
    })();
    if (answer.kind !== "set") return answer;

    const { rev, page, done, frames, removed } = answer;
    deps.showRemoved.run({ input: removed });
    const also = [frame, ...frames.map((one) => one.id)];
    deps.showArranged.run({ input: { canvas, done, also, db } });
    deps.showPages.run({ input: { canvas, db } });
    const layout = deps.layoutOf.run({ input: { page, done } });
    return { kind: "set" as const, rev, frames, layout };
  },
});
