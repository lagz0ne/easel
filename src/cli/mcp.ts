import { operation } from "@tinkered/core";

import { mcpFetch, mcpServe } from "@/mcp/server";

import { exits } from "./exit";
import { pictureFetch } from "./frames";
import { entryOf, envToken, server } from "./hosts";
import { say } from "./output";

export const mcpRun = operation({
  label: "cli.mcp",
  depends: { entryOf, envToken, mcpServe, say, send: pictureFetch, origin: server.required },
  run: async ({ entryOf, envToken, mcpServe, say, send, origin }) => {
    if (!(envToken ?? entryOf.run().user?.token)) {
      const text = "not signed in: run `easel login <server> --name <name>`, then `easel mcp`";
      say.run({ input: { json: { refused: { signIn: true } }, text, error: true } });
      return exits.refused;
    }

    const fetchImage = (path: string) => send(new Request(new URL(path, origin)));
    await mcpServe.run({ tags: [mcpFetch(fetchImage)] });
    return exits.ok;
  },
});
