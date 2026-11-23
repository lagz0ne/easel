const [metafile = "dist/meta.json"] = Bun.argv.slice(2);

const meta = (await Bun.file(metafile).json()) as {
  inputs: Record<string, { imports?: { path: string; external?: boolean }[] }>;
  outputs?: Record<string, { entryPoint?: string; inputs?: Record<string, unknown> }>;
};

const pageOutputs = Object.values(meta.outputs ?? {}).filter((out) =>
  out.entryPoint?.endsWith(".html"),
);

const clientPaths = pageOutputs.length
  ? new Set(pageOutputs.flatMap((out) => Object.keys(out.inputs ?? {})))
  : new Set(Object.keys(meta.inputs));

const server = [
  /\.server\.tsx?$/,
  /^cmds\/(server|host|dev|telemetry-worker)\.ts$/,
  /^src\/backend\//,
  /^tinker\/base\/(main-host|panics\.server|telemetry-worker)\.ts$/,
  /@tinkered\/bun\/dist\/index\.mjs$/,
];

const inputs = Object.keys(meta.inputs).filter((path) => clientPaths.has(path));
const leaks = inputs.filter((path) => server.some((rule) => rule.test(path)));

const builtins = Object.entries(meta.inputs)
  .filter(([path]) => clientPaths.has(path))
  .flatMap(([path, input]) =>
    (input.imports ?? [])
      .filter((target) => /^(node:|bun:?)/.test(target.path))
      .map((target) => `${path} -> ${target.path}`),
  );

for (const line of [...leaks, ...builtins]) console.error(`server code in client: ${line}`);
if (leaks.length || builtins.length) process.exit(1);
console.log(`client build clean: ${inputs.length} modules, none from the server side`);

export {};
