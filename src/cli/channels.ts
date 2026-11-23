import { readFileSync } from "node:fs";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { queue } from "@/queue";
import { channelContracts } from "@/queue/channels";
import { queueContracts } from "@/queue/contract";

import { exits } from "./exit";
import { say } from "./output";
import { queueDeadline, queueExitOf, queueFault } from "./queue";

export const channelCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set"),
    name: z.string(),
    channel: z.string(),
    repo: z.string().optional(),
    label: z.string().optional(),
    trigger: z.string().optional(),
    tokenFile: z.string().optional(),
  }),
  z.object({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("rm"), name: z.string() }),
  z.object({ kind: z.literal("deliveries"), canvas: z.string(), n: z.string() }),
]);

export type ChannelCommand = z.infer<typeof channelCommand>;

const usage = operation({
  label: "cli.channelUsage",
  input: z.string(),
  depends: { say },
  run: ({ say }, { input: text }) => {
    say.run({ input: { json: { usage: text }, text, error: true } });

    return exits.usage;
  },
});

const invalid = operation({
  label: "cli.channelInvalid",
  input: z.array(z.object({ path: z.array(z.unknown()), message: z.string() })),
  depends: { say },
  run: ({ say }, { input: issues }) => {
    const why = issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
    const text = `the input is wrong: ${why.join("; ")}`;
    say.run({ input: { json: { invalid: why }, text, error: true } });

    return exits.invalid;
  },
});

const tokenOf = operation({
  label: "cli.tokenOf",
  input: z.string(),
  run: (_, { input: path }) => {
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      return null;
    }
  },
});

const setCall = operation({
  label: "cli.channelSetCall",
  input: channelCommand.options[0],
  depends: { tokenOf },
  run: ({ tokenOf }, { input }) => {
    if (input.channel !== "github") return { bad: "the kind of a channel is github" };
    if (input.repo === undefined) return { bad: "--repo takes the repository, as acme/design" };
    if (input.label === undefined) return { bad: "--label takes the label of the issues" };
    if (input.tokenFile === undefined) {
      return { bad: "--token-file takes the path of a file that holds the token" };
    }
    const token = tokenOf.run({ input: input.tokenFile });
    if (token === null) return { bad: "--token-file takes the path of a file that can be read" };

    const { name, repo, label, trigger } = input;
    const more = trigger === undefined ? {} : { trigger };

    return { bad: null, call: { name, kind: input.channel, repo, label, ...more, token } };
  },
});

const setText = operation({
  label: "cli.channelSetText",
  input: z.object({
    answer: channelContracts["channel.set"].output,
    name: z.string(),
    repo: z.string(),
  }),
  run: (_, { input: { answer, name, repo } }) => {
    switch (answer.kind) {
      case "saved":
        return {
          text: `saved: channel ${name} gets each waiting period of a request, as an issue in ${repo}`,
          error: false,
        };
      case "public":
        return {
          text: `public: ${repo} is public, and a request of a viewer must not go there. Nothing was saved.`,
          error: true,
        };
      case "refused":
        return {
          text: `refused: GitHub answered ${answer.status}: ${answer.message}. Nothing was saved.`,
          error: true,
        };
    }
  },
});

