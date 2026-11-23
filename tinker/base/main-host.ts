import type { MainClosed, MainContext } from "./main";

type Output = MainContext["stdout"] & {
  writable?: boolean;
  destroyed?: boolean;
  isTTY?: boolean;
  write(chunk: string, done?: (error?: Error | null) => void): unknown;
  on?(event: "error", listener: (error: unknown) => void): unknown;
  off?(event: "error", listener: (error: unknown) => void): unknown;
};

type Main<R> = (ctx: MainContext) => Promise<R>;

export declare namespace MainHost {
  type Options = {
    env: MainContext["env"];
    args?: readonly string[];
    cwd?: string;
    stdout: Output;
    stderr: Output;
    graceMs?: number;
    hardStop?: () => void;
    onStart?: (app: { closed: MainClosed }, signal: AbortSignal) => unknown;
  };
}

const signalCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;

export function createMainHost<R extends { closed: MainClosed }>(
  main: Main<R>,
  options: MainHost.Options,
) {
  const { env, args = [], cwd = process.cwd(), stdout, stderr, graceMs = 10_000 } = options;
  const hardStop = options.hardStop ?? (() => process.kill(process.pid, "SIGKILL"));
  const controller = new AbortController();
  const printed = new Set<unknown>();
  const hostReasons = new WeakSet<object>();
  let code = 0;
  let stopped = false;
  let savedReason: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  controller.signal.addEventListener("abort", () => {
    timer = setTimeout(hardStop, graceMs);
    timer.unref?.();
  });

  const stop = (next: number, reason?: unknown) => {
    if (reason === undefined) {
      const own = new DOMException("Command stopped", "AbortError");
      hostReasons.add(own);
      reason = own;
    }

    const late = stopped || finished;
    if (late && reason === savedReason) return;
    const prefix = late ? `after exit ${code}` : `command failed (exit ${next})`;
    if (!late) {
      stopped = true;
      code = next;
      savedReason = reason;
    }
    [reason]
      .filter(
        (given) =>
          (late || next !== 0) &&
          given != null &&
          !printed.has(given) &&
          !hostReasons.has(Object(given)),
      )
      .forEach((given) => {
        printed.add(given);
        const value = Object(given);
        const { kind, payload, stack } = value;

        let detail = "Unprintable command failure";
        try {
          detail = stack ?? String(value);
        } catch {}
        try {
          if (next !== 1 && kind && payload) detail = `${kind}: ${JSON.stringify(payload)}`;
        } catch {}
        try {
          stderr.write(`${prefix}: ${detail}\n`);
        } catch {}
      });
    if (late) return;

    controller.abort(reason);
  };

  const started = Promise.resolve().then(() =>
    main({ env, args, cwd, signal: controller.signal, stdout, stderr, exit: stop }),
  );

  const settled = started.then(
    async (app) => {
      const ended = Promise.resolve().then(async () => {
        if (!(app?.closed instanceof Promise)) throw new TypeError("main must return closed");
        if (!controller.signal.aborted) await options.onStart?.(app, controller.signal);

        const failure = [(await app.closed) ?? []]
          .flat()
          .flatMap((end) => (end.status === "failed" ? [end.error] : (end.teardownErrors ?? [])))
          .at(0);
        if (failure === undefined) return false;
        stop(1, failure);
        return true;
      });

      return ended.catch(async (error: unknown) => {
        let failed = !controller.signal.aborted || error !== controller.signal.reason;
        if (failed) stop(1, error);
        if (!(app?.closed instanceof Promise)) return failed;
        await app.closed.catch((cleanup: unknown) => {
          if (cleanup === error) return;
          failed = true;
          stop(1, cleanup);
        });
        return failed;
      });
    },
    (error: unknown) => {
      const failed = !controller.signal.aborted || error !== controller.signal.reason;
      const config = ["MissingTag", "MissingConfig", "DataValidationFailed"].includes(
        Object(error).kind,
      );
      if (failed) stop(config || Object(error).code === "ERR_INVALID_URL" ? 78 : 1, error);
      return failed;
    },
  );

  const closed = settled.then(async (failed) => {
    for (const stream of [stdout, stderr]) {
      const fence = new Promise<void>((resolve, reject) => {
        if (typeof stream.writable !== "boolean" || stream.destroyed) return resolve();
        stream.write("", (error) => (error ? reject(error) : resolve()));
      });
      await fence.catch((error: unknown) => {
        const { code: why } = Object(error);
        if (why !== "EPIPE" && !(why === "EIO" && stream.isTTY === true)) failed = true;
      });
    }
    finished = true;
    clearTimeout(timer);
    if (stopped) return code;
    return failed ? 1 : 0;
  });

  return {
    started,
    closed,
    signal: controller.signal,
    stop(next: number, reason?: unknown) {
      if (reason instanceof DOMException && reason.name === "AbortError") hostReasons.add(reason);
      stop(next, reason);
    },
  };
}

export async function runMain<R extends { closed: MainClosed }>(
  main: Main<R>,
  options: Partial<MainHost.Options> = {},
) {
  const inputs: MainHost.Options = {
    env: process.env,
    args: process.argv.slice(2),
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    ...options,
  };

  const host = createMainHost(main, inputs);
  const stops = Object.entries(signalCodes).map(
    ([name, exitCode]) =>
      [name, () => host.stop(exitCode, new DOMException(name, "AbortError"))] as const,
  );
  for (const [name, handler] of stops) process.on(name, handler);
  const quiet = (error: unknown) => {
    const { code } = Object(error);
    if (code !== "EPIPE" && !(code === "EIO" && inputs.stdout.isTTY === true)) throw error;
  };
  inputs.stdout.on?.("error", quiet);
  inputs.stderr.on?.("error", quiet);
  try {
    process.exitCode = await host.closed;
    return process.exitCode;
  } finally {
    for (const [name, handler] of stops) process.off(name, handler);
    inputs.stdout.off?.("error", quiet);
    inputs.stderr.off?.("error", quiet);
  }
}
