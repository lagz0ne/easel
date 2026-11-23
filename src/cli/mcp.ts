import { operation } from "@tinkered/core";

import { mcpServe } from "@/mcp/server";

import { exits } from "./exit";
import { entryOf, envToken } from "./hosts";
import { say } from "./output";

export const mcpRun = operation({
  label: "cli.mcp",
  depends: { entryOf, envToken, mcpServe, say },
  run: async ({ entryOf, envToken, mcpServe, say }) => {
    if (!(envToken ?? entryOf.run().user?.token)) {
      const text = "not signed in: run `easel login <server> --name <name>`, then `easel mcp`";
      say.run({ input: { json: { refused: { signIn: true } }, text, error: true } });
      return exits.refused;
    }

    await mcpServe.run();
    return exits.ok;
  },
});
