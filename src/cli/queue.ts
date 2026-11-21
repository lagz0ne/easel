import { readFileSync } from "node:fs";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { loginApi } from "@/access/contract";
import { canvasKey } from "@/frames/contract";
import { queue } from "@/queue";
import { message, request } from "@/queue/cells";
import { channelSuccessKinds } from "@/queue/channels";
import type { ChannelAddress } from "@/queue/channels";
import {
  lease,
  maxWait,
  queueContracts,
  queueSuccessKinds,
  requestContracts,
  requestSuccessKinds,
  state,
  stateOf,
} from "@/queue/contract";
import type { QueueAddress, RequestAddress } from "@/queue/contract";

import { callDeadline, exits, faultExit } from "./exit";
import { say } from "./output";

// `easel next`, `extend`, `release`, `decline`, `ask`, `resolve`, `requests`, `edit` and `close`
// (SPEC-queue.md § An agent works the queue, § A request no agent finishes). Each prints its
// answer and exits by the call's success list in the queue's contract (SPEC-cli.md fact rule 3).
// A bad flag is 64 and an input that the contract refuses is 65, both before the call. A queue
// fault is told as the shell tells any fault: refused 2, invalid 65, link 69, failed 70.

/** One queue command, as the cmd read it from its flags. Numbers stay as typed: bad ones are 64. */
export const queueCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("next"),
    canvas: z.string().optional(),
    n: z.string().optional(),
    wait: z.string().optional(),
    lease: z.string().optional(),
  }),
  z.object({ kind: z.literal("extend"), claim: z.string(), lease: z.string().optional() }),
  z.object({ kind: z.literal("release"), claim: z.string(), reason: z.string() }),
  z.object({ kind: z.literal("decline"), claim: z.string(), reason: z.string() }),
  z.object({
    kind: z.literal("ask"),
    claim: z.string(),
    text: z.string(),
    /** The path of the HTML part. */
    html: z.string().optional(),
    options: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("resolve"),
    claim: z.string(),
    text: z.string(),
    html: z.string().optional(),
  }),
  z.object({
    kind: z.literal("requests"),
    canvas: z.string().optional(),
    state: z.string().optional(),
  }),
  z.object({ kind: z.literal("edit"), canvas: z.string(), n: z.string(), text: z.string() }),
  z.object({
    kind: z.literal("close"),
    canvas: z.string(),
    n: z.string(),
    text: z.string().optional(),
  }),
]);

export type QueueCommand = z.infer<typeof queueCommand>;

/** What each bad flag says: one line that names it. */
const badFlag = {
  canvas: "--canvas takes a canvas's key: `easel canvas ls` prints them",
  n: "the number of a request is 1 or more, and --n needs --canvas: `easel requests` prints them",
  wait: "--wait takes seconds, 0 or more",
  lease: "--lease takes seconds, 30 to 3600",
  state: `--state takes one of ${state.options.join(", ")}`,
  html: "--html takes the path of an HTML file that can be read",
} as const;

/** Whole seconds, as typed. */
const seconds = z.string().regex(/^\d+$/).transform(Number);

/** A flag as typed, read. An issue names the flag, and `badFlag` has its line. */
const flag = {
  canvas: canvasKey.optional(),
  n: seconds.pipe(z.number().int().positive()),
  wait: seconds,
  lease: seconds.pipe(lease),
  state: state.optional(),
} as const;

/** `easel next`'s flags, read. */
const nextFlags = z
  .object({
    canvas: flag.canvas,
    n: flag.n.optional(),
    wait: flag.wait.default(0),
    lease: flag.lease.optional(),
  })
  .refine((typed) => typed.n === undefined || typed.canvas !== undefined, { path: ["n"] });

/** `easel requests`' flags, read. */
const listFlags = z.object({ canvas: flag.canvas, state: flag.state });

/** The line of the first flag that the issues name. */
const badLine = operation({
  label: "cli.queueBadLine",
  input: z.array(z.object({ path: z.array(z.unknown()) })),
  run: (_, { input: issues }) => {
    const named = z.enum(["canvas", "n", "wait", "lease", "state"]).safeParse(issues[0]?.path[0]);

    return named.success ? badFlag[named.data] : badFlag.n;
  },
});

