import { jetstream } from "@nats-io/jetstream";
import { connect, nkeyAuthenticator } from "@nats-io/transport-node";
import { resource } from "@tinkered/core";

import { adapterLog } from "./log";
import {
  adapterExit,
  agentMode,
  channel,
  maxPerDay,
  maxRunning,
  natsInbox,
  natsSeed,
  natsUrl,
  requestConsumer,
  requestStream,
  workspaceDir,
} from "./settings";

export type RequestMessage = {
  readonly data: Uint8Array;
  readonly subject: string;
  readonly seq: number;
  ack(): void;
  nak(millis?: number): void;
  term(reason?: string): void;
};

export type RequestSource = {
  next(expiresMs: number): Promise<RequestMessage | null>;
};

export const requestSource = resource({
  label: "paseoAdapter.requestSource",
  target: "scope",
  depends: {
    url: natsUrl,
    seed: natsSeed,
    inbox: natsInbox,
    stream: requestStream,
    consumerName: requestConsumer,
    exit: adapterExit,
    log: adapterLog,
    maxRunning,
    maxPerDay,
    channel,
    mode: agentMode,
    workspace: workspaceDir,
  },
  factory: async (deps, ctx): Promise<RequestSource> => {
    const { url, seed, inbox, stream, consumerName, exit, log } = deps;
    const nc = await connect({
      servers: url,
      authenticator: nkeyAuthenticator(new TextEncoder().encode(seed.trim())),
      inboxPrefix: inbox,
      name: "easel-paseo-adapter",
      maxReconnectAttempts: -1,
    }).catch((error: unknown) => {
      log.write("connect-failed", {
        url,
        cause: error instanceof Error ? error.message : String(error),
      });
      return ctx.raise("ConnectFailed", { url });
    });
    ctx.defer(async () => {
      if (!nc.isClosed()) await nc.drain();
      log.write("stopped");
    });

    const consumer = await jetstream(nc)
      .consumers.get(stream, consumerName)
      .catch((error: unknown) => {
        log.write("bind-failed", {
          stream,
          consumer: consumerName,
          cause: error instanceof Error ? error.message : String(error),
        });
        return ctx.raise("BindFailed", { stream, consumer: consumerName });
      });
    const bound = await consumer.info(true);
    log.write("bound", {
      url,
      stream,
      consumer: consumerName,
      maxAckPending: bound.config.max_ack_pending ?? null,
      maxRunning: deps.maxRunning,
      maxPerDay: deps.maxPerDay,
      channel: deps.channel,
      mode: deps.mode,
      workspace: deps.workspace,
    });

    void nc.closed().then((error) => {
      if (ctx.closing.aborted) return;
      log.write("closed", { cause: error ? error.message : "the connection closed" });
      exit(1);
    });

    return { next: (expiresMs) => consumer.next({ expires: expiresMs }) };
  },
});
