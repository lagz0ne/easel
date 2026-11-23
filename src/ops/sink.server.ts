import { createHash } from "node:crypto";

import { LEVELS, operation, resource } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { z } from "zod";

import { telemetryRoute, browserIngest } from "~/components/telemetry/ingest.server";
import { quiet } from "~/components/telemetry/records";
import type { Telemetry } from "~/components/telemetry/records";
import { logRecord, span } from "~/components/telemetry/records.server";
import { threadIngest } from "~/components/telemetry/thread.server";

import { release } from "@/release";

import { sample, sides } from "./contract";
import { caps, opsStore } from "./store.server";

export const messageCap = 1000;

const sampleCap = 5;
const buildCap = 50;

const sighting = z.object({
  side: z.enum(sides),
  label: z.string(),
  name: z.string(),
  message: z.string(),
  traceId: z.string().nullable(),
  build: z.number().int().nonnegative().optional(),
});

export type Sighting = z.infer<typeof sighting>;

const secretKey =
  "[\\w-]*?(?:token|password|passwd|pwd|pass|secret|key|authorization|cookie|share)[\\w-]*";

export const scrub = operation({
  label: "ops.scrub",
  input: z.string(),
  run: (_, { input }) =>
    input
      .replace(/<[!?/]?[a-z][\s\S]*/i, "[document removed]")
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[removed]@")
      .replace(/\b(bearer|basic)\s+\S+/gi, "$1 [removed]")
      .replace(
        new RegExp(`\\b(${secretKey})(["']?\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s,;&]+)`, "gi"),
        "$1$2[removed]",
      )
      .replace(/\b(password|passwd|pwd)\s+(?!\[removed\])\S+/gi, "$1 [removed]")
      .replace(/[A-Za-z0-9+/_-]{20,}={0,2}/g, "[removed]")
      .slice(0, messageCap),
});

export const normalize = operation({
  label: "ops.normalize",
  input: z.string(),
  run: (_, { input }) =>
    input
      .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "?")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "#")
      .replace(/\b(?:0x)?(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "#")
      .replace(/\d+(\.\d+)?/g, "0"),
});

export const fingerprintOf = operation({
  label: "ops.fingerprintOf",
  input: sighting.pick({ side: true, label: true, name: true, message: true }),
  depends: { normalize },
  run: ({ normalize }, { input }) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          input.side,
          input.label,
          input.name,
          normalize.run({ input: input.message }),
        ]),
      )
      .digest("hex"),
});

const makeRoom = operation({
  label: "ops.makeRoom",
  depends: { store: opsStore, caps },
  run: async ({ store, caps }) => {
    const { state, pending } = store;
    if (state.groups.size < caps.groups) return true;

    const byAge = [...state.groups.values()].toSorted((a, b) => a.lastSeen - b.lastSeen);
    const resolved = byAge.find((g) => g.status === "resolved" && g.fixedIn !== null);
    const browser = byAge.find((g) => g.side === "browser");

    if (resolved?.fixedIn) {
      state.groups.delete(resolved.fingerprint);
      state.retired.delete(resolved.fingerprint);
      state.retired.set(resolved.fingerprint, { fixedIn: resolved.fixedIn, at: resolved.lastSeen });
      pending.put.delete(resolved.fingerprint);
      pending.forget.delete(resolved.fingerprint);
      pending.retire.add(resolved.fingerprint);

      const [first] = state.retired.keys();
      if (state.retired.size > caps.retired && first !== undefined) {
        state.retired.delete(first);
        if (pending.retire.delete(first)) pending.drop.add(first);
        pending.forget.add(first);
      }
      return true;
    }

    if (!browser) return false;
    state.groups.delete(browser.fingerprint);
    pending.put.delete(browser.fingerprint);
    pending.drop.add(browser.fingerprint);
    return true;
  },
});

