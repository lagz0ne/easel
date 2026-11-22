// A font file imported `with { type: "file" }`: Bun gives its path, and puts the file in the binary.
declare module "*.woff2" {
  const path: string;
  export default path;
}
