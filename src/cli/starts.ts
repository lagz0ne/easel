import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "@/access/contract";
import { queue } from "@/queue";
import { startsContracts, startsSuccessKinds } from "@/queue/starts";

import { callDeadline, exits, faultExit } from "./exit";
import { say } from "./output";

export const startsCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agree"), canvas: z.string(), n: z.string() }),
  z.object({
    kind: z.literal("limits"),
    name: z.string(),
    running: z.string().optional(),
    perDay: z.string().optional(),
  }),
  z.object({
    kind: z.literal("report"),
    name: z.string(),
    running: z.string().optional(),
    today: z.string().optional(),
    at: z.string().optional(),
    started: z.string().optional(),
    agent: z.string().optional(),
    failed: z.string().optional(),
    cause: z.string().optional(),
    retry: z.string().optional(),
  }),
]);

export type StartsCommand = z.infer<typeof startsCommand>;

const address = z.enum(["request.agree", "channel.limits", "channel.report"]);

const whole = z.string().regex(/^\d+$/, "a whole number").transform(Number);

const usage = operation({
  label: "cli.startsUsage",
  input: z.string(),
  depends: { say },
  run: ({ say }, { input: text }) => {
    say.run({ input: { json: { usage: text }, text, error: true } });

    return exits.usage;
  },
});

const invalid = operation({
  label: "cli.startsInvalid",
  input: z.array(z.object({ path: z.array(z.unknown()), message: z.string() })),
  depends: { say },
  run: ({ say }, { input: issues }) => {
    const why = issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
    const text = `the input is wrong: ${why.join("; ")}`;
    say.run({ input: { json: { invalid: why }, text, error: true } });

    return exits.invalid;
  },
});

const startsExitOf = operation({
  label: "cli.startsExitOf",
  input: z.object({ address, kind: z.string() }),
  run: (_, { input }) => {
    const list: readonly string[] = startsSuccessKinds[input.address];

    return list.some((kind) => kind === input.kind) ? exits.ok : exits.no;
  },
});

const startsDeadline = operation({
  label: "cli.startsDeadline",
  input: address,
  run: (_, { input, clock, signal }) => {
    const stop = new AbortController();
    const late = loginApi.fault.make(input, "link", { late: callDeadline }, undefined);
    clock.sleep(callDeadline, AbortSignal.any([signal, stop.signal])).then(
      () => stop.abort(late),
      () => undefined,
    );

    return stop;
  },
});

const startsFault = operation({
  label: "cli.startsFault",
  input: z.unknown(),
  depends: { faultExit },
  run: ({ faultExit }, { input: error }) => {
    const known = queue.starts.fault.is(error)
      ? loginApi.fault.make(
          error.address,
          error.fault,
          error.payload,
          error.traceId,
          error.execution,
        )
      : error;

    return faultExit.run({ input: known });
  },
});

const notPersonText =
  "notPerson: only an owner (the person) does this. An agent cannot. Nothing was written.";

const agreeText = operation({
  label: "cli.agreeText",
  input: z.object({
    answer: startsContracts["request.agree"].output,
    canvas: z.string(),
    n: z.number(),
  }),
  run: (_, { input: { answer, canvas, n } }) => {
    switch (answer.kind) {
      case "agreed":
        return {
          text: `agreed: ${canvas}#${n} goes to the agents now. A new text of a viewer needs a new agreement.`,
          error: false,
        };
      case "wrongState":
        return {
          text: `wrongState: ${canvas}#${n} is ${answer.state}. Only a request that waits or is in work takes an agreement.`,
          error: true,
        };
      case "gone":
        return { text: "gone: no such request. Nothing was written.", error: true };
      case "notPerson":
        return { text: notPersonText, error: true };
    }
  },
});

