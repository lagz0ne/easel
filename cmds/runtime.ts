import { builtRuntime } from "@/kit/runtime.server";

export const runtime =
  process.env.NODE_ENV === "production"
    ? builtRuntime.parse((await import("easel:runtime")).default)
    : null;
