import { builtRuntime } from "@/kit/runtime.server";

/**
 * The runtime of app frames that the build put inside the binary (scripts/build-binary.ts, the
 * module `easel:runtime`; SPEC-kit.md § App frames, "The runtime"). `NODE_ENV` here is the build's
 * `--define`, not the runtime env: only the binary loads it. Dev and tests have none: their scope
 * builds the runtime from node_modules at its first use.
 */
export const runtime =
  process.env.NODE_ENV === "production"
    ? builtRuntime.parse((await import("easel:runtime")).default)
    : null;