const agree = operation({
  label: "cli.agree",
  input: startsCommand.options[0],
  depends: {
    say,
    usage,
    invalid,
    agreeText,
    exitOf: startsExitOf,
    startsFault,
    deadline: startsDeadline,
    call: queue.starts["request.agree"],
  },
  run: async (deps, { input }) => {
    const { say, usage, invalid, agreeText, exitOf, startsFault, deadline, call } = deps;
    const n = whole.safeParse(input.n);
    if (!n.success) {
      return usage.run({
        input: "the number of a request is 1 or more: `easel requests` prints them",
      });
    }

    const parsed = startsContracts["request.agree"].input.safeParse({
      canvas: input.canvas,
      n: n.data,
    });
    if (!parsed.success) return invalid.run({ input: parsed.error.issues });

    const stop = deadline.run({ input: "request.agree" });
    const reply = await call.settle({ input: parsed.data, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return startsFault.run({ input: reply.reason });
    if (reply.status === "failed") return startsFault.run({ input: reply.error });

    const answer = reply.value;
    const told = agreeText.run({ input: { answer, ...parsed.data } });
    say.run({ input: { json: answer, ...told } });

    return exitOf.run({ input: { address: "request.agree", kind: answer.kind } });
  },
});

const limitsText = operation({
  label: "cli.limitsText",
  input: z.object({ answer: startsContracts["channel.limits"].output, name: z.string() }),
  run: (_, { input: { answer, name } }) => {
    switch (answer.kind) {
      case "saved":
        return {
          text: `saved: ${name} starts at most ${answer.limits.running} agents at the same time, and ${answer.limits.perDay} in a UTC day. Its starter reads them within 30 s.`,
          error: false,
        };
      case "gone":
        return { text: "gone: no such channel. Nothing was written.", error: true };
      case "notNats":
        return {
          text: "notNats: only a nats channel has a starter and limits. Nothing was written.",
          error: true,
        };
      case "notPerson":
        return { text: notPersonText, error: true };
    }
  },
});

const limits = operation({
  label: "cli.limits",
  input: startsCommand.options[1],
  depends: {
    say,
    usage,
    invalid,
    limitsText,
    exitOf: startsExitOf,
    startsFault,
    deadline: startsDeadline,
    call: queue.starts["channel.limits"],
  },
  run: async (deps, { input }) => {
    const { say, usage, invalid, limitsText, exitOf, startsFault, deadline, call } = deps;
    const running = whole.optional().safeParse(input.running);
    const perDay = whole.optional().safeParse(input.perDay);
    if (!running.success || !perDay.success) {
      return usage.run({ input: "--running and --per-day take a whole number" });
    }

    const parsed = startsContracts["channel.limits"].input.safeParse({
      name: input.name,
      ...(running.data === undefined ? {} : { running: running.data }),
      ...(perDay.data === undefined ? {} : { perDay: perDay.data }),
    });
    if (!parsed.success) return invalid.run({ input: parsed.error.issues });

    const stop = deadline.run({ input: "channel.limits" });
    const reply = await call.settle({ input: parsed.data, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return startsFault.run({ input: reply.reason });
    if (reply.status === "failed") return startsFault.run({ input: reply.error });

    const answer = reply.value;
    say.run({
      input: { json: answer, ...limitsText.run({ input: { answer, name: input.name } }) },
    });

    return exitOf.run({ input: { address: "channel.limits", kind: answer.kind } });
  },
});

const reportCall = operation({
  label: "cli.reportCall",
  input: startsCommand.options[2],
  run: (_, { input }) => {
    const { name: channel } = input;
    if (input.started !== undefined) {
      return { kind: "started" as const, channel, ref: input.started, agent: input.agent };
    }
    if (input.failed !== undefined) {
      const retryMs = whole.safeParse(input.retry);
      return {
        kind: "failed" as const,
        channel,
        ref: input.failed,
        cause: input.cause,
        retryMs: retryMs.success ? retryMs.data : input.retry,
      };
    }

    const running = whole.safeParse(input.running);
    const today = whole.safeParse(input.today);
    return {
      kind: "state" as const,
      channel,
      running: running.success ? running.data : input.running,
      today: today.success ? today.data : input.today,
      at: input.at ?? null,
    };
  },
});

const report = operation({
  label: "cli.report",
  input: startsCommand.options[2],
  depends: {
    say,
    invalid,
    reportCall,
    exitOf: startsExitOf,
    startsFault,
    deadline: startsDeadline,
    call: queue.starts["channel.report"],
  },
  run: async (deps, { input }) => {
    const { say, invalid, reportCall, exitOf, startsFault, deadline, call } = deps;
    const parsed = startsContracts["channel.report"].input.safeParse(reportCall.run({ input }));
    if (!parsed.success) return invalid.run({ input: parsed.error.issues });

    const stop = deadline.run({ input: "channel.report" });
    const reply = await call.settle({ input: parsed.data, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return startsFault.run({ input: reply.reason });
    if (reply.status === "failed") return startsFault.run({ input: reply.error });

    const answer = reply.value;
    const said =
      answer.kind === "noted"
        ? {
            text: `noted: the limits are ${answer.limits.running} at the same time and ${answer.limits.perDay} in a day`,
            error: false,
          }
        : {
            text:
              answer.kind === "gone"
                ? "gone: no such channel. Nothing was written."
                : "notNats: only a nats channel has a starter. Nothing was written.",
            error: true,
          };
    say.run({ input: { json: answer, ...said } });

    return exitOf.run({ input: { address: "channel.report", kind: answer.kind } });
  },
});

export const startsRun = operation({
  label: "cli.starts",
  input: startsCommand,
  depends: { agree, limits, report },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "agree":
        return ops.agree.run({ input });
      case "limits":
        return ops.limits.run({ input });
      case "report":
        return ops.report.run({ input });
    }
  },
});
