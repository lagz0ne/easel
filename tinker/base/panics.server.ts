import { inspect } from "node:util";

export function observeServerPanics(
  abort: (error: unknown) => void,
  closed: Promise<unknown>,
  stderr: { write(chunk: string): unknown },
): () => void {
  const fail = async (error: unknown) => {
    try {
      abort(error);
      await closed;
    } catch (cleanup) {
      stderr.write(`server close failed: ${inspect(cleanup)}\n`);
    }
  };
  process.on("unhandledRejection", fail);
  return process.off.bind(process, "unhandledRejection", fail);
}
