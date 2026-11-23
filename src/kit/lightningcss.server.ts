import type { transform, transformStyleAttribute } from "lightningcss";

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
