import { fileURLToPath } from "node:url";

import { gates } from "@tinkered/cli/config";
import { pageGuard } from "@tinkered/cli/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

import { clientMeta } from "./scripts/client-meta";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const alias = { "~": at("tinker"), "@": at("src") };
const api = `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  root: at("cmds"),
  plugins: [process.env.VITEST ? [] : pageGuard(), react(), clientMeta(at("."))],
  resolve: { alias },
  build: {
    outDir: at("dist/client"),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "vendor", test: /node_modules/ }],
        },
      },
    },
  },
  server: {
    port: Number(process.env.DEV_PORT ?? 5173),
    strictPort: true,
    proxy: { "/rpc": { target: api, ws: true }, "/api": api },
  },
  test: {
    root: at("."),
    tags: [
      {
        name: "speed",
        description:
          "A speed budget of server work. Only the speed gate runs it (bun run speed), on its own host.",
        retry: 1,
      },
    ],
    tagsFilter: ["!speed"],
    projects: [
      {
        resolve: { alias },
        test: {
          name: "server",
          root: at("."),
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**", "**/node_modules/**", "tests/.gen-*/**"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        optimizeDeps: {
          include: [
            "@base-ui/react/menu",
            "@tinkered/cli/test",
            "@tinkered/core",
            "@tinkered/core/testing",
            "@tinkered/react",
            "react",
            "react-dom/client",
            "@tanstack/react-router",
            "zod",
          ],
        },
        test: {
          name: "browser",
          root: at("."),
          include: ["tests/browser/**/*.test.tsx"],
          setupFiles: ["tests/browser/exits.setup.ts"],
          expect: { poll: { timeout: 5_000 } },
          api: { host: "127.0.0.1", strictPort: false },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
  fmt: {
    embeddedLanguageFormatting: "off",
    sortImports: {
      customGroups: [{ groupName: "base", elementNamePattern: ["~/**"] }],
      groups: [
        "builtin",
        "external",
        "base",
        "internal",
        ["parent", "sibling", "index"],
        "style",
        "unknown",
      ],
    },
  },
  lint: {
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "tinker", specifier: "@tinkered/cli/lint" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      complexity: ["error", { max: 8 }],
      "typescript/no-floating-promises": "error",
      "tinker/blank-lines": "error",
      "tinker/body-steps": "error",
      "tinker/cell-write": "warn",
      curly: ["error", "multi-line"],
      "import/no-relative-parent-imports": "error",
      "import/default": "off",
    },
    options: { typeAware: true, typeCheck: false },
    overrides: [
      {
        files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
        rules: { "import/no-relative-parent-imports": "off" },
      },
      { files: ["src/**"], rules: gates },
    ],
  },
});
