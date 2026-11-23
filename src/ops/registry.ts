import { tag } from "@tinkered/core";
import type { Operation } from "@tinkered/core";

type Maybe<T> = T | Promise<T>;

export type ReadinessEntry = {
  readonly name: string;
  readonly op: Operation.Handle<Maybe<{ readonly ok: boolean; readonly detail: string }>, void>;
};

export const readiness = tag<ReadinessEntry>({ label: "ops.readiness" });

export type CountersEntry = {
  readonly module: string;
  readonly op: Operation.Handle<Maybe<Readonly<Record<string, number>>>, void>;
};

export const counters = tag<CountersEntry>({ label: "ops.counters" });

export type LeaseEntry = { readonly op: Operation.Handle<Maybe<string | null>, string> };

export const fixerLease = tag<LeaseEntry>({ label: "ops.fixerLease" });

export const claim = tag<string>({ label: "ops.claim" });
