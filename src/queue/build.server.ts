import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { releaseBuild } from "@/release";

import { request } from "./cells";
import type { Request } from "./cells";
import { saveRequest } from "./store.server";

export const buildAuthor = "easel";

export const natsCovers = operation({
  label: "queue.natsCovers",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: canvas }) => {
    const db = connection.db.$client;
    const table = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'queue_channels'")
      .get();
    if (table === null) return false;

    const covered = db
      .query(
        `SELECT 1 FROM queue_channels c WHERE c.kind = 'nats'
           AND (c.canvases = '[]' OR EXISTS (SELECT 1 FROM json_each(c.canvases) WHERE value = $canvas))`,
      )
      .get({ $canvas: canvas });

    return covered !== null;
  },
});

export const buildText = operation({
  label: "queue.buildText",
  input: z.object({
    n: z.number(),
    frameId: z.string().nullable(),
    version: z.number().nullable(),
  }),
  run: (_, { input }) => {
    const where =
      input.frameId === null
        ? "the canvas"
        : `frame ${input.frameId}, version ${input.version ?? "unknown"}`;

    return `Build: change the code of easel so that the live app matches the accepted design of #${input.n} (${where}). Ship the change. When its build is live, resolve this request with that build (easel resolve --build <n>). If you cannot do it, release or decline this request with the reason.`;
  },
});

const versionOf = operation({
  label: "queue.frameVersionOf",
  input: request.pick({ canvas: true, frameId: true, version: true }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) => {
    if (input.frameId === null) return input.version;

    const row = z
      .object({ version: z.number() })
      .nullable()
      .parse(
        connection.db.$client
          .query("SELECT version FROM frames_frames WHERE canvas = $canvas AND id = $id")
          .get({ $canvas: input.canvas, $id: input.frameId }),
      );

    return row?.version ?? input.version;
  },
});

const liveBuildInResult = / Live in build (\d+)\.$/;

const liveBuildOfLastResult = operation({
  label: "queue.liveBuildOfLastResult",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: id }) => {
    const row = z
      .object({ text: z.string().nullable() })
      .nullable()
      .parse(
        connection.db.$client
          .query(
            "SELECT text FROM queue_messages WHERE request = $id AND kind = 'result' ORDER BY created DESC, rowid DESC LIMIT 1",
          )
          .get({ $id: id }),
      );
    const build = row?.text?.match(liveBuildInResult)?.[1];

    return build === undefined ? null : Number(build);
  },
});

export const addBuildRequest = operation({
  label: "queue.addBuildRequest",
  input: request,
  depends: { natsCovers, liveBuildOfLastResult, buildText, versionOf, saveRequest },
  run: async (
    { natsCovers, liveBuildOfLastResult, buildText, versionOf, saveRequest },
    { input, clock, random },
  ) => {
    const accepted: Request = input;
    if (accepted.author === buildAuthor) return false;

    const alreadyLive = await liveBuildOfLastResult.run({ input: accepted.id });
    if (alreadyLive !== null) return false;

    if (!(await natsCovers.run({ input: accepted.canvas }))) return false;

    const version = await versionOf.run({ input: accepted });
    const text = buildText.run({ input: { n: accepted.n, frameId: accepted.frameId, version } });
    const saved = await saveRequest.run({
      input: {
        canvas: accepted.canvas,
        id: random.uuid().replaceAll("-", "").slice(0, 12),
        frameId: accepted.frameId,
        version,
        kit: accepted.kit,
        x: accepted.x,
        y: accepted.y,
        page: accepted.page,
        text,
        key: `build-${accepted.id}`,
        author: buildAuthor,
        person: true,
        message: random.uuid().replaceAll("-", "").slice(0, 12),
        now: clock.currentTimeMillis(),
        shot: null,
      },
    });

    return saved.kind === "added";
  },
});

export const isBuildRequest = operation({
  label: "queue.isBuildRequest",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: id }) => {
    const row = z
      .object({ author: z.string() })
      .nullable()
      .parse(
        connection.db.$client
          .query("SELECT author FROM queue_requests WHERE id = $id")
          .get({ $id: id }),
      );

    return row?.author === buildAuthor;
  },
});

export const buildRule = operation({
  label: "queue.buildRule",
  input: z.object({ id: z.string(), build: z.number().nullable(), text: z.string() }),
  depends: { isBuildRequest, live: releaseBuild },
  run: async ({ isBuildRequest, live }, { input }) => {
    if (input.build === null) {
      const needs = await isBuildRequest.run({ input: input.id });
      return needs ? { kind: "needsBuild" as const } : { kind: "go" as const, text: input.text };
    }

    if (input.build > live) return { kind: "notLive" as const, live };

    return { kind: "go" as const, text: `${input.text} Live in build ${input.build}.` };
  },
});
