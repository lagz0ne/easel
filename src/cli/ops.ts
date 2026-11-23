import { operation } from "@tinkered/core";
import { z } from "zod";

import { ops } from "@/ops";
import { errorGroup, fingerprint, resolveAnswer, sides, traceId } from "@/ops/contract";

import { deadline, exitOf, faultExit } from "./exit";
import { say } from "./output";

export const opsStatus = operation({
  label: "cli.status",
  depends: { say, exitOf, faultExit, deadline, status: ops.user["ops.status"] },
  run: async ({ say, exitOf, faultExit, deadline, status }) => {
    const stop = deadline.run({ input: "ops.status" });
    const reply = await status.settle({ input: null, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const s = reply.value;
    const e = s.errors;
    const text = [
      `build ${s.build} (${s.commit}), up ${Math.round(s.uptime / 1000)} s`,
      ...s.checks.map((c) => `  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`),
      ...Object.entries(s.counters).map(([name, n]) => `  ${name} ${n}`),
      `errors: ${e.hour} in the last hour, ${e.day} in the last day; ${e.open} open (${e.unconfirmed} unconfirmed), ${e.dropped} dropped`,
      `fixer: ${s.fixerSeen === null ? "never ticked" : `last tick ${new Date(s.fixerSeen).toISOString()}`}${s.fixerSilent ? ", silent" : ""}`,
    ].join("\n");
    say.run({ input: { json: s, text } });
    return exitOf.run({ input: { address: "ops.status" } });
  },
});

const groupLine = operation({
  label: "cli.groupLine",
  input: errorGroup,
  run: (_, { input: g }) =>
    `${g.fingerprint}  ${g.status}  ${g.side}  ${g.count}x  ${g.label}  ${g.name}: ${g.message.slice(0, 120)}`,
});

export const since = z.string().refine((typed) => {
  if (/^\d+[smhd]$/.test(typed)) return true;
  const day = /^(\d{4})-(\d\d)-(\d\d)/.exec(typed);
  if (!day || Number.isNaN(Date.parse(typed))) return false;
  const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));

  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day[0]);
}, "--since takes 30m, 2h, 7d or a date that is on the calendar");

const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

const sinceAt = operation({
  label: "cli.sinceAt",
  input: since,
  run: (_, { input, clock }) => {
    const duration = /^(\d+)([smhd])$/.exec(input);
    const unit = duration?.[2];
    if (!duration || !(unit === "s" || unit === "m" || unit === "h" || unit === "d")) {
      return Date.parse(input);
    }
    return clock.currentTimeMillis() - Number(duration[1]) * units[unit];
  },
});

export const errorsLsInput = z.object({
  open: z.boolean(),
  side: z.enum(sides).optional(),
  since: since.optional(),
});

export const errorsLs = operation({
  label: "cli.errorsLs",
  input: errorsLsInput,
  depends: { say, exitOf, faultExit, deadline, sinceAt, groupLine, list: ops.owner["ops.errors"] },
  run: async (deps, { input }) => {
    const { say, exitOf, faultExit, deadline, sinceAt, list } = deps;
    const from = input.since === undefined ? undefined : sinceAt.run({ input: input.since });
    const stop = deadline.run({ input: "ops.errors" });
    const reply = await list.settle({
      input: { open: input.open || undefined, side: input.side, since: from },
      signal: stop.signal,
    });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const groups = reply.value.errors;
    const text = groups.length
      ? groups.map((g) => deps.groupLine.run({ input: g })).join("\n")
      : "no error groups";
    say.run({ input: { json: reply.value, text } });
    return exitOf.run({ input: { address: "ops.errors" } });
  },
});

export const errorsShowInput = z.union([z.object({ fingerprint }), z.object({ trace: traceId })]);

