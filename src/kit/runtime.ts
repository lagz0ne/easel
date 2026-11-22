import { z } from "zod";

// The runtime of a kit version (SPEC-kit.md § App frames, "The runtime"): the shapes that the
// page, the CLI and the server share, so this file imports no server code. The bundle is made in
// `runtime.server.ts`; its files are served at `runtimePrefix` (`runtimeRoute`).

/**
 * The names that an app frame can import in the runtime of this easel: the package list of the
 * first kit version and the subpaths that the bundle has (`react/jsx-runtime` is the JSX of the
 * JS that easel makes). A new name comes with a new kit version.
 */
export const runtimeNames = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@tinkered/core",
  "@tinkered/react",
  "zod",
  "radix-ui",
  "lucide-react",
  "clsx",
  "class-variance-authority",
  "tailwind-merge",
  "@easel/frame",
  "@easel/kit",
] as const;

/** Where the files of a runtime are: `/api/runtime/<kit version>/<sha-256>/<file>`. */
export const runtimePrefix = "/api/runtime/";

/** The SHA-256 of a runtime, in hex. */
export const runtimeSha = z.string().regex(/^[0-9a-f]{64}$/, "not a runtime's SHA-256");

/** A file of a runtime: an entry (`react.js`) or a shared chunk (`chunk-1a2b3c4d.js`). */
export const runtimeFile = z.string().regex(/^[a-z0-9_-]+\.js$/, "not a runtime file");

/**
 * What a composed app frame needs of its runtime: the address of its files (with its kit version
 * and its SHA-256) and the file of each name that a frame can import.
 */
export const runtimeLink = z.object({
  address: z.string(),
  imports: z.record(z.string(), runtimeFile),
});

export type RuntimeLink = z.infer<typeof runtimeLink>;
