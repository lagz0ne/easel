import { capsule, operation, tag } from "@tinkered/core";
import { z } from "zod";

/** The git commit this server was built from; the cmd fills it ("dev" when it runs from source). */
const commit = tag<string>({ label: "release.commit", parse: z.string().min(1) });

/** `GET /api/version`: the deploy job waits until the public site names the commit it shipped. */
const version = operation({
  label: "release.version",
  depends: { commit },
  run: ({ commit }) => ({ commit }),
});

/** Which build is live. Others import this file by its own path (ADR 0160). */
export const release = capsule({
  label: "release",
  config: { commit: commit.required },
  exports: { version },
});
