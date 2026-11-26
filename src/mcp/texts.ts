import { operation } from "@tinkered/core";
import { z } from "zod";

import { findingLine, layout } from "@/frames/arrange";
import { pair } from "@/kit/compose";
import { findingShape } from "@/kit/schema";
import { textFinding } from "@/kit/texts";

export const kindTexts: Readonly<Record<string, string>> = {
  taken:
    "taken: a canvas or a page with that key or name is there. Pick another name, or use the one that is there.",
  full: "full: the canvas has 50 pages, the most it can have. Put the frame on a page that is there.",
  gone: "gone: it is not there (deleted, or a wrong key or id). List again, and use one that is there.",
  CaseFrame:
    "CaseFrame: this frame shows a case of the frame {source}, and only easel writes it, so nothing was written. Change the frame {source}, or its list of cases with set_cases.",
  CaseInvalid:
    "CaseInvalid: the case {case} has a bad {field} ({reason}), so nothing was written. Fix that case, then set the cases again.",
  CasesTooMany:
    "CasesTooMany: the list has {cases} cases, and a frame has {max} at most, so nothing was written. Remove cases, then set them again.",
  stale:
    "stale: it changed since the version that you gave, so nothing was written. Get it again, and make your change on the new version.",
  tooBig: "tooBig: it is over {maxBytes} bytes, so nothing was written. Make it smaller.",
  offKit:
    "offKit: the kit check refused the app frame, so nothing was written. Fix each finding below, then put it again.",
  unsettled:
    "unsettled: a ready frame uses only the texts of the team and the look, so nothing changed. Fix each finding below, or call explore_frame and put it as an exploring frame.",
  off: "off: this easel cannot draw pictures. Read the document with get_frame.",
  badImage:
    "badImage: the image is not a PNG, JPEG or WebP of at most {maxSide} px on a side and {maxPixels} pixels ({reason}), so nothing was written. Send a PNG, JPEG or WebP in those limits.",
  unreadable:
    "unreadable: each pair of colors below is hard to read, so nothing was written. Change those values, then set the look again.",
  none: "none: the look has no change to undo.",
  invalid:
    "invalid: a text below is wrong, so nothing was written. Fix each one, then set the texts again.",
  wrongState: "wrongState: the request is {state} now, so nothing was written.",
  closed: "wrongState: a viewer closed the request, so nothing was written. Stop the work on it.",
  lost: "lost: the claim is not yours now (its lease ended), so nothing was written. Stop this work, and call next_request.",
  last: "last: that is the last owner. Make another owner first.",
  single:
    "single: this easel is for one person, and an approve here cannot make a user or an owner. The person approves the code in the CLI.",
  theirs:
    "theirs: the code asks to sign a browser in as a user that is there. Only that user can sign that browser in, with easel open. Deny the code if that user did not ask.",
  notLive:
    "notLive: build {live} is live, not the build that you gave. Resolve it after that build deploys.",
  needsBuild:
    "needsBuild: a build request needs the live build that holds the change, so nothing was written. Ship the change, then resolve it again with build.",
  failing: "failing: the error was seen on build {seen}, so the fix did not hold.",
  held: "held: a person has this error group. Leave it to them.",
  empty: "empty: no request waits. Call next_request again.",
  changed:
    "changed: the canvas is at revision {rev} now, so nothing was written. Read it again with list_frames or check_layout, and make your change with that rev.",
  placed:
    "placed: frame {id} has an exact place, so no frame goes after or below it, and nothing was written. Give x and y, or move {id} into a section first.",
};

const listed = z.object({
  findings: z.array(z.union([findingShape, textFinding])).optional(),
  fails: z.array(pair).optional(),
  more: z.number().optional(),
  layout: layout.optional(),
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
    const read = listed.safeParse(input.value).data ?? {};
    const { findings = [], fails = [], more = 0 } = read;
    const laid = read.layout ?? { findings: [], more: 0 };
    const lines = [
      headText.run({ input }),
      ...findings.map((f) =>
        "key" in f
          ? `${f.key}: ${f.what}. Fix: ${f.fix}`
          : `${f.file ?? "frame"}:${f.line}:${f.col} ${f.rule} ${f.what}. Fix: ${f.fix}`,
      ),
      ...fails.map(
        (p) =>
          `${p.theme ? `${p.theme}: ` : ""}${p.text} on ${p.on}: ${p.ratio}:1, needs ${p.min}:1 (${p.where})`,
      ),
      ...(more > 0 ? [`and ${more} more`] : []),
      ...laid.findings.map((f) => findingLine.parse(f)),
      ...(laid.more > 0 ? [`and ${laid.more} more on the page`] : []),
    ];

    return lines.join("\n");
  },
});
