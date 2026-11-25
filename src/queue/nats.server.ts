import { JetStreamApiError, jetstream } from "@nats-io/jetstream";
import {
  AuthorizationError,
  ConnectionError,
  NoRespondersError,
  PermissionViolationError,
  connect,
  nkeyAuthenticator,
  nkeys,
  wsconnect,
} from "@nats-io/transport-node";
import type { NatsConnection } from "@nats-io/transport-node";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { scrub } from "./github.server";
import { natsTimeout } from "./settings";

export const checkStream = "easel-check-only";

export const streamDoesNotMatch = 10060;

const natsRequest = z.object({
  url: z.string(),
  seed: z.string(),
  subject: z.string(),
  inbox: z.string(),
  body: z.string(),
  id: z.string().optional(),
  stream: z.string().optional(),
});

export const userKeyOf = operation({
  label: "queue.userKeyOf",
  input: z.string(),
  run: (_, { input: seed }) => {
    try {
      const pair = nkeys.fromSeed(new TextEncoder().encode(seed));
      const key = pair.getPublicKey();
      return key.startsWith("U") ? key : null;
    } catch {
      return null;
    }
  },
});

const causesOf = operation({
  label: "queue.natsCausesOf",
  input: z.unknown(),
  run: (_, { input: error }) => {
    const causes = [error];
    for (let at = error; at instanceof Error && causes.length < 4; at = at.cause) {
      causes.push(at.cause);
    }
    return causes;
  },
});

const connectionCauseOf = operation({
  label: "queue.natsConnectionCauseOf",
  input: z.object({ error: z.unknown(), seed: z.string() }),
  depends: { scrub },
  run: ({ scrub }, { input: { error, seed } }) => {
    if (error instanceof AuthorizationError) return "key: NATS does not let this key in";
    if (error instanceof ConnectionError) return "network: NATS cannot be reached";
    const said = error instanceof Error ? error.message : String(error);

    return scrub.run({ input: { text: `nats: ${said}`, token: seed } });
  },
});

const causeOf = operation({
  label: "queue.natsCauseOf",
  input: z.object({
    error: z.unknown(),
    subject: z.string(),
    prefix: z.string(),
    seed: z.string(),
  }),
  depends: { causesOf, connectionCauseOf },
  run: ({ causesOf, connectionCauseOf }, { input: { error, subject, prefix, seed } }) => {
    const causes = causesOf.run({ input: error });
    const inbox = z.object({ operation: z.literal("subscription") });
    if (
      causes.some((one) => one instanceof PermissionViolationError && inbox.safeParse(one).success)
    ) {
      return `inbox: this key may not read the replies on ${prefix}.>`;
    }
    if (causes.some((one) => one instanceof PermissionViolationError)) {
      return `denied: this key may not publish to ${subject}`;
    }
    if (causes.some((one) => one instanceof NoRespondersError)) {
      return `no stream: no JetStream stream takes ${subject}`;
    }

    return connectionCauseOf.run({ input: { error, seed } });
  },
});

const answerOf = operation({
  label: "queue.natsAnswerOf",
  input: z.object({
    answer: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("acked"), duplicate: z.boolean() }),
      z.object({ kind: z.literal("error"), error: z.unknown() }),
    ]),
    subject: z.string(),
    prefix: z.string(),
    seed: z.string(),
  }),
  depends: { causeOf },
  run: ({ causeOf }, { input: { answer, ...where } }) => {
    if (answer.kind === "acked") return answer;
    if (answer.error instanceof JetStreamApiError) {
      return { kind: "rejected" as const, code: answer.error.code, message: answer.error.message };
    }

    return {
      kind: "failed" as const,
      cause: causeOf.run({ input: { error: answer.error, ...where } }),
    };
  },
});

export const natsCall = operation({
  label: "queue.natsCall",
  input: natsRequest,
  depends: { userKeyOf, answerOf, natsTimeout },
  run: async ({ userKeyOf, answerOf, natsTimeout }, { input, clock, signal }) => {
    const { url, seed, subject } = input;
    if (userKeyOf.run({ input: seed }) === null) {
      return { kind: "failed" as const, cause: "seed: the seed is not the seed of a user nkey" };
    }

    const stop = new AbortController();
    const late = clock.sleep(natsTimeout, AbortSignal.any([signal, stop.signal])).then(
      () => true,
      () => false,
    );
    const opened: { connection: NatsConnection | null; late: boolean } = {
      connection: null,
      late: false,
    };
    const options = {
      servers: url,
      authenticator: nkeyAuthenticator(new TextEncoder().encode(seed)),
      inboxPrefix: input.inbox,
      name: "easel-dispatch",
      timeout: natsTimeout,
      reconnect: false,
    };
    const published = (/^wss?:/.test(url) ? wsconnect(options) : connect(options))
      .then((connection) => {
        opened.connection = connection;
        if (opened.late) return connection.close().then(() => null);
        const js = jetstream(connection, { timeout: natsTimeout });
        return js.publish(subject, input.body, {
          timeout: natsTimeout,
          ...(input.id ? { msgID: input.id } : {}),
          ...(input.stream ? { expect: { streamName: input.stream } } : {}),
        });
      })
      .then(
        (ack) => ({ kind: "acked" as const, duplicate: ack?.duplicate ?? false }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
    const first = await Promise.race([published, late.then((ran) => (ran ? "late" : "stopped"))]);
    stop.abort();
    if (first === "late") {
      opened.late = true;
      await opened.connection?.close().catch(() => undefined);
      return { kind: "failed" as const, cause: "timeout: NATS did not ack in 10 s" };
    }
    const answer = first === "stopped" ? await published : first;
    await opened.connection?.close().catch(() => undefined);

    return answerOf.run({ input: { answer, subject, prefix: input.inbox, seed } });
  },
});
