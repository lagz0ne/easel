import { tag } from "@tinkered/core";
import type { Operation } from "@tinkered/core";

// How other modules reach ops (SPEC-ops.md § Built on Tinker, fact rule 6): each binds an entry
// of these tags in its capsule's `tags`, as a capsule binds `routes.ns`. ops reads every entry,
// and imports no module that binds one.

type Maybe<T> = T | Promise<T>;

/** A readiness check: its name, and the operation that answers it (`/api/ready`). */
export type ReadinessEntry = {
  readonly name: string;
  readonly op: Operation.Handle<Maybe<{ readonly ok: boolean; readonly detail: string }>, void>;
};

export const readiness = tag<ReadinessEntry>({ label: "ops.readiness" });

/** A module's counters: its name, and the operation that counts (`ops.status`). */
export type CountersEntry = {
  readonly module: string;
  readonly op: Operation.Handle<Maybe<Readonly<Record<string, number>>>, void>;
};

export const counters = tag<CountersEntry>({ label: "ops.counters" });

/**
 * The fixer's lease entry: given a fingerprint, the claim whose lease is live on that group, or
 * null. The fixer binds it; until then there is none, and no group is held (fact rule 8).
 */
export type LeaseEntry = { readonly op: Operation.Handle<Maybe<string | null>, string> };

export const fixerLease = tag<LeaseEntry>({ label: "ops.fixerLease" });

/** The claim a run holds: the fixer binds it on `fixer.resolve` and `fixer.giveUp`. */
export const claim = tag<string>({ label: "ops.claim" });
