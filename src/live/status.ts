import { operation } from "@tinkered/core";
import { z } from "zod";

import { takeKeys } from "./screens";
import { takeValues, valueFinding } from "./values";

export const takeWord = z.enum(["new", "next", "same", "differs", "failed"]);

export const takeRecord = z.object({
  screen: z.string(),
  take: z.enum(takeKeys),
  word: takeWord,
  after: z.number().int().nullable(),
  before: z.number().int().nullable(),
  why: z.string().optional(),
});

export type TakeRecord = z.infer<typeof takeRecord>;

export const liveStatus = z.object({
  build: z.number().int(),
  commit: z.string(),
  designs: z.record(z.string(), z.number().int()),
  takes: z.array(takeRecord),
  values: z.array(takeValues),
  findings: z.array(valueFinding),
});

export type LiveStatus = z.infer<typeof liveStatus>;

const escapes: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const dataId = "easel-live";

export const liveEscape = operation({
  label: "live.escape",
  input: z.string(),
  run: (_, { input }) => input.replace(/[&<>"]/g, (c) => escapes[c] ?? c),
});

export const liveTakeRow = operation({
  label: "live.takeRow",
  input: takeRecord,
  depends: { liveEscape },
  run: ({ liveEscape }, { input: t }) => {
    const screen = liveEscape.run({ input: t.screen });
    const why = t.why ? `: ${liveEscape.run({ input: t.why })}` : "";

    return `<tr><td>${screen}</td><td>${t.take}</td><td>${t.word}${why}</td><td>${t.after ?? "–"}</td><td>${t.before ?? "–"}</td></tr>`;
  },
});

export const liveFindingItem = operation({
  label: "live.findingItem",
  input: valueFinding,
  depends: { liveEscape },
  run: ({ liveEscape }, { input: f }) => {
    const screen = liveEscape.run({ input: f.screen });
    const value = liveEscape.run({ input: f.value });
    const where = f.where ? ` (${liveEscape.run({ input: f.where })})` : "";

    return `<li>${screen}, ${f.take}: the ${f.kind} ${value}${where}</li>`;
  },
});

export const liveStatusHtml = operation({
  label: "live.statusHtml",
  input: liveStatus,
  depends: { liveEscape, liveTakeRow, liveFindingItem },
  run: ({ liveEscape, liveTakeRow, liveFindingItem }, { input }) => {
    const rows = input.takes.map((t) => liveTakeRow.run({ input: t })).join("");
    const found = input.findings.map((f) => liveFindingItem.run({ input: f })).join("");
    const data = JSON.stringify(input).replace(/</g, "\\u003c");
    return [
      '<!doctype html><html><head><meta charset="utf-8"><title>Live</title></head>',
      '<body style="font-family:Inter,sans-serif;font-size:15px;margin:0;padding:32px">',
      `<h1 style="font-size:20px;margin:0 0 8px">Live · build ${input.build}</h1>`,
      `<p style="margin:0 0 24px">Commit ${liveEscape.run({ input: input.commit.slice(0, 12) })}. Each screen of the app, as the build shows it, beside its design.</p>`,
      `<table><thead><tr><th>Screen</th><th>Take</th><th>Result</th><th>After</th><th>Before</th></tr></thead><tbody>${rows}</tbody></table>`,
      `<h2 style="font-size:15px;margin:24px 0 8px">Values that are not in the design system: ${input.findings.length}</h2>`,
      found === "" ? "" : `<ul>${found}</ul>`,
      `<script type="application/json" id="${dataId}">${data}</script>`,
      "</body></html>",
    ].join("");
  },
});

const dataPattern = new RegExp(
  `<script type="application/json" id="${dataId}">([\\s\\S]*?)</script>`,
);

export const liveStatusRead = operation({
  label: "live.statusRead",
  input: z.string(),
  run: (_, { input }) => {
    const raw = dataPattern.exec(input)?.[1];
    if (raw === undefined) return { kind: "none" } as const;

    const parsed = z
      .string()
      .transform((s, ctx) => {
        try {
          return JSON.parse(s);
        } catch {
          ctx.addIssue({ code: "custom", message: "not JSON" });
          return z.NEVER;
        }
      })
      .pipe(liveStatus)
      .safeParse(raw);
    return parsed.success
      ? ({ kind: "read", status: parsed.data } as const)
      : ({ kind: "bad" } as const);
  },
});
