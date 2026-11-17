import { rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation, resource, tag } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { z } from "zod";

import { routes } from "~/components/requests/index.server";
import { quiet } from "~/components/telemetry/records";

import { caller } from "@/access/guards.server";
import { release } from "@/release";

import { errorGroup, opsOwnerApi, opsUserApi } from "./contract";
import type { Check } from "./contract";
import { claim, counters, fixerLease, readiness } from "./registry";
import type { CountersEntry, LeaseEntry, ReadinessEntry } from "./registry";
import { opsObserver, opsTelemetryRoute, opsThreadRoute } from "./sink.server";
import { caps, flushStore, opsFlusher, opsStore, saveGroup, stampFixer } from "./store.server";

// ops's calls, `/api/ready`, and the capsule that starts them (SPEC-ops.md § Contract). No call
// waits on the server (fact rule 7): each answers from memory, or from one write.

/** Past this long since the last tick, the fixer is silent (SPEC-ops.md § An agent checks). */
export const silentAfter = 30 * 60 * 1000;

/** A check that has not answered in this long fails, so `/api/ready` never hangs on one. */
const checkDeadline = 5000;

/** What modules registered (`opsServer`'s config), and the session their operations run in. */
type Registry = {
  readonly scope: Scope.Handle | null;
  readonly checks: readonly ReadinessEntry[];
  readonly counters: readonly CountersEntry[];
  readonly lease: readonly LeaseEntry[];
};

/** The registry the calls read; `opsServer`'s start fills it. None until then. */
const registry = resource({
  label: "ops.registry",
  target: "scope",
  factory: (): { current: Registry } => ({
    current: { scope: null, checks: [], counters: [], lease: [] },
  }),
});

/** Every module's checks, each bounded by `checkDeadline`, so `/api/ready` never hangs on one. */
const runChecks = operation({
  label: "ops.runChecks",
  depends: { registry },
  run: async ({ registry }, { clock }) => {
    const { scope, checks } = registry.current;

    return Promise.all(
      checks.map(async ({ name, op }): Promise<Check> => {
        const stop = new AbortController();
        const late = clock.sleep(checkDeadline, stop.signal).then(
          () => ({ ok: false, detail: "no answer in 5 s" }),
          () => ({ ok: false, detail: "stopped" }),
        );
        const answer = Promise.resolve()
          .then(() => (scope ? scope.run(op) : { ok: false, detail: "not started" }))
          .catch(() => ({ ok: false, detail: "the check failed" }));
        const got = await Promise.race([answer, late]);
        stop.abort();

        return { name, ...got };
      }),
    );
  },
});

/** Every module's counters, each named `<module>.<counter>`. */
const runCounters = operation({
  label: "ops.runCounters",
  depends: { registry },
  run: async ({ registry }) => {
    const { scope, counters } = registry.current;
    const all = await Promise.all(
      counters.map(async ({ module, op }) =>
        Object.entries(scope ? await scope.run(op) : {}).map(
          ([key, n]) => [`${module}.${key}`, n] as const,
        ),
      ),
    );

    return Object.fromEntries(all.flat());
  },
});

/** The claim whose fixer lease is live on the group, from the fixer's entry; null when none. */
const leaseOf = operation({
  label: "ops.leaseOf",
  input: z.string(),
  depends: { registry },
  run: async ({ registry }, { input: fingerprint }) => {
    const { scope, lease } = registry.current;
    const [entry] = lease;

    return entry && scope ? scope.run(entry.op, { input: fingerprint }) : null;
  },
});

/** The database file (EASEL_DB): the disk check writes in its directory. */
const database = tag<string>({ label: "ops.database", default: ":memory:" });

/** The disk check fails below this many free bytes: 100 MiB. */
const minFree = tag<number>({ label: "ops.minFree", default: 100 * 1024 * 1024 });

/** `database`: the file answers a read, and the last write worked. */
const databaseCheck = operation({
  label: "ops.check.database",
  depends: { connection: bunSqlite.connection, store: opsStore },
  run: async ({ connection, store }) => {
    connection.db.$client.query("SELECT 1").get();
    const failure = store.state.failure;

    if (failure !== null) return { ok: false, detail: `the last write failed: ${failure}` };

    return { ok: true, detail: "reads and writes" };
  },
});

/**
 * `disk`: a file can be written in the data directory, and the disk has `minFree` left. It writes
 * and removes a file, so it holds for root too, which file modes do not stop.
 */
const diskCheck = operation({
  label: "ops.check.disk",
  depends: { database, minFree },
  run: ({ database, minFree }) => {
    if (database === ":memory:") return { ok: true, detail: "in memory" };

    const dir = dirname(database);
    try {
      const probe = join(dir, ".easel-ready");
      writeFileSync(probe, "");
      rmSync(probe);
      const fs = statfsSync(dir);
      const free = fs.bavail * fs.bsize;
      const mib = Math.floor(free / 1024 / 1024);

      return { ok: free >= minFree, detail: `${mib} MiB free` };
    } catch (error) {
      return { ok: false, detail: `not writable: ${Object(error).code ?? "error"}` };
    }
  },
});

