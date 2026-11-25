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
import { buildCap, checkDeadline, messageCap, sampleCap, silentAfter } from "./settings";
import { opsObserver, opsTelemetryRoute, opsThreadRoute } from "./sink.server";
import { caps, flushStore, opsFlusher, opsStore, saveGroup, stampFixer } from "./store.server";

type Registry = {
  readonly scope: Scope.Handle | null;
  readonly checks: readonly ReadinessEntry[];
  readonly counters: readonly CountersEntry[];
  readonly lease: readonly LeaseEntry[];
};

const registry = resource({
  label: "ops.registry",
  target: "scope",
  factory: (): { current: Registry } => ({
    current: { scope: null, checks: [], counters: [], lease: [] },
  }),
});

const runChecks = operation({
  label: "ops.runChecks",
  depends: { registry, checkDeadline },
  run: async ({ registry, checkDeadline }, { clock }) => {
    const { scope, checks } = registry.current;

    return Promise.all(
      checks.map(async ({ name, op }): Promise<Check> => {
        const stop = new AbortController();
        const late = clock.sleep(checkDeadline, stop.signal).then(
          () => ({ ok: false, detail: `no answer in ${checkDeadline / 1000} s` }),
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

const database = tag<string>({ label: "ops.database", default: ":memory:" });

const minFree = tag<number>({ label: "ops.minFree", default: 100 * 1024 * 1024 });

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

const fixerState = operation({
  label: "ops.fixerState",
  depends: { store: opsStore, silentAfter },
  run: async ({ store, silentAfter }, { clock }) => {
    const { fixerSeen, startedAt } = store.state;
    const since = fixerSeen ?? startedAt;

    return { fixerSeen, fixerSilent: clock.currentTimeMillis() - since > silentAfter };
  },
});

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

const openStatuses: ReadonlySet<string> = new Set(["open", "regressed"]);

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
      .map((g) => errorGroup.parse(g)),
  }),
});

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

const heldFrom = operation({
  label: "ops.heldFrom",
  input: z.string(),
  depends: { leaseOf, mine: claim.optional },
  run: async ({ leaseOf, mine }, { input: fingerprint }) => {
    const holder = await leaseOf.run({ input: fingerprint });

    return holder !== null && (!mine.present || mine.value !== holder);
  },
});

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
    if (!saved) throw new Error(`ops: the resolve is not stored: ${store.state.failure}`);
    return { kind: "resolved" as const };
  },
});

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
    if (!saved) throw new Error(`ops: the hand-off is not stored: ${store.state.failure}`);
    return { kind: "handed" as const };
  },
});

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

export const opsUserOps = { "ops.status": status } as const;

export const opsOwnerOps = {
  "ops.errors": errors,
  "ops.error": error,
  "ops.resolveError": resolveError,
  "ops.handOff": handOff,
  "ops.fixerTick": fixerTick,
} as const;

const setup = { role: "setup", explain: "Reads the error groups" } as const;

export const opsServer = capsule({
  label: "opsServer",
  config: {
    database,
    minFree,
    caps,
    checks: readiness.all,
    counters: counters.all,
    lease: fixerLease.all,
    silentAfter,
    checkDeadline,
    messageCap,
    sampleCap,
    buildCap,
  },
  tags: [
    readiness({ name: "database", op: databaseCheck }),
    readiness({ name: "disk", op: diskCheck }),
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
    async close({ load, next }) {
      const held = await load(registry, { role: "state", explain: "Holds the registry" });
      await held.current.scope?.run(flushStore, { ns: quiet });

      return next();
    },
  },
});