/** Bad flags: the text says what to do, and the run exits 64 before it calls. */
const usage = operation({
  label: "cli.queueUsage",
  input: z.string(),
  depends: { say },
  run: ({ say }, { input: text }) => {
    say.run({ input: { json: { usage: text }, text, error: true } });

    return exits.usage;
  },
});

/** An input that the contract refuses: the issues, printed, and 65 before it sends. */
const invalid = operation({
  label: "cli.queueInvalid",
  input: z.array(z.object({ path: z.array(z.unknown()), message: z.string() })),
  depends: { say },
  run: ({ say }, { input: issues }) => {
    const why = issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
    const text = `the input is wrong: ${why.join("; ")}`;
    say.run({ input: { json: { invalid: why }, text, error: true } });

    return exits.invalid;
  },
});

/** The addresses of the queue that the CLI calls; `./channels` calls the last four. */
const address = z.enum([
  "request.next",
  "request.extend",
  "request.release",
  "request.decline",
  "request.ask",
  "request.resolve",
  "request.list",
  "request.edit",
  "request.close",
  "request.deliveries",
  "channel.set",
  "channel.list",
  "channel.remove",
] satisfies Array<QueueAddress | RequestAddress | ChannelAddress>);

/** Every success list of the queue, by call. */
const lists = { ...queueSuccessKinds, ...requestSuccessKinds, ...channelSuccessKinds };

/** 0 when the queue's contract lists the kind as a success, else 1. */
export const queueExitOf = operation({
  label: "cli.queueExitOf",
  input: z.object({ address, kind: z.string() }),
  run: (_, { input }) => {
    const list: readonly string[] = lists[input.address];

    return list.some((kind) => kind === input.kind) ? exits.ok : exits.no;
  },
});

/**
 * One call's deadline: after `callDeadline` (60 s) its signal aborts with a `link` fault, as the
 * shell's `deadline` does. A `request.next` waits at most 50 s on the server, inside it.
 */
