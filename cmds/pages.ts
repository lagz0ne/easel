import { z } from "zod";

const files: Record<string, string> =
  process.env.NODE_ENV === "production" ? (await import("./client-files.gen")).default : {};

const noReferrer = {
  "referrer-policy": "no-referrer",
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

const immutable = { ...noReferrer, "cache-control": "public, max-age=31536000, immutable" };

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

const entryScript = /^\/assets\/index-[^/]+\.js$/;

export const entryOf = z
  .record(z.string(), z.string())
  .transform((built) => Object.keys(built).find((path) => entryScript.test(path)) ?? null);

export const clientEntry = entryOf.parse(files);
