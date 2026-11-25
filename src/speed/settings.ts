import { tag } from "@tinkered/core";
import { z } from "zod";

export declare namespace Speed {
  type Output = { write(text: string): unknown };
}

const positive = z.number().int().positive();

export const speedRoot = tag({ label: "speed.root", parse: z.string().min(1) });

export const speedOutput = tag<Speed.Output>({ label: "speed.output" });

export const speedEnv = tag<Readonly<Record<string, string | undefined>>>({
  label: "speed.env",
  default: {},
});

export const speedRuns = tag({ label: "speed.runs", default: 5, parse: positive });

export const panRuns = tag({ label: "speed.panRuns", default: 3, parse: positive });

export const panMs = tag({ label: "speed.panMs", default: 2_000, parse: positive });

export const startMs = tag({ label: "speed.startMs", default: 30_000, parse: positive });

export const speedViewport = tag({
  label: "speed.viewport",
  default: { width: 1280, height: 800 },
  parse: z.object({ width: positive, height: positive }),
});

export const chromiumFlags = tag({
  label: "speed.chromiumFlags",
  default: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--enable-gpu-rasterization"],
  parse: z.array(z.string()),
});

export const budgetTests = tag({
  label: "speed.budgetTests",
  default: [
    "bun",
    "--bun",
    "vp",
    "test",
    "--project",
    "server",
    "--tagsFilter",
    "speed",
    "--no-file-parallelism",
  ],
  parse: z.array(z.string()).min(1),
});