export const queueDeadline = operation({
  label: "cli.queueDeadline",
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

/** A call that did not answer, told as the shell tells it: a queue fault is made again as one. */
export const queueFault = operation({
  label: "cli.queueFault",
  input: z.unknown(),
  depends: { faultExit },
  run: ({ faultExit }, { input: error }) => {
    const known =
      queue.api.fault.is(error) || queue.viewer.fault.is(error) || queue.channels.fault.is(error)
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

/** What a refusal of the queue prints: what it means, and what to do next. */
const refusalText = operation({
  label: "cli.queueRefusalText",
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("wrongState"), state }),
    z.object({ kind: z.literal("lost") }),
    z.object({ kind: z.literal("gone") }),
    z.object({ kind: z.literal("slow"), retryIn: z.number() }),
    z.object({ kind: z.literal("full") }),
  ]),
  run: (_, { input }) => {
    switch (input.kind) {
      case "wrongState":
        return `wrongState: the request is ${input.state} now. Nothing was written.`;
      case "lost":
        return "lost: this claim is not the live lease of the request (it ran out, or a newer claim took it). Nothing was written: run `easel next` again.";
      case "gone":
        return "gone: no such request. Nothing was written.";
      case "slow":
        return `slow: too many calls; try again in ${Math.ceil(input.retryIn / 1000)} s. Nothing was written.`;
      case "full":
        return "full: the canvas has 200 requests that are not resolved and not closed. Nothing was written.";
    }
  },
});

/** One line for a request: canvas, number, state, author, place and tries. */
const requestLine = operation({
  label: "cli.requestLine",
  input: z.object({ request, now: z.number() }),
  depends: { stateOf },
  run: ({ stateOf }, { input: { request: r, now } }) => {
    const at = r.frameId === null ? "on the canvas" : `frame ${r.frameId} v${r.version}`;
    const shown = stateOf.run({ input: { request: r, now } });
    const by = shown === "inWork" ? ` by ${r.claimedBy}` : "";

    return `${r.canvas} #${r.n}\t${shown}${by}\t${r.author}\t${at}\ttries ${r.tries}`;
  },
});

/** One line for a message of a thread. */
const messageLine = operation({
  label: "cli.messageLine",
  input: message,
  run: (_, { input: m }) => {
    const options = m.options ? ` [${m.options.map((o, i) => `${i}: ${o}`).join(", ")}]` : "";
    const html = m.html === null ? "" : " (with an HTML part)";

    return `${m.from} (${m.kind}): ${m.text ?? ""}${options}${html}`;
  },
});

/** What `request.next` answers when it claims. */
const claimed = queueContracts["request.next"].output.options[0];

/** The line of a claim about its place: the frame now, the frames of the canvas, or neither. */
const placeLine = operation({
  label: "cli.placeLine",
  input: claimed,
  run: (_, { input: got }) => {
    if (got.frame) {
      const { id, name, version } = got.frame;
      const saw = got.saw ? `; the viewer saw v${got.saw.version}` : "";

      return `the frame now: ${id} "${name}" v${version}${saw} (\`easel get ${got.request.canvas} ${id}\`)`;
    }
    if (got.frames === null) return "the frame was removed";

    return `the frames: ${got.frames.map((f) => `${f.id} "${f.name}"`).join(", ") || "none"}`;
  },
});

/** The text of a claimed request: the claim, what it allows, the request, and its thread. */
const claimedText = operation({
  label: "cli.claimedText",
  input: claimed,
  depends: { requestLine, messageLine, placeLine },
  run: ({ requestLine, messageLine, placeLine }, { input: got }) =>
    [
      `claim: ${got.claim}`,
      `until: ${new Date(got.until).toISOString()}`,
      got.note,
      requestLine.run({ input: { request: got.request, now: got.now } }),
      placeLine.run({ input: got }),
      ...got.messages.map((m) => messageLine.run({ input: m })),
    ].join("\n"),
});

/** What `easel next` prints for an answer. */
const nextText = operation({
  label: "cli.nextText",
  input: queueContracts["request.next"].output,
  depends: { claimedText },
  run: ({ claimedText }, { input: answer }) => {
    switch (answer.kind) {
      case "claimed":
        return claimedText.run({ input: answer });
      case "empty":
        return "empty: no request waits";
    }
  },
});

/** One `request.next` call: its answer, or the exit of a call that did not answer. */
const callNext = operation({
  label: "cli.callNext",
  input: queueContracts["request.next"].input,
  depends: { queueFault, deadline: queueDeadline, call: queue.api["request.next"] },
  run: async ({ queueFault, deadline, call }, { input }) => {
    const stop = deadline.run({ input: "request.next" });
    const reply = await call.settle({ input, signal: stop.signal });
    stop.abort();

    if (reply.status === "cancelled") {
      return { answered: false as const, exit: queueFault.run({ input: reply.reason }) };
    }
    if (reply.status === "failed") {
      return { answered: false as const, exit: queueFault.run({ input: reply.error }) };
    }

    return { answered: true as const, answer: reply.value };
  },
});

/**
 * `easel next [--canvas k] [--n n] [--wait s] [--lease s]` (`request.next`): claims the oldest
 * waiting request. With nothing to take, it asks again in calls of at most 50 s until `--wait`
 * passes, then prints `empty` and exits 0, as a poll of SQS answers no message.
 */
export const next = operation({
  label: "cli.next",
  input: queueCommand.options[0],
  depends: { say, usage, badLine, callNext, nextText, exitOf: queueExitOf },
  run: async ({ say, usage, badLine, callNext, nextText, exitOf }, { input, clock }) => {
    const flags = nextFlags.safeParse(input);
    if (!flags.success) return usage.run({ input: badLine.run({ input: flags.error.issues }) });

    const { wait: waitFor, ...scope } = flags.data;
    const end = clock.currentTimeMillis() + waitFor * 1000;
    for (;;) {
      const left = Math.ceil(Math.max(0, end - clock.currentTimeMillis()) / 1000);
      const sent = await callNext.run({ input: { ...scope, wait: Math.min(maxWait, left) } });
      if (!sent.answered) return sent.exit;

      const { answer } = sent;
      if (answer.kind === "claimed" || clock.currentTimeMillis() >= end) {
        say.run({ input: { json: answer, text: nextText.run({ input: answer }) } });

        return exitOf.run({ input: { address: "request.next", kind: answer.kind } });
      }
    }
  },
});

/** The HTML part of `--html <file>`: its text; null with no flag; false when it cannot be read. */
const htmlFile = operation({
  label: "cli.htmlFile",
  input: z.string().optional(),
  run: (_, { input: path }) => {
    if (path === undefined) return null;

    try {
      return readFileSync(path, "utf8");
    } catch {
      return false;
    }
  },
});

/** A call of the holder of a claim, as the contract takes it. */
const holderInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("extend"), input: queueContracts["request.extend"].input }),
  z.object({ kind: z.literal("release"), input: queueContracts["request.release"].input }),
  z.object({ kind: z.literal("decline"), input: queueContracts["request.decline"].input }),
  z.object({ kind: z.literal("ask"), input: queueContracts["request.ask"].input }),
  z.object({ kind: z.literal("resolve"), input: queueContracts["request.resolve"].input }),
]);

