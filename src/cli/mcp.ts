import { operation } from "@tinkered/core";

import { mcpServe } from "@/mcp/server";

import { exits } from "./exit";
import { entryOf, envToken } from "./hosts";
import { say } from "./output";

// `easel mcp` (SPEC-mcp.md § A local agent adds easel): MCP on the cmd's link, each tool through
// the CLI's rpc client with the token of the hosts file (fact rule 4). Its stdout is the link, so
// it prints nothing there while it serves.

/** `easel mcp`: serves until the client closes the link. With no token, it serves nothing. */
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
