import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { AckPolicy, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect, nkeyAuthenticator, nkeys } from "@nats-io/transport-node";
import type { NatsConnection } from "@nats-io/transport-node";
import { z } from "zod";

export const stream = "EASEL_REQUESTS";
export const consumer = "paseo";
const inbox = "_INBOX_easel_paseo";
const root = join(import.meta.dirname, "..", "..");

function natsBinary() {
  const found =
    process.env.NATS_SERVER ??
    Bun.which("nats-server") ??
    join(homedir(), ".local/bin/nats-server");
  if (!existsSync(found)) {
    throw new Error("the adapter tests need nats-server 2.10 or later on the PATH, or NATS_SERVER");
  }
  return found;
}

async function portOf(dir: string, pid: number) {
  for (let i = 0; i < 400; i++) {
    const file = readdirSync(dir).find((name) => name.endsWith(`_${pid}.ports`));
    if (file) {
      const read = z
        .object({ nats: z.array(z.string()).min(1) })
        .safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      if (read.success) return Number(new URL(read.data.nats[0] ?? "").port);
    }
    await Bun.sleep(25);
  }
  throw new Error("nats-server did not start in 10 s");
}

const serverConfig = (dir: string, admin: string, paseo: string) => `
listen: 127.0.0.1:-1
ports_file_dir: "${dir}"
jetstream { store_dir: "${join(dir, "js")}" }
authorization {
  users: [
    { nkey: ${admin} }
    {
      nkey: ${paseo}
      permissions: {
        publish: { allow: [
          "$JS.API.INFO"
          "$JS.API.STREAM.INFO.${stream}"
          "$JS.API.CONSUMER.INFO.${stream}.${consumer}"
          "$JS.API.CONSUMER.MSG.NEXT.${stream}.${consumer}"
          "$JS.ACK.${stream}.${consumer}.>"
        ] }
        subscribe: { allow: ["${inbox}.>"] }
      }
    }
  ]
}`;

async function hubLikeStream(nc: NatsConnection) {
  const jsm = await jetstreamManager(nc);
  await jsm.streams.add({
    name: stream,
    subjects: ["easel.requests.>"],
    retention: "workqueue",
    max_age: 86_400_000_000_000,
    duplicate_window: 3_600_000_000_000,
  });
  await jsm.consumers.add(stream, {
    durable_name: consumer,
    ack_policy: AckPolicy.Explicit,
    ack_wait: 120_000_000_000,
    max_ack_pending: 2,
    max_deliver: -1,
  });
  return jsm;
}

export async function hubNats() {
  const dir = mkdtempSync(join(tmpdir(), "easel-paseo-nats-"));
  const admin = nkeys.createUser();
  const paseo = nkeys.createUser();
  writeFileSync(
    join(dir, "server.conf"),
    serverConfig(dir, admin.getPublicKey(), paseo.getPublicKey()),
  );
  const child = Bun.spawn([natsBinary(), "-c", join(dir, "server.conf")], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const url = `nats://127.0.0.1:${await portOf(dir, child.pid)}`;

  const nc = await connect({ servers: url, authenticator: nkeyAuthenticator(admin.getSeed()) });
  const jsm = await hubLikeStream(nc);
  const js = jetstream(nc);
  const seedFile = join(dir, "easel-paseo.nk");
  writeFileSync(seedFile, `${new TextDecoder().decode(paseo.getSeed())}\n`, { mode: 0o600 });

  const publish = async (canvas: string, body: unknown, id: string) =>
    js.publish(`easel.requests.${canvas}`, typeof body === "string" ? body : JSON.stringify(body), {
      msgID: id,
    });
  const state = async () => {
    const info = await jsm.consumers.info(stream, consumer);
    return { waiting: info.num_pending, unacked: info.num_ack_pending };
  };
  const close = async () => {
    await nc.close().catch(() => undefined);
    child.kill();
    await child.exited;
    rmSync(dir, { recursive: true, force: true });
  };

  return { url, seedFile, seed: new TextDecoder().decode(paseo.getSeed()), publish, state, close };
}

export type HubNats = Awaited<ReturnType<typeof hubNats>>;

const fakeAgent = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  cwd: z.string(),
  labels: z.record(z.string(), z.string()),
});

