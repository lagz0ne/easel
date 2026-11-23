import { parseArgs } from "node:util";

import { createScope } from "@tinkered/core";
import type { BunPlugin } from "bun";

import { buildRuntime } from "@/kit/runtime.server";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    outfile: { type: "string" },
    target: { type: "string" },
    sourcemap: { type: "boolean", default: false },
    metafile: { type: "string" },
    entry: { type: "string", multiple: true },
  },
});

const outfile = values.outfile;

if (!outfile) {
  console.error("usage: bun scripts/build-binary.ts --outfile <file> [--target <bun target>]");
  process.exit(64);
}

const targets: Array<{ target: Bun.Build.CompileTarget; binding: string }> = [
  { target: "bun-darwin-arm64", binding: "darwin-arm64" },
  { target: "bun-linux-x64-baseline", binding: "linux-x64-gnu" },
  { target: "bun-linux-arm64", binding: "linux-arm64-gnu" },
];

const hosts: Record<string, string> = {
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
};

const picked = targets.find((one) => one.target === values.target);
const target = picked?.target;
const binding = values.target ? picked?.binding : hosts[`${process.platform}-${process.arch}`];

if (!binding) {
  console.error(`build-binary: no oxc-parser binding for ${values.target ?? process.platform}`);
  process.exit(64);
}

const loaderExports = [
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

const oxcStatic: BunPlugin = {
  name: "oxc-parser-static",
  setup(build) {
    build.onLoad({ filter: /oxc-parser[\\/]src-js[\\/]bindings\.js$/ }, async ({ path }) => {
      const original = await Bun.file(path).text();
      const found = [...original.matchAll(/^export (?:const (\w+)|\{ ([\w, ]+) \})/gm)].flatMap(
        (m) => (m[1] ?? m[2] ?? "").split(/,\s*/),
      );
      if (found.sort().join() !== [...loaderExports].sort().join()) {
        throw new Error(
          `build-binary: oxc-parser's loader exports ${found.join(", ")}: update the plugin`,
        );
      }
      const names = loaderExports.filter((name) => name !== "__napiBindingTarget");
      return {
        loader: "js",
        contents: [
          `const binding = require("@oxc-parser/binding-${binding}/parser.${binding}.node");`,
          `export const { ${names.join(", ")} } = binding;`,
          `export const __napiBindingTarget = ${JSON.stringify(binding)};`,
        ].join("\n"),
      };
    });
    build.onLoad({ filter: /oxc-parser[\\/]src-js[\\/]visit[\\/]index\.js$/ }, async ({ path }) => {
      const original = await Bun.file(path).text();
      const lazy =
        /const require = createRequire\(import\.meta\.url\);[\s\S]*?require\("\.\/visitor\.js"\)\);/;
      if (!lazy.test(original)) {
        throw new Error(
          "build-binary: oxc-parser's Visitor loads its walk in a new way: update the plugin",
        );
      }
      return {
        loader: "js",
        contents: [
          'import { walkProgram as staticWalk } from "../generated/visit/walk.js";',
          'import * as staticVisitor from "./visitor.js";',
          original.replace(
            lazy,
            "({ walkProgram } = { walkProgram: staticWalk }); ({ addVisitorToCompiled, createCompiledVisitor, finalizeCompiledVisitor } = staticVisitor);",
          ),
        ].join("\n"),
      };
    });
  },
};

const runtime = await createScope().run(buildRuntime);

const runtimeModule: BunPlugin = {
  name: "easel-runtime",
  setup(build) {
    build.onResolve({ filter: /^easel:runtime$/ }, () => ({
      path: "easel:runtime",
      namespace: "easel-runtime",
    }));
    build.onLoad({ filter: /.*/, namespace: "easel-runtime" }, () => ({
      loader: "js",
      contents: `export default ${JSON.stringify(runtime)};`,
    }));
  },
};

const result = await Bun.build({
  entrypoints: values.entry ?? ["cmds/easel.ts", "cmds/telemetry-worker.ts"],
  compile: target ? { target, outfile } : { outfile },
  bytecode: true,
  format: "esm",
  minify: true,
  sourcemap: values.sourcemap ? "linked" : "none",
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: Boolean(values.metafile),
  plugins: [oxcStatic, runtimeModule],
});

for (const log of result.logs) console.error(log.message);
if (!result.success) process.exit(1);

if (values.metafile && result.metafile) {
  await Bun.write(values.metafile, JSON.stringify(result.metafile));
}

console.log(
  `build-binary: ${outfile} (${target ?? "this host"}, oxc-parser ${binding}, runtime ${runtime.sha.slice(0, 12)})`,
);
