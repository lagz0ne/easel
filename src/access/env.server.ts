import { isIP } from "node:net";

import { z } from "zod";

import { modes } from "./contract";

const proxies = "127.0.0.0/8,::1";

const cidr = z.string().refine((entry) => {
  const [net = "", bits, ...rest] = entry.split("/");
  const max = isIP(net) === 6 ? 128 : isIP(net) === 4 ? 32 : 0;
  const ok = bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= max);

  return max > 0 && !rest.length && ok;
}, "not a CIDR");

export const accessEnv = z
  .object({
    EASEL_AUTH: z
      .string()
      .optional()
      .transform((raw) => raw || "approve")
      .pipe(z.enum(modes)),
    EASEL_DB: z
      .string()
      .optional()
      .transform((raw) => raw || ":memory:"),
    EASEL_TRUSTED_PROXIES: z
      .string()
      .optional()
      .transform((raw) =>
        (raw || proxies)
          .split(",")
          .map((cidr) => cidr.trim())
          .filter(Boolean),
      )
      .pipe(z.array(cidr)),
    PUBLIC_ORIGIN: z
      .string()
      .optional()
      .transform((raw) => raw || null),
    NODE_ENV: z.string().optional(),
  })
  .transform((env) => ({
    mode: env.EASEL_AUTH,
    file: env.EASEL_DB,
    origin: env.PUBLIC_ORIGIN,
    trusted: env.EASEL_TRUSTED_PROXIES,
    durable: env.NODE_ENV === "production",
  }));
