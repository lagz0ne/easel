import { z } from "zod";

import { modes } from "@/access/contract";
import { siteMeta } from "@/home/contract";

export const files: Record<string, string> =
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

const site = z.object({ mode: z.enum(modes), project: z.string().nullable() });

const siteHead = site.transform(({ mode, project }) =>
  [
    `<meta name="${siteMeta.mode}" content="${mode}">`,
    project === null
      ? ""
      : `<meta name="${siteMeta.project}" content="${Bun.escapeHTML(project)}">`,
  ].join(""),
);

export const sitePagesOf = z
  .object({ built: z.record(z.string(), z.string()), site })
  .transform(async ({ built, site }) => {
    const routes = pagesOf.parse(built);
    const index = built["/index.html"];
    if (!index) return routes;

    const head = siteHead.parse(site);
    const html = (await Bun.file(index).text()).replace("</head>", `${head}</head>`);
    const headers = { ...noReferrer, "content-type": "text/html;charset=utf-8" };

    return {
      ...routes,
      "/index.html": new Response(html, { headers }),
      "/*": new Response(html, { headers }),
    };
  });

const entryScript = /^\/assets\/index-[^/]+\.js$/;

export const entryOf = z
  .record(z.string(), z.string())
  .transform((built) => Object.keys(built).find((path) => entryScript.test(path)) ?? null);

export const clientEntry = entryOf.parse(files);
