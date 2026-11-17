import { capsule, operation, tag } from "@tinkered/core";
import { z } from "zod";

/** The git commit this server was built from; the cmd fills it ("dev" when it runs from source). */
const commit = tag<string>({ label: "release.commit", parse: z.string().min(1) });

/**
 * The build number: the count of commits on main up to `commit` (SPEC-ops.md § The build
 * number). main is one straight line, so a larger number is a later build. 0 from source.
 */
const build = tag<number>({
  label: "release.build",
  default: 0,
  parse: z.number().int().nonnegative(),
});

/** `GET /api/version`: the deploy job waits until the public site names the commit it shipped. */
const version = operation({
  label: "release.version",
  depends: { commit, build },
  run: ({ commit, build }) => ({ commit, build }),
});

/** Which build is live. Others import this file by its own path (ADR 0160). */
export const release = capsule({
  label: "release",
  config: { commit: commit.required, build },
  exports: { version },
});
