import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { runtimeFile, runtimeNames, runtimePrefix, runtimeSha } from "./runtime";

// The runtime of a kit version (SPEC-kit.md § App frames, "The runtime"; frame-apps decision 2):
// one ESM bundle of the packages that an app frame can import, built by `Bun.build` from the
// exact pins of package.json, with one entry file for each name (`react.js`, `zod.js`, ...) and
// the code they share in chunks. The import map of a composed app frame points each name to its
// entry. A kit version gets its runtime at its first use, and keeps it (K11): `runtimeOf` writes
// it one time, and nothing makes it again. The release binary holds the runtime that its build
// made (`kitRuntime`, from scripts/build-binary.ts); dev and the tests build it once in a scope.

/** A built runtime: its SHA-256, the entry file of each name, and the text of each file. */
export const builtRuntime = z.object({
  sha: runtimeSha,
  imports: z.record(z.string(), runtimeFile),
  files: z.record(runtimeFile, z.string()),
});

export type BuiltRuntime = z.infer<typeof builtRuntime>;

/**
 * The runtime that the build of the binary made; null in dev and the tests, where the scope
 * builds it from node_modules at its first use. The cmd gives it.
 */
export const kitRuntime = tag<BuiltRuntime | null>({ label: "kit.runtime", default: null });

/** The packages with no ESM build: their entry names each export, so the bundle has them all. */
const commonJs = new Set<string>(["react", "react/jsx-runtime", "react-dom", "react-dom/client"]);

/** The entry file of a name: `@tinkered/core` is `tinkered__core.js`. */
const fileOf = z.string().transform((name) => `${name.replace(/^@/, "").replaceAll("/", "__")}.js`);

/** The text of the entry file of each name: an `export *` of the package, or each name of it. */
export const runtimeEntries = operation({
  label: "kit.runtimeEntries",
  run: async () => {
    const entries: Record<string, string> = {};
    for (const name of runtimeNames) {
      const file = fileOf.parse(name);
      if (name === "@easel/frame") {
        entries[file] = 'export * from "./easel-frame.ts";';
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

/**
 * Builds the runtime of this easel: the entries, bundled for the browser with React's production
 * build, minified, the shared code in chunks named by their hash. The SHA-256 is of the file
 * names and texts, in name order, so the same pins give the same SHA-256.
 */
export const buildRuntime = operation({
  label: "kit.buildRuntime",
  depends: { runtimeEntries },
  run: async ({ runtimeEntries }) => {
    const entries = await runtimeEntries.run();
    // The entries are files in memory, beside this file, so each name resolves from node_modules.
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

/** The runtime of this easel once it is built, and the files of each stored runtime that was read. */
export const runtimeCache = resource({
  label: "kit.runtimeCache",
  target: "scope",
  factory: (): {
    built: Promise<BuiltRuntime> | null;
    files: Map<string, Promise<Record<string, string> | null>>;
  } => ({ built: null, files: new Map() }),
});

/** The runtime of this easel: the one of the binary, or built one time in this scope. */
export const easelRuntime = operation({
  label: "kit.easelRuntime",
  depends: { given: kitRuntime, cache: runtimeCache, buildRuntime },
  run: ({ given, cache, buildRuntime }) => {
    if (given) return given;

    cache.built ??= buildRuntime.run();
    return cache.built;
  },
});

/** A stored runtime as the check and compose read it: its SHA-256 and the entry of each name. */
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

/**
 * The runtime of the kit version `input`: the stored one, or, at its first use, the runtime of
 * this easel, written one time (K11). One transaction writes the files (once for each SHA-256)
 * and sets the kit version's runtime only where it has none, so of two first uses the first wins.
 * Null when the kit version is not stored.
 */
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

/**
 * The names that an app frame of the kit version `input` can import: those of its runtime, or,
 * with none stored yet, those of the runtime that this easel will give it. It writes nothing.
 */
export const runtimeNamesOf = operation({
  label: "kit.runtimeNamesOf",
  input: z.number(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: version }) => {
    const stored = connection.db.$client.query(runtimeOfVersion).get(version);
    return stored === null ? [...runtimeNames] : Object.keys(storedRuntime.parse(stored).imports);
  },
});

/** The address of the files of a stored runtime: its kit version and its SHA-256. */
export const runtimeAddress = operation({
  label: "kit.runtimeAddress",
  input: z.object({ kit: z.number(), sha: z.string() }),
  run: (_, { input }) => `${runtimePrefix}${input.kit}/${input.sha}/`,
});

/** The files of the runtime `sha` of the kit version `kit`, as stored; null when it has no such runtime. */
const storedFiles = operation({
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
    // A runtime that is not stored yet may be stored later: only a found one is kept.
    if (files) cache.files.set(key, read);
    return read;
  },
});

/** The path words of a runtime file's address, as the route gives them. */
const routeInput = z.object({ kit: z.string(), sha: z.string(), file: z.string() });

/**
 * The headers of a runtime file: it never changes at its address, and a frame's origin is `null`,
 * so any origin may load it (SPEC-kit.md § App frames, "compose of an app frame").
 */
const runtimeHeaders = {
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "public, max-age=31536000, immutable",
  "Access-Control-Allow-Origin": "*",
};

/**
 * `GET /api/runtime/{kit}/{sha}/{file}`: one file of the runtime of a kit version, from its stored
 * bytes. No user and no pass: the runtime is the code of the package list, the same for each
 * team. A kit version that is not stored, another SHA-256, or a file that the runtime does not
 * have answers 404.
 */
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
