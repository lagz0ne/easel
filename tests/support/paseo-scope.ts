import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock, preset } from "@tinkered/core/testing";
import { z } from "zod";

import { paseoAdapter } from "@/paseo-adapter/index.server";
import { runCommand } from "@/paseo-adapter/paseo";
import type { RequestMessage } from "@/paseo-adapter/source.server";
import { requestSource } from "@/paseo-adapter/source.server";

export type FakeAgent = {
  id: string;
  name: string;
  status: string;
  labels: Record<string, string>;
};

export type FakeWorkspace = {
  workspaceId: string;
  cwd: string;
  isolation: string;
  background: boolean;
};

export type FakePermit = { id: string; agentId: string; name: string };

export type CallKey =
  | "ls"
  | "workspace ls"
  | "workspace create"
  | "run"
  | "permit ls"
  | "permit deny"
  | "report";

export type Fault = "exit" | "no-json" | "bad-shape" | "throw";

type Ran = { out: string; err: string; exit: number };

const labelsOf = (args: readonly string[]) =>
  Object.fromEntries(
    args.flatMap((arg, at) => {
      if (args[at - 1] !== "--label") return [];
      const cut = arg.indexOf("=");
      return [[arg.slice(0, cut), arg.slice(cut + 1)]];
    }),
  );

const valueAfter = (args: readonly string[], flag: string) =>
  args.find((_, at) => args[at - 1] === flag) ?? "";

const keyOf = (args: readonly string[]): CallKey => {
  const [first = "", second = ""] = args;
  const two = `${first} ${second}`;
  const keys: CallKey[] = ["workspace ls", "workspace create", "permit ls", "permit deny"];
  const one = z.enum(["ls", "run"]).safeParse(first);
  return keys.find((key) => key === two) ?? (one.success ? one.data : "report");
};

export function paseoWorld() {
  const dir = mkdtempSync(join(tmpdir(), "paseo-scope-"));
  const agents: FakeAgent[] = [];
  const workspaces: FakeWorkspace[] = [];
  const permits: FakePermit[] = [];
  const calls: { key: CallKey; argv: readonly string[]; env: Record<string, string> }[] = [];
  const reports: string[][] = [];
  const denied: string[] = [];
  const world = {
    dir,
    workspaceDir: join(dir, "easel"),
    stateDir: join(dir, "state"),
    agents,
    workspaces,
    permits,
    limits: { running: 2, perDay: 20 },
    faults: new Map<CallKey, Fault>(),
    faultWhen: (_argv: readonly string[]): Fault | undefined => undefined,
    calls,
    reports,
    denied,
    made: 0,
  };

  const answers: Record<CallKey, (args: readonly string[]) => unknown> = {
    ls: (args) => {
      const wanted = Object.entries(labelsOf(args));
      return world.agents.filter((agent) =>
        wanted.every(([name, value]) => agent.labels[name] === value),
      );
    },
    "workspace ls": () => world.workspaces,
    "workspace create": (args) => {
      world.made += 1;
      const made = {
        workspaceId: `wks_${world.made}`,
        cwd: valueAfter(args, "--path"),
        isolation: valueAfter(args, "--isolation"),
        background: args.includes("--background"),
      };
      world.workspaces.push(made);
      return made;
    },
    run: (args) => {
      const id = `agent-${world.agents.length + 1}`;
      const name = valueAfter(args, "--title");
      world.agents.push({ id, name, status: "running", labels: labelsOf(args) });
      return { agentId: id };
    },
    "permit ls": () => world.permits,
    "permit deny": (args) => {
      const [, , agentId = "", id = ""] = args;
      world.denied.push(`${agentId}/${id}`);
      world.permits = world.permits.filter((one) => one.id !== id);
      return {};
    },
    report: (args) => {
      world.reports.push([...args]);
      return { kind: "noted", limits: world.limits };
    },
  };

  const faulted: Record<Exclude<Fault, "throw">, (key: CallKey) => Ran> = {
    exit: (key) => ({ out: "", err: `${key}: it broke\n`, exit: 1 }),
    "no-json": () => ({ out: "not json", err: "", exit: 0 }),
    "bad-shape": () => ({ out: JSON.stringify({ wrong: true }), err: "", exit: 0 }),
  };

  const fake = async (argv: readonly string[], env: Record<string, string>): Promise<Ran> => {
    const [, ...args] = argv;
    const key = keyOf(argv[0] === "paseo" ? args : args.slice(2));
    world.calls.push({ key, argv, env });

    const fault = world.faults.get(key) ?? world.faultWhen(argv);
    if (fault === "throw") throw new Error(`${key} threw`);
    if (fault) return faulted[fault](key);

    return { out: `${JSON.stringify(answers[key](args))}\n`, err: "", exit: 0 };
  };

  return { world, fake, close: () => rmSync(dir, { recursive: true, force: true }) };
}

export type PaseoWorld = ReturnType<typeof paseoWorld>;

export function fakeMessage(body: unknown, seq = 1) {
  const naked: (number | undefined)[] = [];
  const termed: (string | undefined)[] = [];
  const said = { acked: 0, naked, termed };
  const msg: RequestMessage = {
    data: new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body)),
    subject: "easel.requests.product",
    seq,
    ack: () => void (said.acked += 1),
    nak: (millis) => void said.naked.push(millis),
    term: (reason) => void said.termed.push(reason),
  };
  return { msg, said };
}

export async function paseoScope(paseo: PaseoWorld, more: { reportMs?: number } = {}) {
  const lines: Record<string, unknown>[] = [];
  const messages: RequestMessage[] = [];
  const exited: number[] = [];
  const clock = makeTestClock({ now: Date.parse("2026-11-25T08:00:00Z") });
  const scope = await createScope({
    clock,
    presets: [
      preset(requestSource, () => Promise.resolve({ next: async () => messages.shift() ?? null })),
      preset(runCommand, (_, { input }) => paseo.fake(input.argv, input.env)),
    ],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      paseoAdapter({
        seed: "SUAFAKE",
        paseo: "paseo",
        workspaceDir: paseo.world.workspaceDir,
        agentConfigHome: join(paseo.world.dir, ".config/easel-agent"),
        easel: ["easel"],
        stateDir: paseo.world.stateDir,
        pollMs: 100,
        permitMs: 50,
        reportMs: more.reportMs ?? 30_000,
        output: {
          write: (text: string) =>
            lines.push(z.record(z.string(), z.unknown()).parse(JSON.parse(text))),
        },
        exit: (code) => void exited.push(code),
      }),
    ],
  }).ready;

  const events = (name: string) => lines.filter((line) => line.event === name);
  return { scope, clock, lines, messages, exited, events };
}
