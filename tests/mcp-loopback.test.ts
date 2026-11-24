import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { imageContent, mcpFetch } from "@/mcp/server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function withFetch() {
  const asked: string[] = [];
  const scope = await createScope({
    tags: [
      mcpFetch(async (path) => {
        asked.push(path);
        return new Response(null, { status: 404 });
      }),
    ],
    capsules: [exits({ file: process.env.TINKER_EXITS })],
  }).ready;
  closers.push(() => scope.close());
  return { scope, asked };
}

test("the MCP layer fetches an image path of easel's own /api, with its key", async () => {
  const { scope, asked } = await withFetch();

  const content = await scope.run(imageContent, {
    input: { address: "frame.shot", value: { url: "/api/pictures/flow/abc/1?k=key1" } },
  });

  expect(asked).toEqual(["/api/pictures/flow/abc/1?k=key1"]);
  expect(content).toEqual([
    {
      type: "text",
      text: "the image at /api/pictures/flow/abc/1 cannot be fetched (HTTP 404): call again",
    },
  ]);
});

test("an image address that names another host, or is not under /api, is never fetched", async () => {
  const { scope, asked } = await withFetch();

  const urls = ["//example.com/api/x", "https://example.com/api/x", "/install.sh"];
  const answers = await Promise.all(
    urls.map((url) =>
      scope.run(imageContent, { input: { address: "frame.shot", value: { url } } }),
    ),
  );

  expect(answers).toEqual([[], [], []]);
  expect(asked).toEqual([]);
});
