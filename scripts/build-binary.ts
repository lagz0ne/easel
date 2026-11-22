/**
 * One compiled easel binary (`easel serve` and the CLI), with `Bun.build` and the oxc-parser
 * plugin below. `build:server` (dist/server, the image) and scripts/release-binaries.sh (the
 * three release targets) both build with it, so each binary holds the same code.
 *
 *   bun scripts/build-binary.ts --outfile <file> [--target <bun target>] [--sourcemap]
 *     [--metafile <file>] [--entry <file>]...
 *
 * Entries: cmds/easel.ts and cmds/telemetry-worker.ts (the worker thread), or each --entry (the
 * probe of tests/kit-binary.test.ts). The flags are those of `bun build --compile --bytecode
 * --format=esm --minify --define process.env.NODE_ENV="production"`.
 *
 * oxc-parser (SPEC-kit.md fact rule 10): its loader (src-js/bindings.js) finds its native file by
 * a name that it makes at run time, so a compiled binary cannot find it. The plugin replaces that
 * loader with a static `require` of the `.node` file of the target, with the same exports, and
 * imports the walk of its `Visitor` statically (it loads it with a relative `require` at run time). The
 * other targets' binding packages must be installed: the release installs with
 * `bun install --frozen-lockfile --os='*' --cpu='*'`. Lightning CSS needs no plugin: its static
 * `require` is in src/kit/lightningcss.server.ts.
 *
 * The runtime of app frames (SPEC-kit.md § App frames, "The runtime"): the build makes it with the
 * one `buildRuntime` of the server, from the pins of package.json, and puts it in the binary as the
 * module `easel:runtime` (cmds/runtime.ts reads it). So the binary needs no node_modules to give a
 * kit version its runtime, and a test can compare its SHA-256 with the one of a build in a scope.
 */
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

/** The binding of oxc-parser for each release target. With no target, the build is for this host. */
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

/** The exports of oxc-parser's loader at the pin; a new pin with other exports fails the build. */
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
    // The Visitor loads its walk at its first use by a relative `require` that it makes at run
    // time, which a compiled binary cannot find: the same modules, imported statically.
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
