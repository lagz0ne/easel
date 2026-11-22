import { rpc } from "@tinkered/core";
import { z } from "zod";

import { capsuleRow, startRow } from "./capsules/row";
import { pair } from "./compose";
import { findingShape } from "./schema";
import { lookPatch } from "./shape";

// The kit's calls of a user (SPEC-kit.md § Contract). Each runs the `user` guard first (fact
// rule 1): any user may read and change the look. This step has the look's calls; the calls of
// the pieces come with the pieces (build order step 4).

/** A kit version, or a revision of the look: 1 or more. */
export const kitVersion = z.number().int().positive();

/** A DTCG file, as `look.get` answers it. */
const dtcgFile = z.record(z.string(), z.unknown());

const revAndKit = { rev: kitVersion, kit: kitVersion };

/** The answer of `look.get`. */
export const lookGetOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("found"), kit: kitVersion, rev: kitVersion, look: dtcgFile }),
  z.object({ kind: z.literal("gone") }),
]);

/** The answer of `look.set`. */
export const lookSetOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["updated", "unchanged"]), ...revAndKit }),
  z.object({ kind: z.literal("stale"), ...revAndKit }),
  z.object({ kind: z.literal("unreadable"), fails: z.array(pair) }),
]);

/**
 * `kit.check`'s input: an HTML frame or an app frame (SPEC-kit.md § Contract), as `frame.put`
 * takes it.
 */
export const kitCheckInput = z.union([
  z.strictObject({ html: z.string() }),
  z.strictObject({ tsx: z.string() }),
]);

/** The answer of `kit.check`. `tooBig`: over the size limit of `frame.put` for its kind. */
export const kitCheckOutput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("checked"),
    kit: kitVersion,
    findings: z.array(findingShape),
    more: z.number(),
  }),
  z.object({ kind: z.literal("tooBig"), maxBytes: z.number() }),
]);

/** The answer of `kit.capsules`: the kit version, the start of its capsules, and each capsule. */
export const kitCapsulesOutput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    kit: kitVersion,
    start: startRow,
    capsules: z.array(capsuleRow),
  }),
]);

export const kitApi = rpc({
  /**
   * The capsules of the current kit version (SPEC-kit.md § The capsules): what each does, how a
   * frame installs it, its config with its schema, and each export with its kind, a line that
   * uses it, its edges in the graph, its input schema and its texts. `start` says if they start
   * with the look of the kit version.
   */
  "kit.capsules": {
    input: z.object({}),
    output: kitCapsulesOutput,
  },
  /**
   * The check of `frame.put` on a document, against the current kit version, and nothing written:
   * the first 20 findings in document order, and `more`. An app frame gets the findings that
   * refuse its put too (`kit/parse`, `kit/import`, `kit/react-state`, `kit/shape`).
   */
  "kit.check": {
    input: kitCheckInput,
    output: kitCheckOutput,
  },
  /**
   * The look: the current one, or (`at`) the one of a stored kit version, with its revision.
   * A kit version that is not stored answers `gone`.
   */
  "look.get": {
    input: z.object({ at: kitVersion.optional() }),
    output: lookGetOutput,
  },
  /**
   * A change of the look on the revision `base`: a JSON Merge Patch of values only. A look that
   * fails a pair of K8 answers `unreadable` with each failing pair; an old base answers `stale`
   * with the current revision; the same values answer `unchanged`. Each refusal writes nothing.
   */
  "look.set": {
    input: z.object({ look: lookPatch, base: kitVersion }),
    output: lookSetOutput,
  },
  /**
   * One step back on the revision `base`: the look from before the last change of the look, as a
   * new kit version. With no change of the look yet, it answers `none`.
   */
  "look.undo": {
    input: z.object({ base: kitVersion }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("updated"), ...revAndKit }),
      z.object({ kind: z.literal("stale"), ...revAndKit }),
      z.object({ kind: z.literal("none") }),
    ]),
  },
});

export type KitAddress = Extract<keyof typeof kitApi.contracts, string>;

type KindOf<A extends KitAddress> =
  Awaited<ReturnType<(typeof kitApi)[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

/**
 * SPEC.md rule 1: the one list of success kinds, by call (SPEC-kit.md § Contract). The CLI's
 * exit code reads it.
 */
export const kitSuccessKinds = {
  "kit.capsules": ["found"],
  "kit.check": ["checked"],
  "look.get": ["found"],
  "look.set": ["updated", "unchanged"],
  "look.undo": ["updated"],
} as const satisfies { readonly [A in KitAddress]: readonly KindOf<A>[] };