const countMinute = operation({
  label: "ops.countMinute",
  depends: { store: opsStore },
  run: async ({ store }, { clock }) => {
    const { minutes } = store.state;
    const minute = Math.floor(clock.currentTimeMillis() / 60_000);
    minutes.set(minute, (minutes.get(minute) ?? 0) + 1);
    for (const old of minutes.keys()) if (old <= minute - 24 * 60) minutes.delete(old);
  },
});

const kept = z.object({
  fingerprint: z.string(),
  sample,
  side: z.enum(sides),
  label: z.string(),
  name: z.string(),
});

const countKnown = operation({
  label: "ops.countKnown",
  input: kept,
  depends: { store: opsStore },
  run: async ({ store }, { input: { fingerprint, sample } }) => {
    const known = store.state.groups.get(fingerprint);
    if (!known) return "counted" as const;

    const builds = [...new Set([...known.builds, sample.build])].toSorted((a, b) => a - b);
    const back =
      known.status === "resolved" && known.fixedIn !== null && sample.build >= known.fixedIn;
    store.state.groups.set(fingerprint, {
      ...known,
      message: sample.message,
      count: known.count + 1,
      lastSeen: sample.at,
      builds: builds.slice(-buildCap),
      lastBuild: Math.max(known.lastBuild, sample.build),
      traceId: sample.traceId ?? known.traceId,
      status: back ? "regressed" : known.status,
      samples: [...known.samples, sample].slice(-sampleCap),
    });
    store.pending.drop.delete(fingerprint);
    store.pending.put.add(fingerprint);

    return back ? ("regressed" as const) : ("counted" as const);
  },
});

const openGroup = operation({
  label: "ops.openGroup",
  input: kept,
  depends: { store: opsStore, makeRoom },
  run: async ({ store, makeRoom }, { input }) => {
    const { state, pending } = store;
    const { sample, ...parts } = input;
    const { fingerprint } = parts;
    const gone = state.retired.get(fingerprint);
    if (gone && sample.build < gone.fixedIn) return "older" as const;

    if (!(await makeRoom.run())) {
      state.dropped += 1;
      pending.dropped = true;
      return "dropped" as const;
    }

    state.groups.set(fingerprint, {
      ...parts,
      message: sample.message,
      count: 1,
      firstSeen: sample.at,
      lastSeen: sample.at,
      builds: [sample.build],
      lastBuild: sample.build,
      traceId: sample.traceId,
      status: gone ? "regressed" : "open",
      fixedIn: gone?.fixedIn ?? null,
      reason: null,
      samples: [sample],
    });
    pending.drop.delete(fingerprint);
    pending.put.add(fingerprint);
    if (!gone) return "opened" as const;

    state.retired.delete(fingerprint);
    pending.retire.delete(fingerprint);
    pending.forget.add(fingerprint);
    return "regressed" as const;
  },
});

export const sight = operation({
  label: "ops.sight",
  input: sighting,
  depends: {
    version: release.version,
    fingerprintOf,
    scrub,
    countMinute,
    countKnown,
    openGroup,
    store: opsStore,
  },
  run: async (deps, { input, clock }) => {
    const live = deps.version.run().build;
    const message = deps.scrub.run({ input: input.message });
    const fingerprint = deps.fingerprintOf.run({ input: { ...input, message } });
    const sample = {
      at: clock.currentTimeMillis(),
      build: Math.min(input.build ?? live, live),
      traceId: input.traceId,
      message,
    };
    await deps.countMinute.run();

    const next = { fingerprint, sample, side: input.side, label: input.label, name: input.name };
    const kind = deps.store.state.groups.has(fingerprint)
      ? await deps.countKnown.run({ input: next })
      : await deps.openGroup.run({ input: next });

    return { fingerprint, kind };
  },
});

