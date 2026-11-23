import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { channelApi, channelInfo, channelKind, defaultTrigger } from "./channels";
import { githubCall, githubMessage } from "./github.server";

export const dispatchSchema = `
CREATE TABLE IF NOT EXISTS queue_channels (
  name TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  repo TEXT NOT NULL,
  label TEXT NOT NULL,
  trigger TEXT NOT NULL,
  token TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS queue_deliveries (
  request TEXT NOT NULL,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  period INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  status TEXT NOT NULL,
  cause TEXT,
  ref INTEGER,
  next INTEGER,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE (request, channel, kind, period)
);
CREATE INDEX IF NOT EXISTS queue_deliveries_due ON queue_deliveries (status, next);`;

export const storedChannel = z.object({
  name: z.string(),
  kind: channelKind,
  repo: z.string(),
  label: z.string(),
  trigger: z.string(),
  token: z.string(),
  created: z.number(),
});

export const makeDispatchTables = operation({
  label: "queue.makeDispatchTables",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) => void connection.db.$client.exec(dispatchSchema),
});

const refusalOf = operation({
  label: "queue.refusalOf",
  input: z.object({ status: z.number(), body: z.unknown(), token: z.string() }),
  depends: { githubMessage },
  run: ({ githubMessage }, { input: { status, body, token } }) => ({
    kind: "refused" as const,
    status,
    message: githubMessage.run({ input: { body, token } }),
  }),
});

const checkRepo = operation({
  label: "queue.checkRepo",
  input: z.object({ repo: z.string(), label: z.string(), token: z.string() }),
  depends: { githubCall, refusalOf },
  run: async ({ githubCall, refusalOf }, { input }) => {
    const { repo, label, token } = input;
    const read = await githubCall.run({ input: { token, method: "GET", path: `/repos/${repo}` } });
    if (read.kind !== "answer") {
      return refusalOf.run({
        input: { status: 0, body: { message: `GitHub: ${read.kind}` }, token },
      });
    }
    if (read.status !== 200) {
      return refusalOf.run({ input: { status: read.status, body: read.body, token } });
    }
    if (!z.object({ private: z.literal(true) }).safeParse(read.body).success) {
      return { kind: "public" as const };
    }

    const made = await githubCall.run({
      input: { token, method: "POST", path: `/repos/${repo}/labels`, body: { name: label } },
    });
    if (made.kind !== "answer") {
      return refusalOf.run({
        input: { status: 0, body: { message: `GitHub: ${made.kind}` }, token },
      });
    }
    if (made.status !== 201 && made.status !== 422) {
      return refusalOf.run({ input: { status: made.status, body: made.body, token } });
    }

    return { kind: "saved" as const };
  },
});

export const setChannel = operation({
  label: "channel.set.do",
  input: channelApi["channel.set"].input,
  depends: { checkRepo, connection: bunSqlite.connection },
  run: async ({ checkRepo, connection }, { input, clock }) => {
    const checked = await checkRepo.run({ input });
    if (checked.kind !== "saved") return checked;

    connection.db.$client
      .query(
        `INSERT INTO queue_channels (name, kind, repo, label, trigger, token, created)
         VALUES ($name, $kind, $repo, $label, $trigger, $token, $now)
         ON CONFLICT (name) DO UPDATE SET kind = excluded.kind, label = excluded.label,
           trigger = excluded.trigger, token = excluded.token,
           created = CASE WHEN repo = excluded.repo THEN created ELSE excluded.created END,
           repo = excluded.repo`,
      )
      .run({
        $name: input.name,
        $kind: input.kind,
        $repo: input.repo,
        $label: input.label,
        $trigger: input.trigger ?? defaultTrigger,
        $token: input.token,
        $now: clock.currentTimeMillis(),
      });

    return checked;
  },
});

export const readChannels = operation({
  label: "queue.readChannels",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) =>
    connection.db.$client
      .query(
        "SELECT name, kind, repo, label, trigger, token, created FROM queue_channels ORDER BY name",
      )
      .all()
      .map((row) => storedChannel.parse(row)),
});

export const listChannels = operation({
  label: "channel.list.do",
  input: channelApi["channel.list"].input,
  depends: { readChannels },
  run: async ({ readChannels }) => ({
    kind: "listed" as const,
    channels: (await readChannels.run()).map(({ token, ...rest }) =>
      channelInfo.parse({ ...rest, tokenEnd: token.slice(-4) }),
    ),
  }),
});

export const removeChannel = operation({
  label: "channel.remove.do",
  input: channelApi["channel.remove"].input,
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) => {
    const dropped = connection.db.$client
      .query("DELETE FROM queue_channels WHERE name = $name")
      .run({ $name: input.name });

    return dropped.changes > 0 ? { kind: "removed" as const } : { kind: "gone" as const };
  },
});

export const channelOps = {
  "channel.set": setChannel,
  "channel.list": listChannels,
  "channel.remove": removeChannel,
} as const;