/** The commands of the holder of a claim. */
const holderCommand = z.discriminatedUnion("kind", [
  queueCommand.options[1],
  queueCommand.options[2],
  queueCommand.options[3],
  queueCommand.options[4],
  queueCommand.options[5],
]);

/** `easel extend`, read: its call, or the line of a bad `--lease`. */
const extendCall = operation({
  label: "cli.extendCall",
  input: queueCommand.options[1],
  run: (_, { input: { kind, claim, lease: typed } }) => {
    const leased = flag.lease.optional().safeParse(typed);
    if (!leased.success) return { bad: badFlag.lease };

    return { bad: null, call: { kind, input: { claim, lease: leased.data } } };
  },
});

/** `easel ask` or `resolve`, read: its call with the HTML part, or the line of a bad `--html`. */
const partCall = operation({
  label: "cli.partCall",
  input: z.discriminatedUnion("kind", [queueCommand.options[4], queueCommand.options[5]]),
  depends: { htmlFile },
  run: ({ htmlFile }, { input }) => {
    const html = htmlFile.run({ input: input.html });
    if (html === false) return { bad: badFlag.html };

    const { kind, claim, text } = input;
    const part = html === null ? {} : { html };
    const options = input.kind === "ask" && input.options?.length ? { options: input.options } : {};

    return { bad: null, call: { kind, input: { claim, text, ...part, ...options } } };
  },
});

/** A holder's command, read: its call before the contract checks it, or the line of a bad flag. */
const holderCall = operation({
  label: "cli.holderCall",
  input: holderCommand,
  depends: { extendCall, partCall },
  run: ({ extendCall, partCall }, { input }) => {
    switch (input.kind) {
      case "extend":
        return extendCall.run({ input });
      case "release":
      case "decline":
        return {
          bad: null,
          call: { kind: input.kind, input: { claim: input.claim, reason: input.reason } },
        };
      case "ask":
      case "resolve":
        return partCall.run({ input });
    }
  },
});

/** One call of a holder: the answer of the call that its kind names. It throws a fault. */
const settleHolder = operation({
  label: "cli.settleHolder",
  input: z.object({ call: holderInput, signal: z.instanceof(AbortSignal) }),
  depends: {
    extend: queue.api["request.extend"],
    release: queue.api["request.release"],
    decline: queue.api["request.decline"],
    ask: queue.api["request.ask"],
    resolve: queue.api["request.resolve"],
  },
  run: (calls, { input: { call, signal } }) => {
    switch (call.kind) {
      case "extend":
        return calls.extend.run({ input: call.input, signal });
      case "release":
        return calls.release.run({ input: call.input, signal });
      case "decline":
        return calls.decline.run({ input: call.input, signal });
      case "ask":
        return calls.ask.run({ input: call.input, signal });
      case "resolve":
        return calls.resolve.run({ input: call.input, signal });
    }
  },
});

