import { z } from "zod";

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

export const runtimePrefix = "/api/runtime/";

export const runtimeSha = z.string().regex(/^[0-9a-f]{64}$/, "not a runtime's SHA-256");

export const runtimeFile = z.string().regex(/^[a-z0-9_-]+\.js$/, "not a runtime file");

export const runtimeLink = z.object({
  address: z.string(),
  imports: z.record(z.string(), runtimeFile),
});

export type RuntimeLink = z.infer<typeof runtimeLink>;
