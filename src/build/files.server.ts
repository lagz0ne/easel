import { join } from "node:path";

import { operation } from "@tinkered/core";
import { z } from "zod";

export const generateMigrations = operation({
  label: "build.generateMigrations",
  input: z.string(),
  run: (_, { input: root }) => {
    const configs = [...new Bun.Glob("drizzle{,.*}.config.ts").scanSync(root)].sort();
    for (const config of configs) {
      const ran = Bun.spawnSync(["bunx", "drizzle-kit", "generate", "--config", config], {
        cwd: root,
        stdio: ["inherit", "inherit", "inherit"],
      });
      if (ran.exitCode !== 0) {
        return { kind: "failed" as const, config, code: ran.exitCode ?? 1 };
      }
    }
    return { kind: "generated" as const, configs: configs.length };
  },
});

export const embedClient = operation({
  label: "build.embedClient",
  input: z.object({ clientDir: z.string(), outFile: z.string(), importDir: z.string() }),
  run: async (_, { input }) => {
    const built = await Bun.file(join(input.clientDir, "index.html")).exists();
    const names = built ? [...new Bun.Glob("**/*").scanSync(input.clientDir)].sort() : [];
    const imports = names.map(
      (name, at) => `import f${at} from "${input.importDir}/${name}" with { type: "file" };`,
    );
    const table = names.map((name, at) => `  "/${name}": f${at},`);

    await Bun.write(
      input.outFile,
      [
        "// Written by cmds/embed-client.ts after `vp build`. Do not edit.",
        "// @ts-nocheck: each import is a file to embed, not a module; the table's type is below.",
        ...imports,
        "",
        "/** Each built client file by its URL path. */",
        `export default {${table.length ? `\n${table.join("\n")}\n` : ""}} as unknown as Record<string, string>;`,
        "",
      ].join("\n"),
    );
    return names.length;
  },
});