/** Sends a holder's call: its answer, or the exit of a call that did not answer. */
const sendHolder = operation({
  label: "cli.sendHolder",
  input: holderInput,
  depends: { queueFault, settleHolder, deadline: queueDeadline },
  run: async ({ queueFault, settleHolder, deadline }, { input: call }) => {
    const stop = deadline.run({ input: `request.${call.kind}` });
    try {
      const answer = await settleHolder.run({ input: { call, signal: stop.signal } });

      return { answered: true as const, answer };
    } catch (error) {
      return { answered: false as const, exit: queueFault.run({ input: error }) };
    } finally {
      stop.abort();
    }
  },
});

/** What a holder's call prints when it is done, by the kind of the answer. */
const holderDone = {
  released: "released: the request waits again, at the back of the queue",
  declined: "declined: the request needs a person",
  asked: "asked: the request waits for a viewer",
  resolved: "resolved",
} as const;

/** What a holder's call prints for its answer, and whether it is an error. */
const holderText = operation({
  label: "cli.holderText",
  input: z.union([
    queueContracts["request.extend"].output,
    queueContracts["request.release"].output,
    queueContracts["request.decline"].output,
    queueContracts["request.ask"].output,
    queueContracts["request.resolve"].output,
  ]),
  depends: { refusalText },
  run: ({ refusalText }, { input: answer }) => {
    if (answer.kind === "wrongState" || answer.kind === "lost" || answer.kind === "gone") {
      return { text: refusalText.run({ input: answer }), error: true };
    }
    if (answer.kind === "extended") {
      return { text: `extended: until ${new Date(answer.until).toISOString()}`, error: false };
    }

    return { text: holderDone[answer.kind], error: false };
  },
});

/**
 * `easel extend|release|decline|ask|resolve <claim> ...`: one call of the holder of a claim.
 * `lost`, `wrongState` and `gone` exit 1, and say that nothing was written.
 */
export const holder = operation({
  label: "cli.holder",
  input: holderCommand,
  depends: { say, usage, invalid, holderCall, sendHolder, holderText, exitOf: queueExitOf },
  run: async (deps, { input }) => {
    const { say, usage, invalid, holderCall, sendHolder, holderText, exitOf } = deps;
    const read = holderCall.run({ input });
    if (read.bad !== null) return usage.run({ input: read.bad });

    const parsed = holderInput.safeParse(read.call);
    if (!parsed.success) return invalid.run({ input: parsed.error.issues });

    const sent = await sendHolder.run({ input: parsed.data });
    if (!sent.answered) return sent.exit;

    const { answer } = sent;
    say.run({ input: { json: answer, ...holderText.run({ input: answer }) } });

    return exitOf.run({ input: { address: `request.${input.kind}`, kind: answer.kind } });
  },
});

/** `easel requests [--canvas k] [--state s]` (`request.list`): one line per request. */
export const requestsLs = operation({
  label: "cli.requests",
  input: queueCommand.options[6],
  depends: {
    say,
    usage,
    badLine,
    requestLine,
    exitOf: queueExitOf,
    queueFault,
    deadline: queueDeadline,
    list: queue.api["request.list"],
  },
  run: async (deps, { input, clock }) => {
    const { say, usage, badLine, requestLine, exitOf, queueFault, deadline, list } = deps;
    const flags = listFlags.safeParse(input);
    if (!flags.success) return usage.run({ input: badLine.run({ input: flags.error.issues }) });

    const stop = deadline.run({ input: "request.list" });
    const reply = await list.settle({ input: flags.data, signal: stop.signal });
    stop.abort();

    if (reply.status === "cancelled") return queueFault.run({ input: reply.reason });
    if (reply.status === "failed") return queueFault.run({ input: reply.error });

    const answer = reply.value;
    const now = clock.currentTimeMillis();
    const lines = answer.requests.map((r) => requestLine.run({ input: { request: r, now } }));
    say.run({ input: { json: answer, text: lines.join("\n") || "no request" } });

    return exitOf.run({ input: { address: "request.list", kind: answer.kind } });
  },
});

/** A user's commands on a request. */
const userCommand = z.discriminatedUnion("kind", [
  queueCommand.options[7],
  queueCommand.options[8],
]);

