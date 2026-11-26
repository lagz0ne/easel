import { tag } from "@tinkered/core";
import { z } from "zod";

export declare namespace ConsoleOutput {
  type Sink = { writableNeedDrain?: boolean; fd?: number; write(text: string): unknown };
  type Methods = {
    error(value: unknown): void;
    warn(value: unknown): void;
    info(value: unknown): void;
  };
}

export const consoleOutput = tag<ConsoleOutput.Sink | null>({
  label: "telemetry.console",
  default: null,
});

export const logConsole = tag<ConsoleOutput.Methods | null>({
  label: "telemetry.logConsole",
  default: null,
});

export const consoleSpans = tag({
  label: "telemetry.consoleSpans",
  default: false,
  parse: z.boolean(),
});
