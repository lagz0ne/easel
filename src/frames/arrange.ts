import { data } from "@tinkered/core";
import { z } from "zod";

export const arrangeGap = 80;

export const sectionHead = 120;

export const maxLayoutFindings = 20;

export const sectionGap = z.number().int().min(16).max(800);

export const sectionWrap = z.number().int().min(1).max(100);

export const revision = z.number().int().min(0);

export const finding = z.union([
  z.object({ touch: z.tuple([z.string(), z.string()]) }),
  z.object({ stray: z.string(), section: z.string() }),
]);

export type Finding = z.infer<typeof finding>;

export const findingLine = finding.transform((f) =>
  "touch" in f ? `touch ${f.touch[0]} ${f.touch[1]}` : `stray ${f.stray} ${f.section}`,
);

export const layout = z.object({
  page: z.string(),
  rev: z.number(),
  findings: z.array(finding),
  more: z.number(),
});

export type Layout = z.infer<typeof layout>;

export const sectionInfo = z.object({
  key: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  at: z.boolean(),
  wrap: z.number().nullable(),
  gap: z.number(),
  columns: z.array(z.array(z.string())),
});

export type SectionInfo = z.infer<typeof sectionInfo>;

export const boardSection = z.object({
  canvas: z.string(),
  page: z.string(),
  key: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export type BoardSection = z.infer<typeof boardSection>;

export const sections = data({
  label: "frames.sections",
  mode: "keyed",
  parse: boardSection,
  key: (s) => ({ canvas: s.canvas, page: s.page, key: s.key }),
});
