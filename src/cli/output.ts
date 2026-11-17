import { operation, tag } from "@tinkered/core";
import { z } from "zod";

// What a command prints (SPEC-cli.md § Contract): with `--json`, one JSON value per line on
// stdout, errors too, so an agent reads one stream; without it, a short text for a person, with
// errors on stderr. A token or a digest is never in either.

type Stream = { write(chunk: string): unknown };

/** Where answers go. */
export const stdout = tag<Stream>({ label: "cli.stdout" });

/** Where a person's errors go, without `--json`. */
export const stderr = tag<Stream>({ label: "cli.stderr" });

/** `--json`: one JSON value per line. */
export const json = tag<boolean>({ label: "cli.json", default: false });

/** Prints one answer: its JSON, or its text. `error` sends the text to stderr. */
export const say = operation({
  label: "cli.say",
  input: z.object({ json: z.unknown(), text: z.string(), error: z.boolean().optional() }),
  depends: { stdout: stdout.required, stderr: stderr.required, asJson: json },
  run: ({ stdout, stderr, asJson }, { input }) => {
    if (asJson) return void stdout.write(`${JSON.stringify(input.json)}\n`);

    (input.error ? stderr : stdout).write(`${input.text}\n`);
  },
});
