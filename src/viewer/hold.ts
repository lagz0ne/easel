import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { queue } from "@/queue";
import { hold } from "@/queue/holds";
import type { Hold } from "@/queue/holds";

import { signedInAs } from "./gate";

const signedInName = tag<string>({ label: "viewer.signedInName" });

const signedInOwner = tag<string>({ label: "viewer.signedInOwner" });

export const personOfPage = resource({
  label: "viewer.personOfPage",
  config: { name: signedInName.required, owner: signedInOwner.required },
  depends: { me: signedInAs.controller },
  factory: ({ me }, ctx) => {
    const { name, owner } = ctx.config;
    const signedIn = name === "" ? null : { name, owner: owner === "true" };
    queueMicrotask(() => me.set(signedIn));

    return signedIn;
  },
});

const clockShape = { hour: "2-digit", minute: "2-digit", hour12: false } as const;

const agreementWords = operation({
  label: "viewer.agreementWords",
  input: z.object({ person: z.boolean(), author: z.string() }),
  run: (_, { input: { person, author } }) =>
    person
      ? {
          mark: "Waits for you to agree",
          short: "Agree?",
          title: "Waits for you to agree",
          text: `${author} asked for this. No agent starts until you agree.`,
          asks: true,
        }
      : {
          mark: "Waits for the owner",
          short: "Owner",
          title: "Waits for the owner to agree",
          text: "Then an agent starts on it. You can still correct it.",
          asks: false,
        },
});

const limitWords = operation({
  label: "viewer.limitWords",
  input: hold.options[1],
  run: (_, { input: one }) =>
    one.which === "running"
      ? {
          mark: "Waits for the limit",
          short: "Limit",
          title: `Waits for the limit: ${one.count} of ${one.limit} agents run`,
          text: "It starts when one of them ends. Set the limits with easel channel limits.",
          asks: false,
        }
      : {
          mark: "Waits for the limit",
          short: "Limit",
          title: `Waits for the limit: ${one.count} of ${one.limit} starts today`,
          text: "It starts after 00:00 UTC, or when you raise the limit.",
          asks: false,
        },
});

export const holdWords = operation({
  label: "viewer.holdWords",
  input: z.object({ hold, person: z.boolean(), author: z.string() }),
  depends: { agreementWords, limitWords },
  run: ({ agreementWords, limitWords }, { input: { hold: one, person, author } }) => {
    switch (one.kind) {
      case "agreement":
        return agreementWords.run({ input: { person, author } });
      case "limit":
        return limitWords.run({ input: one });
      case "failed":
        return {
          mark: "Not started",
          short: "Not started",
          title: "The agent did not start",
          text: `Easel tries again at ${new Date(one.retryAt).toLocaleTimeString([], clockShape)}. easel deliveries shows the cause.`,
          asks: false,
        };
      case "refused":
        return {
          mark: "Refused",
          short: "Refused",
          title: "The channel refused the request",
          text: "It still waits for an agent that asks. easel deliveries shows the cause.",
          asks: false,
        };
      case "silent":
        return {
          mark: "No starter",
          short: "No starter",
          title: `The agent starter does not answer since ${new Date(one.since).toLocaleTimeString([], clockShape)}`,
          text: "Easel sent the request. No agent starts until the starter answers.",
          asks: false,
        };
    }
  },
});

export type HoldWords = ReturnType<typeof holdWords.run> & { kind: Hold["kind"] };

const holdCanvas = tag<string>({ label: "viewer.holdCanvas" });

export const holdsHere = resource({
  label: "viewer.holdsHere",
  config: { canvas: holdCanvas.required },
  depends: (c) => ({
    rows: frames.board.holds.where({ canvas: c.canvas }),
    asks: frames.board.requests.where({ canvas: c.canvas }),
    me: signedInAs,
    holdWords,
  }),
  factory: ({ rows, asks, me, holdWords }): ReadonlyMap<string, HoldWords> => {
    const person = me?.owner === true;
    const authors = new Map(asks.get().map((r) => [r.id, r.author]));
    return new Map(
      rows.get().map((one) => [
        one.id,
        {
          kind: one.hold.kind,
          ...holdWords.run({
            input: { hold: one.hold, person, author: authors.get(one.id) ?? "" },
          }),
        },
      ]),
    );
  },
});

export const agreeing = data<{ id: string; step: "sending" | "failed" } | null>({
  label: "viewer.agreeing",
  initial: null,
});

export const agreeTo = operation({
  label: "viewer.agreeTo",
  input: z.object({ canvas: z.string(), n: z.number(), id: z.string() }),
  depends: { call: queue.starts["request.agree"], step: agreeing.controller },
  run: async ({ call, step }, { input }) => {
    step.set({ id: input.id, step: "sending" });
    const reply = await call.settle({ input: { canvas: input.canvas, n: input.n } });
    const agreed = reply.status === "success" && reply.value.kind === "agreed";
    step.set(agreed ? null : { id: input.id, step: "failed" });

    return agreed;
  },
});
