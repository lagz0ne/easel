import type { transform, transformStyleAttribute } from "lightningcss";

/**
 * Lightning CSS (MPL-2.0; THIRD-PARTY-NOTICES.md), its native build. The package's own loader
 * finds the build by a name that it makes at run time, so `bun build --compile` cannot put it in
 * the binary ("Cannot find module ...linux-x64-gnu.node"). Here each release target
 * (scripts/release-binaries.sh) names its file statically. Bun sets `process.platform` and
 * `process.arch` of the `--target` when it compiles, so each binary holds only its own build. Any
 * other system runs from source, with the package's loader.
 */
export const lightningcss: {
  transform: typeof transform;
  transformStyleAttribute: typeof transformStyleAttribute;
} =
  process.platform === "linux" && process.arch === "x64"
    ? require("lightningcss-linux-x64-gnu/lightningcss.linux-x64-gnu.node")
    : process.platform === "linux" && process.arch === "arm64"
      ? require("lightningcss-linux-arm64-gnu/lightningcss.linux-arm64-gnu.node")
      : process.platform === "darwin" && process.arch === "arm64"
        ? require("lightningcss-darwin-arm64/lightningcss.darwin-arm64.node")
        : require("lightningcss");
