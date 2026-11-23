import { operation, tag } from "@tinkered/core";
import { z } from "zod";

type Stream = { write(chunk: string): unknown };

export const stdout = tag<Stream>({ label: "cli.stdout" });

export const stderr = tag<Stream>({ label: "cli.stderr" });

export const json = tag<boolean>({ label: "cli.json", default: false });

export const say = operation({
  label: "cli.say",
  input: z.object({ json: z.unknown(), text: z.string(), error: z.boolean().optional() }),
  depends: { stdout: stdout.required, stderr: stderr.required, asJson: json },
  run: ({ stdout, stderr, asJson }, { input }) => {
    if (asJson) return void stdout.write(`${JSON.stringify(input.json)}\n`);

    (input.error ? stderr : stdout).write(`${input.text}\n`);
  },
});
