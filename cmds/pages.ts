import { z } from "zod";

/**
 * The client files the build put inside the binary. `NODE_ENV` here is the build's `--define`, not
 * the runtime env: only the binary loads them. Dev and tests have none (Vite serves the page).
 */
const files: Record<string, string> =
  process.env.NODE_ENV === "production" ? (await import("./client-files.gen")).default : {};

/**
 * Every page and file says `Referrer-Policy: no-referrer`, so a share link in the address bar
 * does not leave in a `Referer` (SPEC-frames judged rule 15, decision C11).
 */
const noReferrer = { "referrer-policy": "no-referrer" };

/** Hashed assets never change; the page itself is read fresh. */
const immutable = { ...noReferrer, "cache-control": "public, max-age=31536000, immutable" };

/** Each client file as a static route, and the page for every other path (a deep link). */
export const pagesOf = z.record(z.string(), z.string()).transform((built) => {
  const routes: Record<string, Response> = {};
  for (const [path, file] of Object.entries(built)) {
    const headers = path.startsWith("/assets/") ? immutable : noReferrer;
    routes[path] = new Response(Bun.file(file), { headers });
  }
  const index = built["/index.html"];
  if (index) routes["/*"] = new Response(Bun.file(index), { headers: noReferrer });

  return routes;
});

export const pages = pagesOf.parse(files);
