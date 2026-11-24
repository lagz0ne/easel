import { rpc } from "@tinkered/core";
import { z } from "zod";

import { capsuleRow, startRow } from "./capsules/row";
import { pair } from "./compose";
import { cellLabel, fixturesPatch, kitFixtures } from "./fixtures";
import { findingShape } from "./schema";
import { lookPatch } from "./shape";
import { teamTexts, textFinding, textKey, textsPatch } from "./texts";

export const kitVersion = z.number().int().positive();

const dtcgFile = z.record(z.string(), z.unknown());

const revAndKit = { rev: kitVersion, kit: kitVersion };

export const lookGetOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("found"), kit: kitVersion, rev: kitVersion, look: dtcgFile }),
  z.object({ kind: z.literal("gone") }),
]);

export const lookSetOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["updated", "unchanged"]), ...revAndKit }),
  z.object({ kind: z.literal("stale"), ...revAndKit }),
  z.object({ kind: z.literal("unreadable"), fails: z.array(pair) }),
]);

export const textsListOutput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    ...revAndKit,
    texts: teamTexts,
    noVi: z.array(textKey),
  }),
]);

export const textsSetOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["updated", "unchanged"]), ...revAndKit }),
  z.object({ kind: z.literal("stale"), ...revAndKit }),
  z.object({ kind: z.literal("invalid"), findings: z.array(textFinding) }),
  z.object({ kind: z.literal("tooBig"), maxBytes: z.number() }),
]);

export const fixturesListOutput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    ...revAndKit,
    cells: z.array(z.object({ label: cellLabel, names: z.array(z.string()) })),
    fixtures: kitFixtures,
  }),
]);

export const fixturesSetOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["updated", "unchanged"]), ...revAndKit }),
  z.object({ kind: z.literal("stale"), ...revAndKit }),
  z.object({ kind: z.literal("tooBig"), maxBytes: z.number() }),
]);

export const kitCheckInput = z.union([
  z.strictObject({ html: z.string() }),
  z.strictObject({ tsx: z.string() }),
]);

export const kitCheckOutput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("checked"),
    kit: kitVersion,
    findings: z.array(findingShape),
    more: z.number(),
  }),
  z.object({ kind: z.literal("tooBig"), maxBytes: z.number() }),
]);

export const kitCapsulesOutput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    kit: kitVersion,
    start: startRow,
    capsules: z.array(capsuleRow),
  }),
]);

export const kitContracts = {
  "kit.capsules": {
    input: z.object({}),
    output: kitCapsulesOutput,
  },
  "kit.check": {
    input: kitCheckInput,
    output: kitCheckOutput,
  },
  "kit.accept": {
    input: z.object({}),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("updated"), ...revAndKit, runtime: z.string() }),
      z.object({ kind: z.literal("unchanged"), ...revAndKit }),
    ]),
  },
  "look.get": {
    input: z.object({ at: kitVersion.optional() }),
    output: lookGetOutput,
  },
  "look.set": {
    input: z.object({ look: lookPatch, base: kitVersion }),
    output: lookSetOutput,
  },
  "look.undo": {
    input: z.object({ base: kitVersion }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("updated"), ...revAndKit }),
      z.object({ kind: z.literal("stale"), ...revAndKit }),
      z.object({ kind: z.literal("none") }),
    ]),
  },
  "texts.list": {
    input: z.object({}),
    output: textsListOutput,
  },
  "texts.set": {
    input: z.object({ texts: textsPatch, base: kitVersion.optional() }),
    output: textsSetOutput,
  },
  "fixtures.list": {
    input: z.object({}),
    output: fixturesListOutput,
  },
  "fixtures.set": {
    input: z.object({ cell: cellLabel, fixtures: fixturesPatch, base: kitVersion.optional() }),
    output: fixturesSetOutput,
  },
};

export const kitApi = rpc(kitContracts);

export type KitAddress = Extract<keyof typeof kitApi.contracts, string>;

type KindOf<A extends KitAddress> =
  Awaited<ReturnType<(typeof kitApi)[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

export const kitSuccessKinds = {
  "kit.capsules": ["found"],
  "kit.check": ["checked"],
  "kit.accept": ["updated", "unchanged"],
  "look.get": ["found"],
  "look.set": ["updated", "unchanged"],
  "look.undo": ["updated"],
  "texts.list": ["found"],
  "texts.set": ["updated", "unchanged"],
  "fixtures.list": ["found"],
  "fixtures.set": ["updated", "unchanged"],
} as const satisfies { readonly [A in KitAddress]: readonly KindOf<A>[] };
