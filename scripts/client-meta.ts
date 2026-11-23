import type { Plugin } from "vite-plus";

export function clientMeta(root: string): Plugin {
  const base = root.replace(/\/$/, "");
  const local = (id: string) => (id.startsWith(`${base}/`) ? id.slice(base.length + 1) : id);

  return {
    name: "tinker:client-meta",
    apply: "build",
    async generateBundle(_, bundle) {
      const ids = Object.values(bundle).flatMap((out) =>
        out.type === "chunk" ? out.moduleIds : [],
      );
      const inputs = Object.fromEntries(
        ids.map((id) => {
          const info = this.getModuleInfo(id);
          const imports = [...(info?.importedIds ?? []), ...(info?.dynamicallyImportedIds ?? [])];
          return [local(id), { imports: imports.map((path) => ({ path: local(path) })) }];
        }),
      );
      await Bun.write(`${base}/dist/client-meta.json`, JSON.stringify({ inputs }, null, 2));
    },
  };
}
