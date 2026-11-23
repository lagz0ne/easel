const root = process.argv[2] ?? process.cwd();
const configs = [...new Bun.Glob("drizzle{,.*}.config.ts").scanSync(root)].sort();

for (const config of configs) {
  const run = Bun.spawnSync(["bunx", "drizzle-kit", "generate", "--config", config], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (run.exitCode !== 0) {
    console.error(`db:generate: drizzle-kit failed for ${config}`);
    process.exit(run.exitCode ?? 1);
  }
}
