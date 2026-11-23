import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { framesApi } from "@/frames/contract";
import { kitApi } from "@/kit/contract";
import { answerResult, faultResult } from "@/mcp/server";
import { kindTexts } from "@/mcp/texts";
import { contracts, successLists, tools } from "@/mcp/tools";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const app = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => app.close());
  return app;
}

function kindsOf(schema: z.ZodType): string[] {
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    return schema.options.flatMap((option) => (option instanceof z.ZodType ? kindsOf(option) : []));
  }
  if (!(schema instanceof z.ZodObject)) return [];

  const kind = schema.shape.kind;
  if (kind instanceof z.ZodLiteral) return [...kind.values].map(String);
  if (kind instanceof z.ZodEnum) return kind.options.map(String);
  return [];
}

test("each kind of each tool is a result or a tool error by its call's success list, and an error says what to do", async () => {
  const app = await scope();
  let seen = 0;
  for (const [name, row] of Object.entries(tools)) {
    const success: readonly string[] = [successLists[row.address]].flat();
    for (const kind of kindsOf(contracts[row.address].output)) {
      const ok = success.includes(kind) || success.includes("always");
      const result = app.run(answerResult, { rawInput: { address: row.address, value: { kind } } });
      expect({ name, kind, isError: result.isError }).toEqual({ name, kind, isError: !ok });

      const text = result.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
      if (!ok) {
        expect({ name, kind, told: kindTexts[kind] !== undefined }).toEqual({
          name,
          kind,
          told: true,
        });
      }
      if (!ok) expect(text[0]).toMatch(new RegExp(`^${kind}: `));
      seen++;
    }
  }
  expect(seen).toBeGreaterThan(60);
});

test("an answer's text lists its findings and its pairs in the CLI's form, and fills its fields", async () => {
  const app = await scope();
  const finding = {
    line: 3,
    col: 5,
    rule: "look/color",
    what: "a color off the look",
    fix: "use a token",
  };
  const offKit = app.run(answerResult, {
    rawInput: { address: "frame.put", value: { kind: "offKit", findings: [finding], more: 2 } },
  });
  expect(offKit.content).toEqual([
    {
      type: "text",
      text: [
        kindTexts.offKit,
        "frame:3:5 look/color a color off the look. Fix: use a token",
        "and 2 more",
      ].join("\n"),
    },
  ]);

  const fail = { text: "#777", on: "#fff", ratio: 4.48, min: 4.5, where: "muted on background" };
  const unreadable = app.run(answerResult, {
    rawInput: { address: "look.set", value: { kind: "unreadable", fails: [fail] } },
  });
  expect(unreadable.content).toEqual([
    {
      type: "text",
      text: `${kindTexts.unreadable}\n#777 on #fff: 4.48:1, needs 4.5:1 (muted on background)`,
    },
  ]);

  const big = app.run(answerResult, {
    rawInput: { address: "frame.put", value: { kind: "tooBig", maxBytes: 1048576 } },
  });
  expect(big.content).toEqual([
    {
      type: "text",
      text: "tooBig: it is over 1048576 bytes, so nothing was written. Make it smaller.",
    },
  ]);
  const closed = app.run(answerResult, {
    rawInput: { address: "request.resolve", value: { kind: "wrongState", state: "closed" } },
  });
  expect(closed).toMatchObject({ isError: true, content: [{ text: kindTexts.closed }] });
  const empty = app.run(answerResult, {
    rawInput: { address: "request.next", value: { kind: "empty" } },
  });
  expect(empty).toMatchObject({ isError: false, content: [{ text: kindTexts.empty }] });
});

test("each of the seven faults is one line on what to do next; an error that is no fault is thrown on", async () => {
  const app = await scope();
  const text = (
    kind: "refused" | "failed" | "invalid" | "encode" | "decode" | "missing" | "link",
    payload: unknown,
  ) => {
    const result = app.run(faultResult, {
      input: framesApi.fault.make("canvas.list", kind, payload, "trace-1", "exec-1"),
    });
    expect(result.isError).toBe(true);
    return result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  };
  const failed = "the server failed (trace trace-1): an owner can run show_error with it";

  expect(text("refused", { owner: true })).toBe(
    'refused {"owner":true}: a sign-in needs `easel login`; anything else, ask an owner',
  );
  expect(text("failed", {})).toBe(failed);
  expect(text("encode", { side: "server" })).toBe(failed);
  expect(text("decode", { side: "client" })).toBe(failed);
  expect(text("missing", {})).toBe("this easel has no canvas.list: update easel");
  expect(text("link", { sent: false })).toBe(
    "cannot reach the easel server: check that it runs, then call again",
  );
  expect(text("invalid", [{ path: ["password"], message: "too short" }])).toMatch(
    /^the input is wrong: /,
  );

  const kitFault = app.run(faultResult, {
    input: kitApi.fault.make("look.get", "missing", {}, undefined, undefined),
  });
  expect(kitFault.content).toEqual([
    { type: "text", text: "this easel has no look.get: update easel" },
  ]);
  expect(() => app.run(faultResult, { input: new Error("a bug") })).toThrow("a bug");
});
