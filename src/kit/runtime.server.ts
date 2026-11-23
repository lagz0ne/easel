import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { runtimeFile, runtimeNames, runtimePrefix, runtimeSha } from "./runtime";

export const builtRuntime = z.object({
  sha: runtimeSha,
  imports: z.record(z.string(), runtimeFile),
  files: z.record(runtimeFile, z.string()),
});

export type BuiltRuntime = z.infer<typeof builtRuntime>;

export const kitRuntime = tag<BuiltRuntime | null>({ label: "kit.runtime", default: null });

const commonJs = new Set<string>(["react", "react/jsx-runtime", "react-dom", "react-dom/client"]);

const easelEntries = new Map<string, string>([
  ["@easel/frame", 'export * from "./easel-frame.ts";'],
  [
    "@easel/kit",
    'export * from "./capsules/look.ts";\nexport * from "./capsules/copy.ts";\nexport * from "./capsules/ui.tsx";',
  ],
]);

const fileOf = z.string().transform((name) => `${name.replace(/^@/, "").replaceAll("/", "__")}.js`);

export const runtimeEntries = operation({
  label: "kit.runtimeEntries",
  run: async () => {
    const entries: Record<string, string> = {};
    for (const name of runtimeNames) {
      const file = fileOf.parse(name);
      const own = easelEntries.get(name);
      if (own) {
        entries[file] = own;
        continue;
      }
      if (!commonJs.has(name)) {
        entries[file] = `export * from "${name}";`;
        continue;
      }

      const loaded: Record<string, unknown> = await import(name);
      const names = Object.keys(loaded)
        .filter((key) => key !== "default" && /^[A-Za-z_$][\w$]*$/.test(key))
        .sort();
      entries[file] =
        `export { ${names.join(", ")} } from "${name}";\n` +
        `import entry from "${name}";\nexport default entry;`;
    }
    return entries;
  },
});