/** The fixer is silent when the stored tick, or the start when there is none, is 30 min old. */
const fixerState = operation({
  label: "ops.fixerState",
  depends: { store: opsStore },
  run: async ({ store }, { clock }) => {
    const { fixerSeen, startedAt } = store.state;
    const since = fixerSeen ?? startedAt;

    return { fixerSeen, fixerSilent: clock.currentTimeMillis() - since > silentAfter };
  },
});

/**
 * `GET /api/ready`: 200 when every check passes, 503 otherwise. It is public, so it names the
 * failing checks and gives no detail. A silent fixer does not make it unready.
 */
export const ready = operation({
  label: "ops.ready",
  input: z.object({}),
  depends: { runChecks, fixerState },
  run: async ({ runChecks, fixerState }) => {
    const checks = await runChecks.run();
    const failing = checks.filter((c) => !c.ok).map((c) => c.name);
    const body = { failing, ...(await fixerState.run()) };

    return Response.json(body, {
      status: failing.length ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  },
});

const hour = 60 * 60 * 1000;

/** The sightings of the last `span` ms, from the per-minute counts. */
const sightings = operation({
  label: "ops.sightings",
  input: z.number(),
  depends: { store: opsStore },
  run: async ({ store }, { input: span, clock }) => {
    const from = Math.floor((clock.currentTimeMillis() - span) / 60_000);
    let total = 0;
    for (const [minute, count] of store.state.minutes) if (minute > from) total += count;

    return total;
  },
});

/** The work list's statuses (`--open`). */
const openStatuses: ReadonlySet<string> = new Set(["open", "regressed"]);

/** `ops.status`: the build, the checks, the counters, the error counts and the fixer's tick. */
export const status = operation({
  label: "ops.status.do",
  input: opsUserApi["ops.status"].input,
  depends: {
    store: opsStore,
    version: release.version,
    runChecks,
    runCounters,
    fixerState,
    sightings,
  },
  run: async (deps, { clock }) => {
    const { store, sightings } = deps;
    const open = [...store.state.groups.values()].filter((g) => openStatuses.has(g.status));

    return {
      ...deps.version.run(),
      uptime: clock.currentTimeMillis() - store.state.startedAt,
      checks: await deps.runChecks.run(),
      counters: await deps.runCounters.run(),
      errors: {
        hour: await sightings.run({ input: hour }),
        day: await sightings.run({ input: 24 * hour }),
        open: open.length,
        unconfirmed: open.filter((g) => g.side === "browser").length,
        dropped: store.state.dropped,
      },
      ...(await deps.fixerState.run()),
    };
  },
});

/** `ops.errors`: the groups, newest sighting first. `open` is the work list: open and regressed. */
export const errors = operation({
  label: "ops.errors.do",
  input: opsOwnerApi["ops.errors"].input,
  depends: { store: opsStore },
  run: async ({ store }, { input }) => ({
    errors: [...store.state.groups.values()]
      .filter((g) => !input.open || openStatuses.has(g.status))
      .filter((g) => !input.side || g.side === input.side)
      .filter((g) => input.since === undefined || g.lastSeen >= input.since)
      .toSorted((a, b) => b.lastSeen - a.lastSeen)
      // A group as the contract shows it: its samples are `ops.error`'s.
      .map((g) => errorGroup.parse(g)),
  }),
});

/** `ops.error`: one group and its samples, by fingerprint, or by a `failed` fault's trace id. */
export const error = operation({
  label: "ops.error.do",
  input: opsOwnerApi["ops.error"].input,
  depends: { store: opsStore },
  run: async ({ store }, { input }) => {
    const groups = store.state.groups;
    const found =
      "fingerprint" in input
        ? groups.get(input.fingerprint)
        : [...groups.values()].find(
            (g) => g.traceId === input.trace || g.samples.some((s) => s.traceId === input.trace),
          );
    if (!found) return { kind: "gone" as const };

    return { kind: "found" as const, error: errorGroup.parse(found), samples: found.samples };
  },
});

/**
 * True while a fixer lease is live on the group and the run holds no claim that matches it (fact
 * rule 8). The rpc call carries no claim; `fixer.resolve` and `fixer.giveUp` bind theirs.
 */
const heldFrom = operation({
  label: "ops.heldFrom",
  input: z.string(),
  depends: { leaseOf, mine: claim.optional },
  run: async ({ leaseOf, mine }, { input: fingerprint }) => {
    const holder = await leaseOf.run({ input: fingerprint });

    return holder !== null && (!mine.present || mine.value !== holder);
  },
});

/**
 * `ops.resolveError`, and the fixer's `fixer.resolve` with its claim. `notLive` while the live
 * build is older than `n`; `failing` when the group was seen on a build >= `n`; otherwise
 * `resolved`, `fixedIn = n` (judged rule 7). The build is the release capsule's, the time the
 * run's clock (fact rule 3). A resolve the store cannot write throws: no answer says success.
 */
export const resolveError = operation({
  label: "ops.resolveError.do",
  input: opsOwnerApi["ops.resolveError"].input,
  depends: { store: opsStore, version: release.version, heldFrom, saveGroup },
  run: async ({ store, version, heldFrom, saveGroup }, { input }) => {
    if (await heldFrom.run({ input: input.fingerprint })) return { kind: "held" as const };
    const group = store.state.groups.get(input.fingerprint);
    if (!group) return { kind: "gone" as const };

    const live = version.run().build;
    if (live < input.build) return { kind: "notLive" as const, live };
    if (group.lastBuild >= input.build) return { kind: "failing" as const, seen: group.lastBuild };

    const saved = await saveGroup.run({
      input: { ...group, status: "resolved", fixedIn: input.build },
    });
    // Not stored is not resolved: the call fails (a `failed` fault), and the group is as it was.
    if (!saved) throw new Error(`ops: the resolve is not stored: ${store.state.failure}`);
    return { kind: "resolved" as const };
  },
});

/**
 * `ops.handOff`, and the fixer's `fixer.giveUp` with its claim: a person takes the group. A
 * hand-off the store cannot write throws, as a resolve does.
 */
export const handOff = operation({
  label: "ops.handOff.do",
  input: opsOwnerApi["ops.handOff"].input,
  depends: { store: opsStore, heldFrom, saveGroup },
  run: async ({ store, heldFrom, saveGroup }, { input }) => {
    if (await heldFrom.run({ input: input.fingerprint })) return { kind: "held" as const };
    const group = store.state.groups.get(input.fingerprint);
    if (!group) return { kind: "gone" as const };

    const saved = await saveGroup.run({
      input: { ...group, status: "human", reason: input.reason },
    });
    // Not stored is not handed: the call fails (a `failed` fault), and the group is as it was.
    if (!saved) throw new Error(`ops: the hand-off is not stored: ${store.state.failure}`);
    return { kind: "handed" as const };
  },
});

/**
 * `ops.fixerTick`: the fixer ran. The stamp is kept in memory first, then in the store, so a full
 * disk does not stop it: the stamp in memory holds until the store works again.
 */
export const fixerTick = operation({
  label: "ops.fixerTick.do",
  input: opsOwnerApi["ops.fixerTick"].input,
  depends: { stampFixer, me: caller.required },
  run: async ({ stampFixer }, { clock }) => {
    const at = clock.currentTimeMillis();
    await stampFixer.run({ input: at });

    return { kind: "stamped" as const, at };
  },
});

/** The server's side of `opsUserApi`: `ops.user({ implement: opsUserOps, onStart: [user] })`. */
export const opsUserOps = { "ops.status": status } as const;

/**
 * The server's side of `opsOwnerApi`:
 * `ops.owner({ implement: opsOwnerOps, onStart: [user, owner] })`.
 */
export const opsOwnerOps = {
  "ops.errors": errors,
  "ops.error": error,
  "ops.resolveError": resolveError,
  "ops.handOff": handOff,
  "ops.fixerTick": fixerTick,
} as const;

const setup = { role: "setup", explain: "Reads the error groups" } as const;

/**
 * The server's side of ops, filled by the cmd. Install it after `bunSqlite` and `release`. It
 * reads the groups, taps the record stream with the sink, and gathers every module's checks,
 * counters and the fixer's lease entry. `database`: `EASEL_DB`, whose directory the disk
 * check writes in; `minFree`: the free bytes the disk check asks for.
 */
export const opsServer = capsule({
  label: "opsServer",
  config: {
    database,
    minFree,
    caps,
    checks: readiness.all,
    counters: counters.all,
    lease: fixerLease.all,
  },
  tags: [
    readiness({ name: "database", op: databaseCheck }),
    readiness({ name: "disk", op: diskCheck }),
    // A tab's batch makes no span or log line, as Tinker's own route: the sink never sees itself.
    routes.ns({ op: opsTelemetryRoute, ns: quiet }),
    routes.ns({ op: opsThreadRoute, ns: quiet }),
  ],
  exports: { ready, resolveError, handOff, claim },
  hooks: {
    async start({ config, load, session, next, tap }) {
      await load(opsStore, setup);
      await load(opsFlusher, { role: "state", explain: "Writes the groups once a second" });
      tap(await load(opsObserver, { role: "state", explain: "Records each error" }, { ns: quiet }));

      const scope = session({}, { role: "handler", explain: "Runs the checks and counters" });
      const held = await load(registry, { role: "state", explain: "Holds the registry" });
      held.current = {
        scope,
        checks: config.checks,
        counters: config.counters,
        lease: config.lease,
      };
      await next();
    },
    // The SIGTERM drain (judged rule 8): what the sink changed is written before the store closes.
    // A close hook's own `run` is refused once the root closes; the start hook's session still runs.
    async close({ load, next }) {
      const held = await load(registry, { role: "state", explain: "Holds the registry" });
      await held.current.scope?.run(flushStore, { ns: quiet });

      return next();
    },
  },
});
