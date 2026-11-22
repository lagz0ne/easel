import { rpc } from "@tinkered/core";
import { z } from "zod";

import { pair } from "./compose";
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

export const kitApi = rpc({
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
  "look.get": ["found"],
  "look.set": ["updated", "unchanged"],
  "look.undo": ["updated"],
} as const satisfies { readonly [A in KitAddress]: readonly KindOf<A>[] };