export const errorsShow = operation({
  label: "cli.errorsShow",
  input: errorsShowInput,
  depends: { say, exitOf, faultExit, deadline, groupLine, show: ops.owner["ops.error"] },
  run: async ({ say, exitOf, faultExit, deadline, groupLine, show }, { input }) => {
    const stop = deadline.run({ input: "ops.error" });
    const reply = await show.settle({ input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    switch (answer.kind) {
      case "found": {
        const g = answer.error;
        const [first, last] = [g.firstSeen, g.lastSeen].map((at) => new Date(at).toISOString());
        const text = [
          groupLine.run({ input: g }),
          `  seen ${first} to ${last}, on builds ${g.builds.join(", ")}`,
          `  fixed in ${g.fixedIn ?? "none"}${g.reason === null ? "" : `; handed off: ${g.reason}`}`,
          `  trace ${g.traceId ?? "none"}`,
          ...answer.samples.map(
            (s) => `  ${new Date(s.at).toISOString()} build ${s.build}: ${s.message}`,
          ),
        ].join("\n");
        say.run({ input: { json: answer, text } });
        break;
      }
      case "gone":
        say.run({ input: { json: answer, text: "no such error group", error: true } });
        break;
    }

    return exitOf.run({ input: { address: "ops.error", kind: answer.kind } });
  },
});

const resolveText = operation({
  label: "cli.resolveText",
  input: z.object({ answer: resolveAnswer, build: z.number() }),
  run: (_, { input: { answer, build } }) => {
    switch (answer.kind) {
      case "resolved":
        return `resolved in build ${build}`;
      case "notLive":
        return `build ${build} is not live yet (live: ${answer.live}): try again once it deploys`;
      case "failing":
        return `the error was seen on build ${answer.seen}, at or after ${build}: the fix did not hold`;
      case "held":
        return "a fixer holds this group: only its claim moves it until the lease ends";
      case "gone":
        return "no such error group";
    }
  },
});

export const errorsResolve = operation({
  label: "cli.errorsResolve",
  input: z.object({ fingerprint, build: z.number().int().positive() }),
  depends: {
    say,
    exitOf,
    faultExit,
    deadline,
    resolveText,
    resolve: ops.owner["ops.resolveError"],
  },
  run: async (deps, { input }) => {
    const { say, exitOf, faultExit, deadline, resolve } = deps;
    const stop = deadline.run({ input: "ops.resolveError" });
    const reply = await resolve.settle({ input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    const text = deps.resolveText.run({ input: { answer, build: input.build } });
    say.run({ input: { json: answer, text, error: answer.kind !== "resolved" } });
    return exitOf.run({ input: { address: "ops.resolveError", kind: answer.kind } });
  },
});

export const errorsHandOff = operation({
  label: "cli.errorsHandOff",
  input: z.object({ fingerprint, reason: z.string() }),
  depends: { say, exitOf, faultExit, deadline, handOff: ops.owner["ops.handOff"] },
  run: async ({ say, exitOf, faultExit, deadline, handOff }, { input }) => {
    const stop = deadline.run({ input: "ops.handOff" });
    const reply = await handOff.settle({ input, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    const answer = reply.value;
    const text = {
      handed: "handed off: a person has it",
      held: "a fixer holds this group: only its claim moves it until the lease ends",
      gone: "no such error group",
    }[answer.kind];
    say.run({ input: { json: answer, text, error: answer.kind !== "handed" } });
    return exitOf.run({ input: { address: "ops.handOff", kind: answer.kind } });
  },
});

export const errorsTick = operation({
  label: "cli.errorsTick",
  depends: { say, exitOf, faultExit, deadline, tick: ops.owner["ops.fixerTick"] },
  run: async ({ say, exitOf, faultExit, deadline, tick }) => {
    const stop = deadline.run({ input: "ops.fixerTick" });
    const reply = await tick.settle({ input: null, signal: stop.signal });
    stop.abort();
    if (reply.status === "cancelled") return faultExit.run({ input: reply.reason });
    if (reply.status === "failed") return faultExit.run({ input: reply.error });

    say.run({
      input: { json: reply.value, text: `stamped ${new Date(reply.value.at).toISOString()}` },
    });
    return exitOf.run({ input: { address: "ops.fixerTick", kind: reply.value.kind } });
  },
});
