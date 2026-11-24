import { readFileSync } from "node:fs";

import { jetstream } from "@nats-io/jetstream";
import { connect, nkeyAuthenticator } from "@nats-io/transport-node";

import { adapterLoop } from "./adapter";
import { configFrom } from "./config";
import { log } from "./log";
import { paseoCli } from "./paseo";
import { permitLoop } from "./permits";

const causeOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const config = configFrom(process.env);

const authenticator = nkeyAuthenticator(
  new TextEncoder().encode(readFileSync(config.seedFile, "utf8").trim()),
);

const nc = await connect({
  servers: config.url,
  authenticator,
  inboxPrefix: config.inbox,
  name: "easel-paseo-adapter",
  maxReconnectAttempts: -1,
}).catch((error: unknown) => {
  log("connect-failed", { url: config.url, cause: causeOf(error) });
  process.exit(1);
});

const consumer = await jetstream(nc)
  .consumers.get(config.stream, config.consumer)
  .catch((error: unknown) => {
    log("bind-failed", { stream: config.stream, consumer: config.consumer, cause: causeOf(error) });
    process.exit(1);
  });

const bound = await consumer.info(true);

log("bound", {
  url: config.url,
  stream: config.stream,
  consumer: config.consumer,
  maxAckPending: bound.config.max_ack_pending ?? null,
  maxRunning: config.maxRunning,
  maxPerDay: config.maxPerDay,
  mode: config.mode,
  workspace: config.workspaceDir,
});

let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
    log("stopping", { signal });
  });
}

void nc.closed().then((error) => {
  if (stopping) return;
  log("closed", { cause: error ? causeOf(error) : "the connection closed" });
  process.exit(1);
});

const paseo = paseoCli(config.paseo);

await Promise.all([
  adapterLoop({ consumer, paseo, config })(() => stopping),
  permitLoop({ paseo, config })(() => stopping),
]);

await nc.drain();

log("stopped");
