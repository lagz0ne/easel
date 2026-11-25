import { operation } from "@tinkered/core";
import { z } from "zod";

const metafile = z.object({
  inputs: z.record(
    z.string(),
    z.looseObject({
      imports: z
        .array(z.looseObject({ path: z.string(), external: z.boolean().optional() }))
        .optional(),
    }),
  ),
  outputs: z
    .record(
      z.string(),
      z.looseObject({
        entryPoint: z.string().optional(),
        inputs: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});

export const testCode: readonly RegExp[] = [/@tinkered\/core\/dist\/testing\./, /\.testing\.tsx?$/];

export const serverCode: readonly RegExp[] = [
  /\.server\.tsx?$/,
  /^cmds\/(server|host|dev|telemetry-worker)\.ts$/,
  /^src\/backend\//,
  /^tinker\/base\/(main-host|panics\.server|telemetry-worker)\.ts$/,
  /@tinkered\/bun\/dist\/index\.mjs$/,
];

export const readMetafile = operation({
  label: "build.readMetafile",
  input: z.string(),
  run: async (_, { input: path }) => metafile.parse(await Bun.file(path).json()),
});

export const testLeaks = operation({
  label: "build.testLeaks",
  input: z.array(z.string()),
  depends: { readMetafile },
  run: async ({ readMetafile }, { input: metafiles }) => {
    const lines: string[] = [];
    for (const path of metafiles) {
      const meta = await readMetafile.run({ input: path });
      const found = Object.keys(meta.inputs).filter((input) =>
        testCode.some((rule) => rule.test(input)),
      );
      lines.push(...found.map((input) => `test code in ${path}: ${input}`));
    }

    if (lines.length) return { kind: "leaks" as const, lines };
    return {
      kind: "clean" as const,
      text: `prod builds clean: no test code in ${metafiles.join(", ")}`,
    };
  },
});

export const serverLeaks = operation({
  label: "build.serverLeaks",
  input: z.string(),
  depends: { readMetafile },
  run: async ({ readMetafile }, { input: path }) => {
    const meta = await readMetafile.run({ input: path });
    const pages = Object.values(meta.outputs ?? {}).filter((out) =>
      out.entryPoint?.endsWith(".html"),
    );
    const client = pages.length
      ? new Set(pages.flatMap((out) => Object.keys(out.inputs ?? {})))
      : new Set(Object.keys(meta.inputs));

    const inputs = Object.entries(meta.inputs).filter(([input]) => client.has(input));
    const leaks = inputs
      .map(([input]) => input)
      .filter((input) => serverCode.some((rule) => rule.test(input)));
    const builtins = inputs.flatMap(([input, about]) =>
      (about.imports ?? [])
        .filter((target) => /^(node:|bun:?)/.test(target.path))
        .map((target) => `${input} -> ${target.path}`),
    );

    const lines = [...leaks, ...builtins].map((line) => `server code in client: ${line}`);
    if (lines.length) return { kind: "leaks" as const, lines };
    return {
      kind: "clean" as const,
      text: `client build clean: ${inputs.length} modules, none from the server side`,
    };
  },
});