/** A user's call on a request, as the contract takes it. */
const userInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("edit"), input: requestContracts["request.edit"].input }),
  z.object({ kind: z.literal("close"), input: requestContracts["request.close"].input }),
]);

/** A user's command, read: its call before the contract checks it, or the line of a bad number. */
const userCall = operation({
  label: "cli.userCall",
  input: userCommand,
  run: (_, { input: { kind, canvas, n: typed, text } }) => {
    const n = flag.n.safeParse(typed);
    if (!n.success) return { bad: badFlag.n };

    const said = text === undefined ? {} : { text };

    return { bad: null, call: { kind, input: { canvas, n: n.data, ...said } } };
  },
});

/** A user's call on a request: its answer. It throws a fault. */
const settleUser = operation({
  label: "cli.settleUser",
  input: z.object({ call: userInput, signal: z.instanceof(AbortSignal) }),
  depends: { edit: queue.viewer["request.edit"], close: queue.viewer["request.close"] },
  run: (calls, { input: { call, signal } }) => {
    switch (call.kind) {
      case "edit":
        return calls.edit.run({ input: call.input, signal });
      case "close":
        return calls.close.run({ input: call.input, signal });
    }
  },
});

/** Sends a user's call: its answer, or the exit of a call that did not answer. */
const sendUser = operation({
  label: "cli.sendUser",
  input: userInput,
  depends: { queueFault, settleUser, deadline: queueDeadline },
  run: async ({ queueFault, settleUser, deadline }, { input: call }) => {
    const stop = deadline.run({ input: `request.${call.kind}` });
    try {
      const answer = await settleUser.run({ input: { call, signal: stop.signal } });

      return { answered: true as const, answer };
    } catch (error) {
      return { answered: false as const, exit: queueFault.run({ input: error }) };
    } finally {
      stop.abort();
    }
  },
});

/** What a user's call prints for its answer, and whether it is an error. */
const userText = operation({
  label: "cli.userText",
  input: z.object({
    named: z.string(),
    answer: z.union([
      requestContracts["request.edit"].output,
      requestContracts["request.close"].output,
    ]),
  }),
  depends: { refusalText },
  run: ({ refusalText }, { input: { named, answer } }) => {
    switch (answer.kind) {
      case "edited":
        return { text: `edited: ${named} waits again, with no tries`, error: false };
      case "closed":
        return { text: `closed: ${named}`, error: false };
      case "wrongState":
      case "gone":
      case "slow":
        return { text: refusalText.run({ input: answer }), error: true };
    }
  },
});

/**
 * `easel edit <canvas> <n> --text t` and `easel close <canvas> <n> [--text t]`: a user makes a
 * request clear, or closes it (§ A request no agent finishes, step 3).
 */
export const userAct = operation({
  label: "cli.userAct",
  input: userCommand,
  depends: {
    say,
    usage,
    invalid,
    userCall,
    sendUser,
    userText,
    exitOf: queueExitOf,
  },
  run: async (deps, { input }) => {
    const read = deps.userCall.run({ input });
    if (read.bad !== null) return deps.usage.run({ input: read.bad });

    const parsed = userInput.safeParse(read.call);
    if (!parsed.success) return deps.invalid.run({ input: parsed.error.issues });

    const sent = await deps.sendUser.run({ input: parsed.data });
    if (!sent.answered) return sent.exit;

    const { answer } = sent;
    const named = `${input.canvas} #${parsed.data.input.n}`;
    deps.say.run({ input: { json: answer, ...deps.userText.run({ input: { named, answer } }) } });

    return deps.exitOf.run({ input: { address: `request.${input.kind}`, kind: answer.kind } });
  },
});

/** Runs one queue command; answers its exit code. The shell's `cli.run` sends each here. */
export const queueRun = operation({
  label: "cli.queue",
  input: queueCommand,
  depends: { next, holder, requestsLs, userAct },
  run: (ops, { input }) => {
    if (input.kind === "next") return ops.next.run({ input });
    if (input.kind === "requests") return ops.requestsLs.run({ input });
    if (input.kind === "edit" || input.kind === "close") return ops.userAct.run({ input });
    return ops.holder.run({ input });
  },
});
