import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { jetstreamManager } from "@nats-io/jetstream";
import { connect, nkeyAuthenticator, nkeys } from "@nats-io/transport-node";
import type { NatsConnection } from "@nats-io/transport-node";
import { z } from "zod";

export const stream = "EASEL";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function natsBinary() {
  const named = process.env.NATS_SERVER;
  if (named) return named;
  const found = Bun.which("nats-server") ?? join(homedir(), ".local/bin/nats-server");
  if (!existsSync(found)) {
    throw new Error(
      "the NATS tests need nats-server 2.10 or later: put it on the PATH, or set NATS_SERVER",
    );
  }
  return found;
}

const portsFile = z.object({
  nats: z.array(z.string()).min(1),
  websocket: z.array(z.string()).min(1),
});

export const inbox = "_INBOX_easel_dispatch";

async function portOf(dir: string, pid: number) {
  for (let i = 0; i < 200; i++) {
    const file = readdirSync(dir).find((name) => name.endsWith(`_${pid}.ports`));
    if (file) {
      const read = portsFile.safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      if (read.success) {
        return {
          port: Number(new URL(read.data.nats[0] ?? "").port),
          ws: Number(new URL(read.data.websocket[0] ?? "").port),
        };
      }
    }
    await Bun.sleep(25);
  }
  throw new Error("nats-server did not start in 5 s");
}

export async function natsServer() {
  const dir = mkdtempSync(join(tmpdir(), "easel-nats-"));
  const admin = nkeys.createUser();
  const easel = nkeys.createUser();
  const other = nkeys.createUser();
  const config = (port: number, ws: number) => `
listen: 127.0.0.1:${port}
websocket { listen: "127.0.0.1:${ws}", no_tls: true }
ports_file_dir: "${dir}"
jetstream { store_dir: "${join(dir, "js")}" }
authorization {
  users: [
    { nkey: ${admin.getPublicKey()} }
    {
      nkey: ${easel.getPublicKey()}
      permissions: {
        publish: { allow: ["easel.requests.>"] }
        subscribe: { allow: ["${inbox}.>"] }
      }
    }
  ]
}`;

  let child: ReturnType<typeof Bun.spawn> | null = null;
  let port = -1;
  let ws = -1;
  const up = async () => {
    writeFileSync(join(dir, "server.conf"), config(port, ws));
    const started = Bun.spawn([natsBinary(), "-c", join(dir, "server.conf")], {
      stdout: "ignore",
      stderr: "ignore",
    });
    child = started;
    ({ port, ws } = await portOf(dir, started.pid));
  };
  const down = async () => {
    const running = child;
    child = null;
    if (!running) return;

    running.kill();
    await running.exited;

    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ports"))) {
      rmSync(join(dir, name), { force: true });
    }
  };

  await up();
  const url = `nats://127.0.0.1:${port}`;
  let held: NatsConnection | null = null;
  const adminConnection = async () => {
    if (held && !held.isClosed()) return held;
    held = await connect({ servers: url, authenticator: nkeyAuthenticator(admin.getSeed()) });
    return held;
  };
  const manager = async () => jetstreamManager(await adminConnection());
  await (
    await manager()
  ).streams.add({
    name: stream,
    subjects: ["easel.requests.*"],
    retention: "workqueue",
  });

  const messages = async () => {
    const jsm = await manager();
    const { state } = await jsm.streams.info(stream);
    const out = [];
    for (let seq = state.first_seq; state.messages > 0 && seq <= state.last_seq; seq++) {
      const stored = await jsm.streams.getMessage(stream, { seq });
      if (stored) {
        out.push({
          subject: stored.subject,
          id: stored.header.get("Nats-Msg-Id"),
          body: z.record(z.string(), z.unknown()).parse(JSON.parse(decode(stored.data))),
        });
      }
    }
    return out;
  };

  const silentListener = async (subject: string) => {
    const nc = await adminConnection();
    const sub = nc.subscribe(subject);
    return () => sub.unsubscribe();
  };

  const close = async () => {
    const open = held;
    held = null;
    if (open) await open.close().catch(() => undefined);
    await down();
    rmSync(dir, { recursive: true, force: true });
  };

  return {
    url,
    wsUrl: `ws://127.0.0.1:${ws}/`,
    seed: decode(easel.getSeed()),
    publicKey: easel.getPublicKey(),
    adminSeed: decode(admin.getSeed()),
    strangerSeed: decode(other.getSeed()),
    messages,
    silentListener,
    stop: async () => {
      const open = held;
      held = null;
      if (open) await open.close().catch(() => undefined);
      await down();
    },
    start: up,
    close,
  };
}

export type NatsServer = Awaited<ReturnType<typeof natsServer>>;