export function fakePaseo() {
  const dir = mkdtempSync(join(tmpdir(), "easel-fake-paseo-"));
  const bin = join(dir, "paseo");
  const workspaceDir = join(dir, "easel");
  mkdirSync(workspaceDir);
  writeFileSync(
    bin,
    `#!/bin/sh\nexec "${process.execPath}" "${join(root, "tests/support/fake-paseo.ts")}" "$@"\n`,
    { mode: 0o755 },
  );

  const calls = (): string[][] => {
    const file = join(dir, "calls.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => z.array(z.string()).parse(JSON.parse(line)));
  };
  const agents = () => {
    const file = join(dir, "agents.json");
    return existsSync(file) ? z.array(fakeAgent).parse(JSON.parse(readFileSync(file, "utf8"))) : [];
  };
  const setAgents = (list: z.infer<typeof fakeAgent>[]) =>
    writeFileSync(join(dir, "agents.json"), JSON.stringify(list));
  const setPermits = (
    list: Array<{ id: string; agentId: string; name: string; description: string }>,
  ) => writeFileSync(join(dir, "permits.json"), JSON.stringify(list));
  const permits = () => {
    const file = join(dir, "permits.json");
    return existsSync(file)
      ? z.array(z.looseObject({ id: z.string() })).parse(JSON.parse(readFileSync(file, "utf8")))
      : [];
  };
  const failRuns = (on: boolean) =>
    on ? writeFileSync(join(dir, "fail"), "") : rmSync(join(dir, "fail"), { force: true });

  return {
    dir,
    bin,
    workspaceDir,
    calls,
    runs: () => calls().filter((args) => args[0] === "run"),
    agents,
    setAgents,
    setPermits,
    permits,
    denies: () => calls().filter((args) => args[0] === "permit" && args[1] === "deny"),
    failRuns,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export type FakePaseo = ReturnType<typeof fakePaseo>;

const logLine = z.looseObject({ at: z.string(), event: z.string() });

export type LogLine = z.infer<typeof logLine>;

export function startAdapter(nats: HubNats, paseo: FakePaseo, more: Record<string, string> = {}) {
  const stateDir = join(paseo.dir, "state");
  const lines: LogLine[] = [];
  const raw: string[] = [];
  const child = Bun.spawn([process.execPath, join(root, "services/paseo-adapter/main.ts")], {
    env: {
      PATH: process.env.PATH,
      HOME: paseo.dir,
      FAKE_PASEO_DIR: paseo.dir,
      FAKE_PASEO_WORKSPACE_DIR: paseo.workspaceDir,
      EASEL_PASEO_NATS_URL: nats.url,
      EASEL_PASEO_SEED_FILE: nats.seedFile,
      EASEL_PASEO_BIN: paseo.bin,
      EASEL_PASEO_WORKSPACE_DIR: paseo.workspaceDir,
      EASEL_PASEO_STATE_DIR: stateDir,
      EASEL_PASEO_POLL_MS: "100",
      EASEL_PASEO_PERMIT_MS: "100",
      ...more,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const read = async () => {
    let rest = "";
    for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      rest += chunk;
      const parts = rest.split("\n");
      rest = parts.pop() ?? "";
      raw.push(...parts);
      lines.push(...parts.map((line) => logLine.parse(JSON.parse(line))));
    }
  };
  const reading = read();

  const until = async <T>(look: () => T | Promise<T>, what: string, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const seen = await look();
      if (seen) return seen;
      await Bun.sleep(25);
    }
    throw new Error(`${what} did not happen in ${ms} ms; the log: ${raw.join("\n")}`);
  };
  const event = (name: string) => until(() => lines.find((line) => line.event === name), name);
  const stop = async () => {
    child.kill();
    await child.exited;
    await reading;
  };

  return { lines, raw, stateDir, event, until, stop };
}