export const buildRuntime = operation({
  label: "kit.buildRuntime",
  depends: { runtimeEntries },
  run: async ({ runtimeEntries }) => {
    const entries = await runtimeEntries.run();
    const dir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
    const files = Object.fromEntries(
      Object.entries(entries).map(([file, text]) => [`${dir}/${file}`, text]),
    );
    const built = await Bun.build({
      entrypoints: Object.keys(files),
      files,
      root: dir,
      target: "browser",
      format: "esm",
      splitting: true,
      minify: true,
      naming: { entry: "[name].[ext]", chunk: "chunk-[hash].[ext]" },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    if (!built.success) {
      throw new Error(
        `kit: the runtime does not build: ${built.logs.map((l) => l.message).join("; ")}`,
      );
    }

    const out: Array<[string, string]> = [];
    for (const output of built.outputs) {
      out.push([output.path.replace(/^\.\//, ""), await output.text()]);
    }
    out.sort(([a], [b]) => (a < b ? -1 : 1));
    const imports = Object.fromEntries(runtimeNames.map((name) => [name, fileOf.parse(name)]));
    const sha = createHash("sha256")
      .update(JSON.stringify([imports, out]))
      .digest("hex");
    return builtRuntime.parse({ sha, imports, files: Object.fromEntries(out) });
  },
});

export const runtimeCache = resource({
  label: "kit.runtimeCache",
  target: "scope",
  factory: (): {
    built: Promise<BuiltRuntime> | null;
    files: Map<string, Promise<Record<string, string> | null>>;
  } => ({ built: null, files: new Map() }),
});

export const easelRuntime = operation({
  label: "kit.easelRuntime",
  depends: { given: kitRuntime, cache: runtimeCache, buildRuntime },
  run: ({ given, cache, buildRuntime }) => {
    if (given) return given;

    cache.built ??= buildRuntime.run();
    return cache.built;
  },
});

const storedRuntime = z.object({
  sha: runtimeSha,
  imports: z
    .string()
    .transform((text): unknown => JSON.parse(text))
    .pipe(z.record(z.string(), runtimeFile)),
});

export type StoredRuntime = z.infer<typeof storedRuntime>;

const runtimeOfVersion = `SELECT r.sha, r.imports FROM kit_versions v
  JOIN kit_runtimes r ON r.sha = v.runtime WHERE v.version = ?`;

export const runtimeOf = operation({
  label: "kit.runtimeOf",
  input: z.number(),
  depends: { connection: bunSqlite.connection, easelRuntime },
  run: async ({ connection, easelRuntime }, { input: version, clock }) => {
    const db = connection.db.$client;
    const stored = db.query(runtimeOfVersion).get(version);
    if (stored !== null) return storedRuntime.parse(stored);
    if (db.query("SELECT 1 FROM kit_versions WHERE version = ?").get(version) === null) return null;

    const built = await easelRuntime.run();
    db.transaction(() => {
      db.query(
        "INSERT OR IGNORE INTO kit_runtimes (sha, imports, files, made) VALUES (?, ?, ?, ?)",
      ).run(
        built.sha,
        JSON.stringify(built.imports),
        JSON.stringify(built.files),
        clock.currentTimeMillis(),
      );
      db.query("UPDATE kit_versions SET runtime = ? WHERE version = ? AND runtime IS NULL").run(
        built.sha,
        version,
      );
    })();
    return storedRuntime.parse(db.query(runtimeOfVersion).get(version));
  },
});

export const runtimeNamesOf = operation({
  label: "kit.runtimeNamesOf",
  input: z.number(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: version }) => {
    const stored = connection.db.$client.query(runtimeOfVersion).get(version);
    return stored === null ? [...runtimeNames] : Object.keys(storedRuntime.parse(stored).imports);
  },
});

export const runtimeAddress = operation({
  label: "kit.runtimeAddress",
  input: z.object({ kit: z.number(), sha: z.string() }),
  run: (_, { input }) => `${runtimePrefix}${input.kit}/${input.sha}/`,
});

export const storedFiles = operation({
  label: "kit.storedFiles",
  input: z.object({ kit: z.number(), sha: z.string() }),
  depends: { connection: bunSqlite.connection, cache: runtimeCache },
  run: async ({ connection, cache }, { input }) => {
    const key = `${input.kit}/${input.sha}`;
    const known = cache.files.get(key);
    if (known) return known;

    const row = connection.db.$client
      .query(
        `SELECT r.files FROM kit_versions v JOIN kit_runtimes r ON r.sha = v.runtime
         WHERE v.version = ? AND v.runtime = ?`,
      )
      .get(input.kit, input.sha);
    const files =
      row === null
        ? null
        : z
            .object({ files: z.string() })
            .transform(({ files }): unknown => JSON.parse(files))
            .pipe(z.record(z.string(), z.string()))
            .parse(row);
    const read = Promise.resolve(files);
    if (files) cache.files.set(key, read);
    return read;
  },
});

const routeInput = z.object({ kit: z.string(), sha: z.string(), file: z.string() });

const runtimeHeaders = {
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "public, max-age=31536000, immutable",
  "Access-Control-Allow-Origin": "*",
};

export const runtimeRoute = operation({
  label: "kit.runtimeRoute",
  input: routeInput,
  depends: { storedFiles },
  run: async ({ storedFiles }, { input }) => {
    const missing = new Response("not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
    });
    const kit = z
      .string()
      .regex(/^[1-9]\d{0,8}$/)
      .transform(Number)
      .safeParse(input.kit);
    const sha = runtimeSha.safeParse(input.sha);
    const file = runtimeFile.safeParse(input.file);
    if (!kit.success || !sha.success || !file.success) return missing;

    const files = await storedFiles.run({ input: { kit: kit.data, sha: sha.data } });
    const text = files?.[file.data];
    return text === undefined ? missing : new Response(text, { headers: runtimeHeaders });
  },
});