const channelSet = operation({
  label: "cli.channelSet",
  input: channelCommand.options[0],
  depends: {
    say,
    usage,
    invalid,
    setCall,
    setText,
    exitOf: queueExitOf,
    queueFault,
    deadline: queueDeadline,
    set: queue.channels["channel.set"],
  },
  run: async (deps, { input }) => {
    const { say, usage, invalid, setCall, setText, exitOf, queueFault, deadline, set } = deps;
    const read = setCall.run({ input });
    if (read.bad !== null) return usage.run({ input: read.bad });

    const parsed = channelContracts["channel.set"].input.safeParse(read.call);
    if (!parsed.success) return invalid.run({ input: parsed.error.issues });

    const stop = deadline.run({ input: "channel.set" });
    const reply = await set.settle({ input: parsed.data, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return queueFault.run({ input: reply.reason });
    if (reply.status === "failed") return queueFault.run({ input: reply.error });

    const answer = reply.value;
    const told = setText.run({ input: { answer, name: parsed.data.name, repo: parsed.data.repo } });
    say.run({ input: { json: answer, ...told } });

    return exitOf.run({ input: { address: "channel.set", kind: answer.kind } });
  },
});

const channelLs = operation({
  label: "cli.channelLs",
  depends: {
    say,
    exitOf: queueExitOf,
    queueFault,
    deadline: queueDeadline,
    list: queue.channels["channel.list"],
  },
  run: async ({ say, exitOf, queueFault, deadline, list }) => {
    const stop = deadline.run({ input: "channel.list" });
    const reply = await list.settle({ input: {}, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return queueFault.run({ input: reply.reason });
    if (reply.status === "failed") return queueFault.run({ input: reply.error });

    const answer = reply.value;
    const lines = answer.channels.map(
      (c) =>
        `${c.name}\t${c.kind}\t${c.repo}\tlabel ${c.label}\ttrigger ${c.trigger}\ttoken …${c.tokenEnd}`,
    );
    say.run({ input: { json: answer, text: lines.join("\n") || "no channel" } });

    return exitOf.run({ input: { address: "channel.list", kind: answer.kind } });
  },
});

const channelRm = operation({
  label: "cli.channelRm",
  input: channelCommand.options[2],
  depends: {
    say,
    invalid,
    exitOf: queueExitOf,
    queueFault,
    deadline: queueDeadline,
    remove: queue.channels["channel.remove"],
  },
  run: async (deps, { input }) => {
    const { say, invalid, exitOf, queueFault, deadline, remove } = deps;
    const parsed = channelContracts["channel.remove"].input.safeParse({ name: input.name });
    if (!parsed.success) return invalid.run({ input: parsed.error.issues });

    const stop = deadline.run({ input: "channel.remove" });
    const reply = await remove.settle({ input: parsed.data, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return queueFault.run({ input: reply.reason });
    if (reply.status === "failed") return queueFault.run({ input: reply.error });

    const answer = reply.value;
    const said =
      answer.kind === "removed"
        ? { text: `removed: ${input.name}. Its issues stay on GitHub.`, error: false }
        : { text: "gone: no such channel. Nothing was written.", error: true };
    say.run({ input: { json: answer, ...said } });

    return exitOf.run({ input: { address: "channel.remove", kind: answer.kind } });
  },
});

const listed = queueContracts["request.deliveries"].output.options[0];

const deliveriesText = operation({
  label: "cli.deliveriesText",
  input: listed,
  run: (_, { input: { deliveries, channels } }) => {
    if (deliveries.length === 0) {
      return channels === 0
        ? "no delivery: the server has no channel. An agent that asks for work takes the request."
        : "no delivery yet";
    }

    return deliveries
      .map((d) => {
        const period = `${d.kind === "waiting" ? "waiting since" : "out after"} ${new Date(d.period).toISOString()}`;
        const issue = d.ref === null ? "no issue" : `issue #${d.ref}`;
        const cause = d.cause === null ? "" : `\t${d.cause}`;
        const at = `${d.status} ${new Date(d.updated).toISOString()}`;

        return `${d.channel}\t${period}\t${at}\tattempts ${d.attempts}\t${issue}${cause}`;
      })
      .join("\n");
  },
});

const deliveries = operation({
  label: "cli.deliveries",
  input: channelCommand.options[3],
  depends: {
    say,
    usage,
    invalid,
    deliveriesText,
    exitOf: queueExitOf,
    queueFault,
    deadline: queueDeadline,
    list: queue.api["request.deliveries"],
  },
  run: async (deps, { input }) => {
    const { say, usage, invalid, deliveriesText, exitOf, queueFault, deadline, list } = deps;
    const n = z.string().regex(/^\d+$/).transform(Number).safeParse(input.n);
    if (!n.success) {
      return usage.run({
        input: "the number of a request is 1 or more: `easel requests` prints them",
      });
    }

    const parsed = queueContracts["request.deliveries"].input.safeParse({
      canvas: input.canvas,
      n: n.data,
    });
    if (!parsed.success) return invalid.run({ input: parsed.error.issues });

    const stop = deadline.run({ input: "request.deliveries" });
    const reply = await list.settle({ input: parsed.data, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return queueFault.run({ input: reply.reason });
    if (reply.status === "failed") return queueFault.run({ input: reply.error });

    const answer = reply.value;
    const said =
      answer.kind === "listed"
        ? { text: deliveriesText.run({ input: answer }), error: false }
        : { text: "gone: no such request. Nothing was written.", error: true };
    say.run({ input: { json: answer, ...said } });

    return exitOf.run({ input: { address: "request.deliveries", kind: answer.kind } });
  },
});

export const channelRun = operation({
  label: "cli.channel",
  input: channelCommand,
  depends: { channelSet, channelLs, channelRm, deliveries },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "set":
        return ops.channelSet.run({ input });
      case "ls":
        return ops.channelLs.run();
      case "rm":
        return ops.channelRm.run({ input });
      case "deliveries":
        return ops.deliveries.run({ input });
    }
  },
});
