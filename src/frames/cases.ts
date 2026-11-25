import { z } from "zod";

import { fixtureName } from "@/kit/fixtures";

export const maxCases = 36;

export const caseName = fixtureName;

const switchName = z.string().regex(/^[A-Za-z][\w.-]{0,39}$/, "not a switch name");

const switchValue = z.string().min(1).max(40);

export const frameCase = z.strictObject({
  name: caseName,
  fixture: fixtureName.optional(),
  switches: z.record(switchName, switchValue).optional(),
});

export type FrameCase = z.infer<typeof frameCase>;

export const caseList = z.array(frameCase).max(100);

export const caseValues = z.object({
  fixture: z.string().nullable(),
  switches: z.record(z.string(), z.string()),
});

export type CaseValues = z.infer<typeof caseValues>;

export const valuesOfCase = frameCase.transform((one): CaseValues => ({
  fixture: one.fixture ?? null,
  switches: one.switches ?? {},
}));

export const boardCase = caseValues.extend({
  source: z.string(),
  name: z.string(),
});

export type BoardCase = z.infer<typeof boardCase>;

export const caseField = z.enum(["name", "fixture"]);

export const caseInvalid = z.object({
  kind: z.literal("CaseInvalid"),
  case: z.string(),
  field: caseField,
  reason: z.string(),
});

export const casesTooMany = z.object({
  kind: z.literal("CasesTooMany"),
  cases: z.number(),
  max: z.number(),
});

export const caseFrameRefusal = z.object({
  kind: z.literal("CaseFrame"),
  source: z.string(),
});

export const caseFrameLink = z.object({ name: z.string(), id: z.string() });

export const casesSuffix = " · cases";

export const maxSectionName = 80;

export const groupNameOf = z
  .object({ source: z.string(), id: z.string(), taken: z.boolean() })
  .transform(({ source, id, taken }) => {
    const tail = taken ? ` ${id}${casesSuffix}` : casesSuffix;
    return `${source.slice(0, maxSectionName - tail.length).trim()}${tail}`;
  });

export const caseFrameNameOf = z
  .object({ source: z.string(), name: z.string() })
  .transform(({ source, name }) => {
    const tail = ` · ${name}`;
    return `${source.slice(0, 200 - tail.length).trim()}${tail}`;
  });
