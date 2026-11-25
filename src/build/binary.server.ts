import { operation } from "@tinkered/core";
import { z } from "zod";

import { buildRuntime } from "@/kit/runtime.server";

const targets: ReadonlyArray<{ target: Bun.Build.CompileTarget; binding: string }> = [
  { target: "bun-darwin-arm64", binding: "darwin-arm64" },
  { target: "bun-linux-x64-baseline", binding: "linux-x64-gnu" },
  { target: "bun-linux-arm64", binding: "linux-arm64-gnu" },
];

const hostBindings: Readonly<Record<string, string>> = {
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
};

const loaderExports: readonly string[] = [
  "Severity",
  "ParseResult",
  "ExportExportNameKind",
  "ExportImportNameKind",
  "ExportLocalNameKind",
  "ImportNameKind",
  "parse",
  "parseSync",
  "rawTransferSupported",
  "__napiBindingTarget",
  "getBufferOffset",
  "parseRaw",
  "parseRawSync",
];

const lazyWalk =
  /const require = createRequire\(import\.meta\.url\);[\s\S]*?require\("\.\/visitor\.js"\)\);/;

export const bindingOf = operation({
  label: "build.bindingOf",
  input: z.object({ target: z.string().optional(), host: z.string() }),
  run: (_, { input }) => {
    const picked = targets.find((one) => one.target === input.target);
    const binding = input.target ? picked?.binding : hostBindings[input.host];
    if (!binding) return { kind: "unknown" as const };
    return { kind: "binding" as const, target: picked?.target, binding };
  },
});

export const oxcBindings = operation({
  label: "build.oxcBindings",
  input: z.object({ original: z.string(), binding: z.string() }),
  run: (_, { input: { original, binding } }) => {
    const found = [...original.matchAll(/^export (?:const (\w+)|\{ ([\w, ]+) \})/gm)].flatMap((m) =>
      (m[1] ?? m[2] ?? "").split(/,\s*/),
    );
    if (found.sort().join() !== [...loaderExports].sort().join()) {
      throw new Error(
        `build-binary: oxc-parser's loader exports ${found.join(", ")}: update the plugin`,
      );
    }

    const names = loaderExports.filter((name) => name !== "__napiBindingTarget");
    return [
      `const binding = require("@oxc-parser/binding-${binding}/parser.${binding}.node");`,
      `export const { ${names.join(", ")} } = binding;`,
      `export const __napiBindingTarget = ${JSON.stringify(binding)};`,
    ].join("\n");
  },
});

export const oxcVisitor = operation({
  label: "build.oxcVisitor",
  input: z.string(),
  run: (_, { input: original }) => {
    if (!lazyWalk.test(original)) {
      throw new Error(
        "build-binary: oxc-parser's Visitor loads its walk in a new way: update the plugin",
      );
    }

    return [
      'import { walkProgram as staticWalk } from "../generated/visit/walk.js";',
      'import * as staticVisitor from "./visitor.js";',
      original.replace(
        lazyWalk,
        "({ walkProgram } = { walkProgram: staticWalk }); ({ addVisitorToCompiled, createCompiledVisitor, finalizeCompiledVisitor } = staticVisitor);",
      ),
    ].join("\n");
  },
});

export const compileBinary = operation({
  label: "build.compileBinary",
  input: z.object({
    entries: z.array(z.string()).min(1),
    outfile: z.string(),
    target: z.custom<Bun.Build.CompileTarget>().optional(),
    binding: z.string(),
    sourcemap: z.boolean(),
    metafile: z.string().optional(),
  }),
  depends: { buildRuntime, oxcBindings, oxcVisitor },
  run: async ({ buildRuntime, oxcBindings, oxcVisitor }, { input }) => {
    const { entries, outfile, target, binding } = input;
    const runtime = await buildRuntime.run();
    const result = await Bun.build({
      entrypoints: entries,
      compile: target ? { target, outfile } : { outfile },
      bytecode: true,
      throw: false,
      format: "esm",
      minify: true,
      sourcemap: input.sourcemap ? "linked" : "none",
      define: { "process.env.NODE_ENV": '"production"' },
      metafile: Boolean(input.metafile),
      plugins: [
        {
          name: "oxc-parser-static",
          setup: (build) => {
            build.onLoad({ filter: /oxc-parser[\\/]src-js[\\/]bindings\.js$/ }, async (args) => ({
              loader: "js",
              contents: oxcBindings.run({
                input: { original: await Bun.file(args.path).text(), binding },
              }),
            }));
            build.onLoad(
              { filter: /oxc-parser[\\/]src-js[\\/]visit[\\/]index\.js$/ },
              async (args) => ({
                loader: "js",
                contents: oxcVisitor.run({ input: await Bun.file(args.path).text() }),
              }),
            );
          },
        },
        {
          name: "easel-runtime",
          setup: (build) => {
            build.onResolve({ filter: /^easel:runtime$/ }, () => ({
              path: "easel:runtime",
              namespace: "easel-runtime",
            }));
            build.onLoad({ filter: /.*/, namespace: "easel-runtime" }, () => ({
              loader: "js",
              contents: `export default ${JSON.stringify(runtime)};`,
            }));
          },
        },
      ],
    });

    const logs = result.logs.map((log) => log.message);
    if (!result.success) return { kind: "failed" as const, logs };
    if (input.metafile && result.metafile) {
      await Bun.write(input.metafile, JSON.stringify(result.metafile));
    }
    const line = `build-binary: ${outfile} (${target ?? "this host"}, oxc-parser ${binding}, runtime ${runtime.sha.slice(0, 12)})`;
    return { kind: "built" as const, logs, line };
  },
});
