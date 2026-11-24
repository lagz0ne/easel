import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import {
  channelApi,
  channelInfo,
  channelKind,
  defaultInbox,
  defaultTrigger,
  githubChannelSet,
  natsChannelSet,
} from "./channels";
import { githubCall, githubMessage } from "./github.server";
import { checkStream, natsCall, streamDoesNotMatch, userKeyOf } from "./nats.server";

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

const addedChannelColumns = [
  ["url", "TEXT NOT NULL DEFAULT ''"],
  ["subject", "TEXT NOT NULL DEFAULT ''"],
  ["canvases", "TEXT NOT NULL DEFAULT '[]'"],
  ["inbox", "TEXT NOT NULL DEFAULT ''"],
] as const;

export const channelColumns =
  "name, kind, repo, label, trigger, token, url, subject, inbox, canvases, created";

export const storedChannel = z.object({
  name: z.string(),
  kind: channelKind,
  repo: z.string(),
  label: z.string(),
  trigger: z.string(),
  token: z.string(),
  url: z.string(),
  subject: z.string(),
  inbox: z.string(),
  canvases: z.array(z.string()),
  created: z.number(),
});

export const channelRow = storedChannel.extend({
  canvases: z
    .string()
    .transform((text): unknown => JSON.parse(text))
    .pipe(z.array(z.string())),
});

export const makeDispatchTables = operation({
  label: "queue.makeDispatchTables",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) => {
    const db = connection.db.$client;
    db.exec(dispatchSchema);
    const columns = db.query("PRAGMA table_info(queue_channels)").all();
    for (const [column, type] of addedChannelColumns) {
      if (!columns.some((c) => z.object({ name: z.literal(column) }).safeParse(c).success)) {
        db.exec(`ALTER TABLE queue_channels ADD COLUMN ${column} ${type}`);
      }
    }
  },
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

const checkNats = operation({
  label: "queue.checkNats",
  input: natsChannelSet,
  depends: { natsCall },
  run: async ({ natsCall }, { input }) => {
    const places = input.canvases?.length ? input.canvases : ["check"];
    for (const place of places) {
      const tried = await natsCall.run({
        input: {
          url: input.url,
          seed: input.seed,
          subject: `${input.subject}.${place}`,
          inbox: input.inbox ?? defaultInbox,
          body: "",
          stream: checkStream,
        },
      });
      if (tried.kind === "failed") {
        return { kind: "refused" as const, status: 0, message: tried.cause };
      }
      if (tried.kind === "rejected" && tried.code !== streamDoesNotMatch) {
        return {
          kind: "refused" as const,
          status: 0,
          message: `jetstream ${tried.code}: ${tried.message}`,
        };
      }
    }

    return { kind: "saved" as const };
  },
});

const saveChannel = operation({
  label: "queue.saveChannel",
  input: z.object({
    name: z.string(),
    kind: channelKind,
    repo: z.string(),
    label: z.string(),
    trigger: z.string(),
    token: z.string(),
    url: z.string(),
    subject: z.string(),
    inbox: z.string(),
    canvases: z.array(z.string()),
  }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input, clock }) =>
    void connection.db.$client
      .query(
        `INSERT INTO queue_channels (${channelColumns})
         VALUES ($name, $kind, $repo, $label, $trigger, $token, $url, $subject, $inbox, $canvases,
           $now)
         ON CONFLICT (name) DO UPDATE SET label = excluded.label,
           trigger = excluded.trigger, token = excluded.token,
           created = CASE WHEN kind = excluded.kind AND repo = excluded.repo
             AND url = excluded.url AND subject = excluded.subject
             THEN created ELSE excluded.created END,
           kind = excluded.kind, repo = excluded.repo, url = excluded.url,
           subject = excluded.subject, inbox = excluded.inbox, canvases = excluded.canvases`,
      )
      .run({
        $name: input.name,
        $kind: input.kind,
        $repo: input.repo,
        $label: input.label,
        $trigger: input.trigger,
        $token: input.token,
        $url: input.url,
        $subject: input.subject,
        $inbox: input.inbox,
        $canvases: JSON.stringify(input.canvases),
        $now: clock.currentTimeMillis(),
      }),
});

const setGithub = operation({
  label: "queue.setGithub",
  input: githubChannelSet,
  depends: { checkRepo, saveChannel },
  run: async ({ checkRepo, saveChannel }, { input }) => {
    const checked = await checkRepo.run({ input });
    if (checked.kind !== "saved") return checked;

    const { trigger, ...rest } = input;
    await saveChannel.run({
      input: {
        ...rest,
        trigger: trigger ?? defaultTrigger,
        url: "",
        subject: "",
        inbox: "",
        canvases: [],
      },
    });
    return checked;
  },
});

const setNats = operation({
  label: "queue.setNats",
  input: natsChannelSet,
  depends: { checkNats, saveChannel },
  run: async ({ checkNats, saveChannel }, { input }) => {
    const checked = await checkNats.run({ input });
    if (checked.kind !== "saved") return checked;

    const { seed, canvases, inbox, ...rest } = input;
    await saveChannel.run({
      input: {
        ...rest,
        repo: "",
        label: "",
        trigger: "",
        token: seed,
        inbox: inbox ?? defaultInbox,
        canvases: [...new Set(canvases ?? [])],
      },
    });
    return checked;
  },
});

export const setChannel = operation({
  label: "channel.set.do",
  input: channelApi["channel.set"].input,
  depends: { setGithub, setNats },
  run: async ({ setGithub, setNats }, { input }) => {
    switch (input.kind) {
      case "github":
        return setGithub.run({ input });
      case "nats":
        return setNats.run({ input });
    }
  },
});

export const readChannels = operation({
  label: "queue.readChannels",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) =>
    connection.db.$client
      .query(`SELECT ${channelColumns} FROM queue_channels ORDER BY name`)
      .all()
      .map((row) => channelRow.parse(row)),
});

const limitsOf = operation({
  label: "queue.channelLimitsOf",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: name }) =>
    z
      .object({ running: z.number(), perDay: z.number() })
      .parse(
        connection.db.$client
          .query(
            "SELECT max_running AS running, max_per_day AS perDay FROM queue_channels WHERE name = $name",
          )
          .get({ $name: name }),
      ),
});

const infoOf = operation({
  label: "queue.channelInfoOf",
  input: storedChannel,
  depends: { userKeyOf, limitsOf },
  run: async ({ userKeyOf, limitsOf }, { input: { token, ...stored } }) => {
    const { name, kind, created } = stored;
    switch (kind) {
      case "github": {
        const { repo, label, trigger } = stored;
        return channelInfo.parse({
          name,
          kind,
          repo,
          label,
          trigger,
          tokenEnd: token.slice(-4),
          created,
        });
      }
      case "nats": {
        const { url, subject, inbox, canvases } = stored;
        const key = userKeyOf.run({ input: token }) ?? "";
        const limits = await limitsOf.run({ input: name });
        return channelInfo.parse({
          name,
          kind,
          url,
          subject,
          inbox,
          canvases,
          key,
          limits,
          created,
        });
      }
    }
  },
});

export const listChannels = operation({
  label: "channel.list.do",
  input: channelApi["channel.list"].input,
  depends: { readChannels, infoOf },
  run: async ({ readChannels, infoOf }) => ({
    kind: "listed" as const,
    channels: await Promise.all(
      (await readChannels.run()).map((stored) => infoOf.run({ input: stored })),
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
