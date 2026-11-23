import { z } from "zod";

export const ruleShape = z.enum([
  "look/color",
  "look/size",
  "look/override",
  "kit/class",
  "kit/piece",
  "kit/script",
  "kit/class-built",
  "kit/parse",
  "kit/import",
  "kit/react-state",
  "kit/shape",
  "copy/text",
  "copy/own",
  "copy/key",
]);

export const refusingRules: ReadonlySet<Rule> = new Set<Rule>([
  "kit/parse",
  "kit/import",
  "kit/react-state",
  "kit/shape",
]);

export type Rule = z.infer<typeof ruleShape>;

export const settleRules: ReadonlySet<Rule> = new Set<Rule>([
  "copy/text",
  "copy/own",
  "copy/key",
  "look/color",
  "look/size",
]);

export const maxAppBytes = 256 * 1024;

export const entryFile = "index.tsx";

export const maxAppFiles = 64;

export const filePath = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.tsx?$/,
    "not a path of a frame: parts of letters, digits, . _ -, with / between them, and .ts or .tsx at the end",
  );

export const frameFiles = z
  .record(filePath, z.string())
  .refine((files) => Object.keys(files).length <= maxAppFiles, `more than ${maxAppFiles} files`)
  .refine((files) => entryFile in files, `no ${entryFile}: a folder frame starts at ${entryFile}`);

export type FrameFiles = z.infer<typeof frameFiles>;

export const folderText = z
  .custom<FrameFiles>()
  .transform((files) =>
    JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)))),
  );

export const folderOf = z
  .string()
  .transform((text) => {
    if (!text.startsWith("{")) return null;
    const parsed = frameFiles.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  })
  .catch(null);

export const utf8Bytes = z.string().transform((text) => new TextEncoder().encode(text).length);

export type Finding = {
  line: number;
  col: number;
  rule: Rule;
  what: string;
  fix: string;
  file?: string;
};

export const findingShape = z.object({
  line: z.number(),
  col: z.number(),
  rule: ruleShape,
  what: z.string(),
  fix: z.string(),
  file: z.string().optional(),
});

export const kitShape = z.object({
  version: z.number().int().positive(),
  look: z.record(z.string().regex(/^--[a-z][a-z0-9-]*$/), z.string().min(1)),
  css: z.string(),
  pieces: z.array(z.string().regex(/^k-[a-z0-9-]+$/)),
});

export type Kit = z.infer<typeof kitShape>;