export const opsObserver = resource({
  label: "ops.observer",
  depends: { sight },
  factory: ({ sight }): Observe.Config => {
    const seen = new WeakSet<object>();

    return {
      level: LEVELS.error,
      export(span) {
        const error = Object(span.error);
        if (span.status !== "failed" || seen.has(error) || error.fault === "refused") return;

        seen.add(error);
        const plain = span.error instanceof Error;
        const input = {
          side: "server" as const,
          label: span.name,
          name: plain ? error.name : "Error",
          message: plain ? error.message : String(span.error),
          traceId: span.traceId,
        };
        void Promise.resolve()
          .then(() => sight.run({ input, ns: quiet }))
          .catch(() => undefined);
      },
      log(entry) {
        const cause = Object(entry.attributes.cause);
        const failed = entry.span?.status === "failed";
        if (entry.level < LEVELS.error || failed || seen.has(cause)) return;

        seen.add(cause);
        const span = entry.span ?? { name: "log", traceId: null };
        const input = {
          side: "server" as const,
          label: span.name,
          name: "log",
          message: entry.message,
          traceId: span.traceId,
        };
        void Promise.resolve()
          .then(() => sight.run({ input, ns: quiet }))
          .catch(() => undefined);
      },
    };
  },
});

const buildAttr = z
  .string()
  .regex(/^\d{1,15}$/)
  .transform(Number)
  .optional()
  .catch(undefined);

const sightSpan = operation({
  label: "ops.sightSpan",
  input: span,
  depends: { sight },
  run: async ({ sight }, { input }) => {
    const text = input.status.message ?? "";
    if (input.status.code !== 2 || /\brefused\b/.test(text)) return;

    const [, name = "Error", message = text] = /^(\w*Error): ?([\s\S]*)$/.exec(text) ?? [];
    const raw = input.attributes.find((a) => a.key === "build")?.value.stringValue;
    await sight.run({
      input: {
        side: "browser",
        label: input.name,
        name,
        message,
        traceId: input.traceId,
        build: buildAttr.parse(raw),
      },
    });
  },
});

const sightLog = operation({
  label: "ops.sightLog",
  input: logRecord,
  depends: { sight },
  run: async ({ sight }, { input }) => {
    if (input.level < LEVELS.error) return;

    await sight.run({
      input: {
        side: "browser",
        label: "log",
        name: "log",
        message: input.msg,
        traceId: input.traceId ?? null,
        build: buildAttr.parse(input.attributes?.build),
      },
    });
  },
});

export const sightBatch = operation({
  label: "ops.sightBatch",
  input: z.custom<Telemetry.Batch>((raw) => typeof raw === "object" && raw !== null),
  depends: { sightSpan, sightLog },
  run: async ({ sightSpan, sightLog }, { input }) => {
    for (const one of input.traces) await sightSpan.run({ input: one });
    for (const line of input.logs) await sightLog.run({ input: line });
  },
});

const opsBrowserIngest = resource({
  label: "ops.browserIngest",
  target: "namespace",
  depends: { next: browserIngest, sightBatch: sightBatch.controller },
  factory: ({ next, sightBatch }) => ({
    ingest(this: void, batch: Telemetry.Batch) {
      void Promise.resolve()
        .then(() => sightBatch.run({ input: batch }))
        .catch(() => undefined);
      next.ingest(batch);
    },
  }),
});

const opsThreadIngest = resource({
  label: "ops.threadIngest",
  target: "namespace",
  depends: { next: threadIngest, sightBatch: sightBatch.controller },
  factory: ({ next, sightBatch }) => ({
    ingest(this: void, batch: Telemetry.Batch) {
      void Promise.resolve()
        .then(() => sightBatch.run({ input: batch }))
        .catch(() => undefined);
      next.ingest(batch);
    },
  }),
});

export const opsTelemetryRoute = operation({
  ...telemetryRoute,
  label: "ops.telemetryRoute",
  depends: { ...telemetryRoute.depends, sink: opsBrowserIngest },
});

export const opsThreadRoute = operation({
  ...telemetryRoute,
  label: "ops.threadRoute",
  depends: { ...telemetryRoute.depends, sink: opsThreadIngest },
});
