import { operation } from "@tinkered/core";
import { z } from "zod";

import { pair } from "@/kit/compose";
import { findingShape } from "@/kit/schema";
import { textFinding } from "@/kit/texts";

export const kindTexts: Readonly<Record<string, string>> = {
  taken: "taken: a canvas with that key is there. Pick another name, or use that canvas.",
  gone: "gone: it is not there (deleted, or a wrong key or id). List again, and use one that is there.",
  stale:
    "stale: it changed since the version that you gave, so nothing was written. Get it again, and make your change on the new version.",
  tooBig: "tooBig: it is over {maxBytes} bytes, so nothing was written. Make it smaller.",
  offKit:
    "offKit: the kit check refused the app frame, so nothing was written. Fix each finding below, then put it again.",
  unsettled:
    "unsettled: a ready frame uses only the texts of the team and the look, so nothing changed. Fix each finding below, or call explore_frame and put it as an exploring frame.",
  off: "off: this easel cannot draw pictures. Read the document with get_frame.",
  unreadable:
    "unreadable: each pair of colors below is hard to read, so nothing was written. Change those values, then set the look again.",
  none: "none: the look has no change to undo.",
  invalid:
    "invalid: a text below is wrong, so nothing was written. Fix each one, then set the texts again.",
  wrongState: "wrongState: the request is {state} now, so nothing was written.",
  closed: "wrongState: a viewer closed the request, so nothing was written. Stop the work on it.",
  lost: "lost: the claim is not yours now (its lease ended), so nothing was written. Stop this work, and call next_request.",
  last: "last: that is the last owner. Make another owner first.",
  notLive:
    "notLive: build {live} is live, not the build that you gave. Resolve it after that build deploys.",
  failing: "failing: the error was seen on build {seen}, so the fix did not hold.",
  held: "held: a person has this error group. Leave it to them.",
  empty: "empty: no request waits. Call next_request again.",
};

const listed = z.object({
  findings: z.array(z.union([findingShape, textFinding])).optional(),
  fails: z.array(pair).optional(),
  more: z.number().optional(),
});

const headText = operation({
  label: "mcp.headText",
  input: z.object({ ok: z.boolean(), value: z.looseObject({}) }),
  run: (_, { input: { ok, value } }) => {
    const kind = "kind" in value ? String(value.kind) : "";
    const key = kind === "wrongState" && value.state === "closed" ? "closed" : kind;
    const told = ok && kind !== "empty" ? undefined : kindTexts[key];
    if (!told) return JSON.stringify(value);

    return told.replaceAll(/\{(\w+)\}/g, (_, field: string) => String(value[field]));
  },
});

export const answerText = operation({
  label: "mcp.answerText",
  input: z.object({ ok: z.boolean(), value: z.looseObject({}) }),
  depends: { headText },
  run: ({ headText }, { input }) => {
    const { findings = [], fails = [], more = 0 } = listed.safeParse(input.value).data ?? {};
    const lines = [
      headText.run({ input }),
      ...findings.map((f) =>
        "key" in f
          ? `${f.key}: ${f.what}. Fix: ${f.fix}`
          : `${f.file ?? "frame"}:${f.line}:${f.col} ${f.rule} ${f.what}. Fix: ${f.fix}`,
      ),
      ...fails.map((p) => `${p.text} on ${p.on}: ${p.ratio}:1, needs ${p.min}:1 (${p.where})`),
      ...(more > 0 ? [`and ${more} more`] : []),
    ];

    return lines.join("\n");
  },
});
