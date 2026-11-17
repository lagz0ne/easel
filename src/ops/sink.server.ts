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

// The error sink (SPEC-ops.md § An error is recorded): the only writer of a group's sightings
// (fact rule 1). It reads Tinker's records: a server span that ends failed, a log at error or
// above, and a tab's batch on `POST /api/telemetry`. The panic path calls `sight` too. No
// operation of a feature calls it. It runs in the quiet namespace, so it never records itself.

/** A sample's message is cut to this many characters (judged rule 2). */
export const messageCap = 1000;

/** A group keeps its last few samples, and the builds it was seen on, newest last. */
const sampleCap = 5;
const buildCap = 50;

const sighting = z.object({
  side: z.enum(sides),
  label: z.string(),
  name: z.string(),
  message: z.string(),
  traceId: z.string().nullable(),
  /**
   * The build a tab reports in its record's `build` attribute; none on the server. It counts only
   * up to the live build: a tab cannot claim a build that is not out.
   */
  build: z.number().int().nonnegative().optional(),
});

export type Sighting = z.infer<typeof sighting>;

/** The words that name a secret, also inside a longer key: `access_token`, `sharePass`, `api_key`. */
const secretKey =
  "[\\w-]*?(?:token|password|passwd|pwd|pass|secret|key|authorization|cookie|share)[\\w-]*";

/**
 * A message with no secret left (judged rule 1): a frame's document, cut at its first tag of any
 * kind; a URL's user and password; a bearer token; a key that names a secret, with `=` or `:`, and
 * a password after a space; any run of 20 or more base64 or hex characters (a token, a key, a
 * digest). Then cut to `messageCap`.
 */
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

/**
 * A message with its values taken out (judged rule 5): quoted values become `?`, uuids and hex
 * `#`, numbers (line numbers, ids, times) `0`. Two errors that differ only there are one group.
 */
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

/** The fingerprint: the SHA-256, in hex, of the side, label, error name and normalized message. */
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

/**
 * Room for a new group: true below the cap. At the cap (judged rule 3), the oldest `resolved` group goes into the
 * retired list; else the oldest browser group goes. A confirmed group that is `open`,
 * `regressed` or `human` never goes. False when no group can go.
 */
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
        // Retired since the last flush: its group row is still stored, so the flush drops it.
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

/** Counts one sighting in its minute, and forgets the minutes older than a day. */
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

/** A sighting as the sink keeps it: its group's fingerprint, its sample, and its parts. */
const kept = z.object({
  fingerprint: z.string(),
  sample,
  side: z.enum(sides),
  label: z.string(),
  name: z.string(),
});

/**
 * A known group counts the sighting. A `resolved` one seen on a build >= `fixedIn` is `regressed`
 * (judged rule 6); a `human` group stays human.
 */
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

/**
 * A new fingerprint opens a group, unless it is retired: seen on a build >= its `fixedIn`, it is
 * back as `regressed`; on an older build, nothing changes (judged rule 4). At the cap, when no
 * group can go, it is counted in `dropped` and not kept (judged rule 3).
 */
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

/**
 * One sighting, on the build that runs (fact rule 3): its message scrubbed, its fingerprint made,
 * counted in its minute, then counted on its group or opening one. The time is the run's clock.
 */
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

/**
 * The record stream's reader: the scope's observer taps it (`opsServer`). A failed span is one
 * sighting, under the innermost span the error ended (one error object counts once). A log at
 * error or above is one, unless its span failed or its `cause` was counted: that error is already
 * in. A `refused` fault is the contract working, and is no error. A sighting that fails is lost,
 * never thrown: the sink must not take the server down.
 */
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

/** The build a tab's record names in its `build` attribute, if it names one. */
const buildAttr = z
  .string()
  .regex(/^\d{1,15}$/)
  .transform(Number)
  .optional()
  .catch(undefined);

/**
 * One span of a tab's batch: one browser sighting when its status is an error, and not a
 * `refused` fault. Its text reads as `TypeError: message`.
 */
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

/** One log line of a tab's batch: one browser sighting at level error or above. */
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

/**
 * A tab's batch: each span with an error status and each log at error or above is a browser
 * sighting (`side: "browser"`, unconfirmed: any client can forge the `Origin` it passed).
 */
export const sightBatch = operation({
  label: "ops.sightBatch",
  input: z.custom<Telemetry.Batch>((raw) => typeof raw === "object" && raw !== null),
  depends: { sightSpan, sightLog },
  run: async ({ sightSpan, sightLog }, { input }) => {
    for (const one of input.traces) await sightSpan.run({ input: one });
    for (const line of input.logs) await sightLog.run({ input: line });
  },
});

/** The tab's batches, sighted, then sent on as `telemetry.server`'s route sends them. */
const opsBrowserIngest = resource({
  label: "ops.browserIngest",
  target: "namespace",
  depends: { next: browserIngest, sightBatch: sightBatch.controller },
  factory: ({ next, sightBatch }) => ({
    ingest(this: void, batch: Telemetry.Batch) {
      // The route does not wait on the sink; a sighting that fails is lost, never thrown.
      void Promise.resolve()
        .then(() => sightBatch.run({ input: batch }))
        .catch(() => undefined);
      next.ingest(batch);
    },
  }),
});

/** The same, sent on to the worker thread, as `telemetry.thread`'s route sends them. */
const opsThreadIngest = resource({
  label: "ops.threadIngest",
  target: "namespace",
  depends: { next: threadIngest, sightBatch: sightBatch.controller },
  factory: ({ next, sightBatch }) => ({
    ingest(this: void, batch: Telemetry.Batch) {
      // The route does not wait on the sink; a sighting that fails is lost, never thrown.
      void Promise.resolve()
        .then(() => sightBatch.run({ input: batch }))
        .catch(() => undefined);
      next.ingest(batch);
    },
  }),
});

/** `POST /api/telemetry` in dev and tests: Tinker's checks, then the sink, then the queue. */
export const opsTelemetryRoute = operation({
  ...telemetryRoute,
  label: "ops.telemetryRoute",
  depends: { ...telemetryRoute.depends, sink: opsBrowserIngest },
});

/** `POST /api/telemetry` in production: Tinker's checks, then the sink, then the worker. */
export const opsThreadRoute = operation({
  ...telemetryRoute,
  label: "ops.threadRoute",
  depends: { ...telemetryRoute.depends, sink: opsThreadIngest },
});
