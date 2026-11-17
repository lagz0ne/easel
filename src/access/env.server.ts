import { isIP } from "node:net";

import { z } from "zod";

// What the cmd reads from its env for access (fact rule 4: only the cmd reads the env). An empty
// value, as a compose file or an env form sets it, counts as unset.

/**
 * Whose `X-Forwarded-For` counts when `EASEL_TRUSTED_PROXIES` is unset: loopback only. Production
 * sets it: the Docker network's CIDR, where Traefik sits, and Cloudflare's ranges, whose edge
 * Traefik adds to the header.
 */
const proxies = "127.0.0.0/8,::1";

/** One CIDR: an IP address, and a prefix length that fits its family; no prefix is one host. */
const cidr = z.string().refine((entry) => {
  const [net = "", bits, ...rest] = entry.split("/");
  const max = isIP(net) === 6 ? 128 : isIP(net) === 4 ? 32 : 0;
  const ok = bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= max);

  return max > 0 && !rest.length && ok;
}, "not a CIDR");

/**
 * `EASEL_AUTH`: `approve` (the default) or `open`; any other value stops the start.
 * `EASEL_DB`: the SQLite file; unset, it is in memory and gone at exit.
 * `EASEL_TRUSTED_PROXIES`: CIDRs, comma separated; one that does not parse stops the start.
 * `PUBLIC_ORIGIN`: an `open` server starts only on a loopback one.
 * `NODE_ENV`: `production` makes an `approve` server refuse to start with no `EASEL_DB`; dev and
 * tests keep the in-memory default, with its warning in the log.
 */
export const accessEnv = z
  .object({
    EASEL_AUTH: z
      .string()
      .optional()
      .transform((raw) => raw || "approve")
      .pipe(z.enum(["approve", "open"])),
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
